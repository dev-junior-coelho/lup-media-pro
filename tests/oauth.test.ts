import { beforeEach, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  exchange: vi.fn(),
  permissions: vi.fn(),
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
      collection: (p: string) => ({ doc: () => ({ path: p + "/event" }) }),
      runTransaction: async (fn: (t: unknown) => unknown) =>
        fn({
          get: async (r: { path: string }) => ({
            data: () => fake.docs.get(r.path),
          }),
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
      id: "ig",
      user_id: "ig",
      username: "test",
      account_type: "BUSINESS",
    });
    permissions = fake.permissions;
  },
}));
import { startOAuth, callback, scopes } from "../lib/server/oauth";
beforeEach(() => {
  fake.docs.clear();
  process.env.APP_ORIGIN = "https://app.example";
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
  fake.docs.set("workspaces/ws/members/u", { role: "owner" });
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
    expect(fake.docs.get("workspaces/ws/accounts/ig")).not.toHaveProperty(
      "token",
    );
    expect(fake.docs.get("workspaces/ws/secrets/ig")?.token).not.toBe(
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
  expect(fake.docs.has("workspaces/ws/accounts/ig")).toBe(false);
});
it("autoriza apenas os scopes mínimos e callback HTTPS", async () => {
  const a = await begin(),
    u = new URL(a.url);
  expect(u.searchParams.get("scope")).toBe(scopes.join(","));
  expect(u.searchParams.get("redirect_uri")).toBe(
    "https://app.example/api/auth/instagram/callback",
  );
});
