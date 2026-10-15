import { test, expect } from "@playwright/test";
import { admin } from "../lib/server/firebase";
import { connectAccount } from "../lib/server/plans";
import { firestoreStore } from "../lib/server/worker";
import { emptyFollowers, type Account } from "../lib/shared/schema";

test.skip(
  process.env.LUP_E2E_EMULATORS !== "true",
  "Requires independent demo emulators.",
);
const account = (id: string): Account => ({
  id,
  username: `conta_${id}`,
  accountType: "BUSINESS",
  status: "connected",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  permissions: ["instagram_business_content_publish"],
});

test("Pro separa contas, copia rascunhos e preserva dados ao voltar ao Essencial", async ({
  page,
  request,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(120000);
  const email = `multi-${Date.now()}@example.test`,
    password = "LupTest!12345";
  const signup = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
    { data: { email, password, returnSecureToken: true } },
  );
  const { idToken, localId: ws } = await signup.json();
  const headers = { Authorization: `Bearer ${idToken}`, Origin: baseURL! };
  expect(
    (await request.post("/api/bootstrap", { headers, data: {} })).ok(),
  ).toBe(true);
  const { db } = admin();
  await db.doc(`workspaces/${ws}`).update({
    subscription: { plan: "pro", status: "active", activeAccountIds: [] },
  });
  await db.doc(`workspaces/${ws}/settings/followers`).set({
    ...emptyFollowers,
    users: ["ana"],
    displayNames: { ana: "Ana Silva" },
  });
  for (const id of ["111", "222", "333"])
    await connectAccount(db, ws, account(id), "emulator-only-token", ws);
  await expect(
    connectAccount(db, ws, account("444"), "emulator-only-token", ws),
  ).rejects.toThrow("permite");
  await connectAccount(db, ws, account("222"), "emulator-only-token", ws);
  const secondFollowers = await request.put("/api/followers", {
    headers: { ...headers, "x-instagram-account-id": "222" },
    data: {
      ...emptyFollowers,
      users: ["bia"],
      displayNames: { bia: "Bia Santos" },
    },
  });
  expect(secondFollowers.ok()).toBe(true);
  const state = await (await request.get("/api/state", { headers })).json();
  expect(state.followersByAccount["111"].users).toEqual(["ana"]);
  expect(state.followersByAccount["222"].users).toEqual(["bia"]);
  expect(state.followersByAccount["333"]).toBeUndefined();
  const ids: string[] = [];
  for (const [id, caption] of [
    ["111", "Conteúdo da primeira conta"],
    ["222", "Conteúdo da segunda conta"],
  ]) {
    const result = await request.post("/api/posts", {
      headers,
      data: {
        type: "post",
        caption,
        accountId: id,
        mediaIds: [],
        scheduledAt: null,
        intent: "draft",
      },
    });
    expect(result.ok()).toBe(true);
    ids.push((await result.json()).id);
  }
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".appframe")).toBeVisible();
  async function navigate(name: string) {
    if (isMobile)
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    await page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await page
    .getByLabel("Conta selecionada", { exact: true })
    .selectOption("111");
  await navigate("Modo rápido");
  await expect(page.locator(".quick-name")).toHaveText("Ana Silva");
  await expect(page.locator(".quick-handle")).toHaveText("@ana");
  await page
    .getByLabel("Conta selecionada", { exact: true })
    .selectOption("222");
  await expect(page.locator(".quick-name")).toHaveText("Bia Santos");
  await expect(page.locator(".quick-handle")).toHaveText("@bia");
  await navigate("Publicações");
  await expect(page.locator(".itemcard")).toHaveCount(1);
  await page
    .getByLabel("Conta selecionada", { exact: true })
    .selectOption("all");
  await expect(page.locator(".itemcard")).toHaveCount(2);
  await page
    .locator(".itemcard")
    .filter({ hasText: "Conteúdo da primeira conta" })
    .getByRole("button", { name: "Copiar para outra conta", exact: true })
    .click();
  await expect(page.getByLabel("Conta do Instagram")).toHaveValue("");
  await page.getByLabel("Conta do Instagram").selectOption("222");
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await expect(page.locator(".itemcard")).toHaveCount(2);
  expect(
    (
      await db
        .collection(`workspaces/${ws}/posts`)
        .where("accountId", "==", "222")
        .get()
    ).size,
  ).toBe(2);
  await navigate("Plano e contas");
  await page.screenshot({
    path: `test-results/plans-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Conta que permanece no Essencial").selectOption("222");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Confirmar mudança para Essencial",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Seu plano: Essencial", exact: true }),
  ).toBeVisible();
  const after = await (await request.get("/api/state", { headers })).json();
  expect(
    after.accounts
      .filter((item: Account) => !item.planPaused)
      .map((item: Account) => item.id),
  ).toEqual(["222"]);
  expect(after.followersByAccount["111"].users).toEqual(["ana"]);
  expect(
    (
      await request.put("/api/followers", {
        headers: { ...headers, "x-instagram-account-id": "111" },
        data: emptyFollowers,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/posts", {
        headers,
        data: {
          type: "post",
          caption: "Bloqueado",
          accountId: "111",
          mediaIds: [],
          scheduledAt: null,
          intent: "draft",
        },
      })
    ).status(),
  ).toBe(403);
  await db.doc(`workspaces/${ws}/posts/${ids[0]}`).update({
    status: "scheduled",
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
  });
  expect(
    await firestoreStore(`workspaces/${ws}/posts/${ids[0]}`).claim(),
  ).toBeNull();
  expect(
    (
      await request.post("/api/subscription/pro", { headers, data: {} })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/subscription/request-pro", { headers, data: {} })
    ).ok(),
  ).toBe(true);
  expect(
    (await db.doc(`workspaces/${ws}`).get()).data()!.subscription.plan,
  ).toBe("pro");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("conexões simultâneas não ultrapassam as três vagas do Pro", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(60000);
  const signup = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
    {
      data: {
        email: `race-${Date.now()}@example.test`,
        password: "LupTest!12345",
        returnSecureToken: true,
      },
    },
  );
  const { localId: ws, idToken } = await signup.json();
  await request.post("/api/bootstrap", {
    headers: { Authorization: `Bearer ${idToken}`, Origin: baseURL! },
    data: {},
  });
  const { db } = admin();
  await db.doc(`workspaces/${ws}`).update({
    subscription: { plan: "pro", status: "active", activeAccountIds: [] },
  });
  const results = await Promise.allSettled(
    ["111", "222", "333", "444"].map((id) =>
      connectAccount(db, ws, account(id), "emulator-only-token", ws),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(3);
  expect((await db.collection(`workspaces/${ws}/accounts`).get()).size).toBe(3);
});
