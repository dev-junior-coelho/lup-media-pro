import { beforeEach, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  exchange: vi.fn(),
  permissions: vi.fn(),
  profileId: "123",
}));
vi.mock("../lib/server/firebase", () => ({
  workspacePath: (w: string) => `workspaces/${w}`,
  admin: () => ({
    db: {
      doc: (path: string) => ({
        path,
        set: async (v: Record<string, unknown>) => {
          fake.docs.set(path, v);
        },
        get: async () => ({ data: () => fake.docs.get(path) }),
      }),
      collection: (p: string) => ({
        path: p,
        collection: true,
        doc: () => ({ path: p + "/event" }),
      }),
      runTransaction: async (fn: (t: unknown) => unknown) =>
        fn({
          get: async (r: { path: string; collection?: boolean }) =>
            r.collection
              ? {
                  docs: [...fake.docs.entries()]
                    .filter(
                      ([path]) =>
                        path.startsWith(r.path + "/") &&
                        path.split("/").length === r.path.split("/").length + 1,
                    )
                    .map(([path, data]) => ({
                      id: path.split("/").at(-1),
                      data: () => data,
                    })),
                }
              : {
                  exists: fake.docs.has(r.path),
                  data: () => fake.docs.get(r.path),
                },
          set: (
            r: { path: string },
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) =>
            fake.docs.set(
              r.path,
              options?.merge ? { ...fake.docs.get(r.path), ...data } : data,
            ),
          delete: (r: { path: string }) => fake.docs.delete(r.path),
        }),
      batch: () => ({
        set: (r: { path: string }, v: Record<string, unknown>) =>
          fake.docs.set(r.path, v),
        commit: async () => {},
      }),
    },
  }),
}));
vi.mock("../lib/server/security", async () => {
  const actual = await vi.importActual<typeof import("../lib/server/security")>(
    "../lib/server/security",
  );
  return {
    ...actual,
    authorize: async () => ({ ws: "ws", uid: "u", role: "owner" }),
    rateLimit: async () => {},
  };
});
vi.mock("../lib/server/meta", () => ({
  exchangeCode: fake.exchange,
  MetaClient: class {
    me = async () => ({
      id: fake.profileId,
      user_id: fake.profileId,
      username: "test",
      account_type: "BUSINESS",
    });
    permissions = fake.permissions;
  },
}));
import { startOAuth, callback, scopes } from "../lib/server/oauth";
beforeEach(() => {
  vi.clearAllMocks();
  fake.docs.clear();
  fake.profileId = "123";
  process.env.APP_ORIGIN = "https://app.example";
  delete process.env.META_REDIRECT_URI;
  process.env.META_APP_ID = "app-id";
  process.env.META_APP_SECRET = "test-secret";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  fake.exchange.mockResolvedValue({
    access_token: "not-public",
    expires_in: 5184000,
  });
  fake.permissions.mockResolvedValue({
    data: scopes.map((permission) => ({ permission, status: "granted" })),
  });
  fake.docs.set("workspaces/ws", {
    subscription: { plan: "essential", status: "active" },
  });
  fake.docs.set("workspaces/ws/members/u", { role: "owner" });
});

it("usa permissões recebidas na troca sem consultar o ID do perfil", async () => {
  fake.exchange.mockResolvedValue({
    access_token: "fixture",
    expires_in: 5184000,
    permissions: scopes,
  });
  const a = await begin();
  const r = await callback(
    new Request(
      `https://app.example/api/auth/instagram/callback?state=${a.state}&code=test`,
      { headers: { cookie: a.cookie } },
    ),
  );
  expect(r.status).toBe(303);
  expect(fake.permissions).not.toHaveBeenCalled();
});

it("não substitui permissões insuficientes da troca pelas permissões solicitadas", async () => {
  fake.exchange.mockResolvedValue({
    access_token: "fixture",
    expires_in: 5184000,
    permissions: [],
  });
  const a = await begin();
  await expect(
    callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${a.state}&code=test`,
        { headers: { cookie: a.cookie } },
      ),
    ),
  ).rejects.toThrow("concedidas");
  expect(fake.permissions).not.toHaveBeenCalled();
  expect(fake.docs.has("workspaces/ws/accounts/123")).toBe(false);
});
async function begin() {
  const r = await startOAuth(
    new Request("https://app.example/api/instagram/connect"),
  );
  const { url } = await r.json();
  const state = new URL(url).searchParams.get("state");
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  return { state, cookie, url };
}
it("conecta e reconecta conta com token somente no servidor", async () => {
  for (let i = 0; i < 2; i++) {
    const a = await begin();
    const r = await callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${a.state}&code=test`,
        { headers: { cookie: a.cookie } },
      ),
    );
    expect(r.status).toBe(303);
    expect(fake.docs.get("workspaces/ws/accounts/123")).not.toHaveProperty(
      "token",
    );
    expect(fake.docs.get("workspaces/ws/secrets/123")?.token).not.toBe(
      "not-public",
    );
  }
  expect(fake.exchange).toHaveBeenCalled();
});
it("rejeita state de outro navegador e replay", async () => {
  const a = await begin();
  await expect(
    callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${a.state}&code=x`,
        { headers: { cookie: "lup_oauth=wrong" } },
      ),
    ),
  ).rejects.toThrow("inválida");
  await callback(
    new Request(
      `https://app.example/api/auth/instagram/callback?state=${a.state}&code=x`,
      { headers: { cookie: a.cookie } },
    ),
  );
  await expect(
    callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${a.state}&code=x`,
        { headers: { cookie: a.cookie } },
      ),
    ),
  ).rejects.toThrow("inválida");
});
it("rejeita autorização sem permissão de publicação", async () => {
  fake.permissions.mockResolvedValue({ data: [] });
  const a = await begin();
  await expect(
    callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${a.state}&code=x`,
        { headers: { cookie: a.cookie } },
      ),
    ),
  ).rejects.toThrow("concedidas");
  expect(fake.docs.has("workspaces/ws/accounts/123")).toBe(false);
});
it("autoriza apenas os scopes mínimos e callback HTTPS", async () => {
  const a = await begin(),
    u = new URL(a.url);
  expect(u.searchParams.get("scope")).toBe(scopes.join(","));
  expect(u.searchParams.get("redirect_uri")).toBe(
    "https://app.example/api/auth/instagram/callback",
  );
});

it("impede conectar uma segunda conta no Essencial", async () => {
  fake.docs.set("workspaces/ws/accounts/999", {
    id: "999",
    status: "connected",
  });
  const auth = await begin();
  await expect(
    callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${auth.state}&code=test`,
        { headers: { cookie: auth.cookie } },
      ),
    ),
  ).rejects.toThrow("permite");
  expect(fake.docs.has("workspaces/ws/accounts/123")).toBe(false);
});
it("Pro permite três contas e reconexão não consome outra vaga", async () => {
  fake.docs.set("workspaces/ws", {
    subscription: { plan: "pro", status: "active" },
  });
  for (const id of ["111", "222", "333", "222"]) {
    fake.profileId = id;
    const auth = await begin();
    await callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${auth.state}&code=test`,
        { headers: { cookie: auth.cookie } },
      ),
    );
  }
  fake.profileId = "444";
  const auth = await begin();
  await expect(
    callback(
      new Request(
        `https://app.example/api/auth/instagram/callback?state=${auth.state}&code=test`,
        { headers: { cookie: auth.cookie } },
      ),
    ),
  ).rejects.toThrow("permite");
});

it("orienta a conexão local pela origem HTTPS sem criar autorização incompleta", async () => {
  delete process.env.META_APP_SECRET;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  const response = await startOAuth(new Request("http://localhost:3000/api/instagram/connect", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ hostedUrl: "https://app.example" });
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect([...fake.docs.keys()].some((key) => key.startsWith("oauthStates/"))).toBe(false);
});

it("avisa antes de autorizar se a chave de proteção dos tokens estiver ausente", async () => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  await expect(startOAuth(new Request("https://app.example/api/instagram/connect", { method: "POST" })))
    .rejects.toThrow("temporariamente indisponível");
});

it("mantém o retorno cadastrado na Meta e conclui no domínio curto com o cookie do Hosting", async () => {
  process.env.META_REDIRECT_URI = "https://old.example/api/auth/instagram/callback";
  const a = await begin();
  expect(a.cookie).toMatch(/^__session=/);
  expect(new URL(a.url).searchParams.get("redirect_uri")).toBe(process.env.META_REDIRECT_URI);
  const relay = await callback(new Request(`https://old.example/api/auth/instagram/callback?state=${a.state}&code=test`));
  expect(relay.status).toBe(303);
  expect(relay.headers.get("location")).toBe(`https://app.example/api/auth/instagram/callback?state=${a.state}&code=test`);
  expect(fake.exchange).not.toHaveBeenCalled();
  const completed = await callback(new Request(relay.headers.get("location")!, { headers: { cookie: a.cookie } }));
  expect(completed.status).toBe(303);
  expect(fake.exchange).toHaveBeenCalledWith("test", process.env.META_REDIRECT_URI);
  expect(completed.headers.get("location")).toBe("https://app.example/?connected=1");
});

it("reconhece os domínios externos atrás dos proxies do Firebase", async () => {
  process.env.META_REDIRECT_URI = "https://old.example/api/auth/instagram/callback";
  const started = await startOAuth(new Request("http://0.0.0.0:8080/api/instagram/connect", { headers: { "x-fh-requested-host": "app.example" } }));
  const { url } = await started.json();
  expect(url).toBeTruthy();
  const state = new URL(url).searchParams.get("state");
  const relay = await callback(new Request(`http://0.0.0.0:8080/api/auth/instagram/callback?state=${state}`, { headers: { "x-forwarded-host": "old.example" } }));
  expect(relay.status).toBe(303);
  await expect(callback(new Request(`http://0.0.0.0:8080/api/auth/instagram/callback?state=${state}`, { headers: {
    "x-fh-requested-host": "app.example", cookie: started.headers.get("set-cookie")!.split(";")[0],
  } }))).rejects.toThrow("Autorização recusada");
});
