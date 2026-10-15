import { test, expect, type APIRequestContext } from "@playwright/test";
import { admin } from "../lib/server/firebase";
import { connectAccount } from "../lib/server/plans";
import { emptyFollowers, type Account } from "../lib/shared/schema";
import { defaultCatalog } from "../lib/shared/plan-management";
import { firestoreStore } from "../lib/server/worker";
test.skip(process.env.LUP_E2E_EMULATORS !== "true", "Requires demo emulators.");
const password = "LupTest!12345";
async function signup(
  request: APIRequestContext,
  origin: string,
  label: string,
) {
  const email = `${label}-${Date.now()}@example.test`;
  const result = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
    { data: { email, password, returnSecureToken: true } },
  );
  const { idToken, localId: uid } = await result.json();
  const headers = { Authorization: `Bearer ${idToken}`, Origin: origin };
  expect(
    (await request.post("/api/bootstrap", { headers, data: {} })).ok(),
  ).toBe(true);
  return { uid: uid as string, email, headers };
}
async function adminToken(
  request: APIRequestContext,
  email: string,
  origin: string,
) {
  const result = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    { data: { email, password, returnSecureToken: true } },
  );
  return {
    Authorization: `Bearer ${(await result.json()).idToken}`,
    Origin: origin,
  };
}
const account = (id: string): Account => ({
  id,
  username: `cliente_${id}`,
  accountType: "BUSINESS",
  status: "connected",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  permissions: ["instagram_business_content_publish"],
});

test("migração automática atualiza o gestor, preços e suspensão", async ({
  page,
  request,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(150000);
  const customer = await signup(request, baseURL!, "plan-customer");
  const operator = await signup(request, baseURL!, "plan-operator");
  const { db, auth } = admin();
  await auth.setCustomUserClaims(operator.uid, { platformAdmin: true });
  const headers = await adminToken(request, operator.email, baseURL!);
  expect(
    (
      await request.get("/api/admin/plan-manager", {
        headers: customer.headers,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put("/api/admin/plan-catalog", {
        headers: customer.headers,
        data: defaultCatalog,
      })
    ).status(),
  ).toBe(403);
  await connectAccount(
    db,
    customer.uid,
    account("111"),
    "fixture-only",
    customer.uid,
  );
  await db.doc(`workspaces/${customer.uid}/accounts/222`).set(account("222"));
  await db
    .doc(`workspaces/${customer.uid}/followers/111`)
    .set({ ...emptyFollowers, users: ["ana"] });
  expect(
    (
      await request.post("/api/subscription/request-pro", {
        headers: customer.headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const migrated = (await db.doc(`workspaces/${customer.uid}`).get()).data()!;
  expect(migrated.subscription).toMatchObject({ plan: "pro", status: "active", activeAccountIds: ["111"] });
  expect(migrated.lastPlanMigration).toMatchObject({ from: "essential", to: "pro", source: "owner" });
  await request.post("/api/subscription/request-pro", { headers: customer.headers, data: {} });
  expect((await db.doc(`workspaces/${customer.uid}`).get()).data()!.subscriptionRevision).toBe(migrated.subscriptionRevision);
  const migrationList = await (await request.get("/api/admin/plan-manager?view=migrations", { headers })).json();
  expect(migrationList.profiles.some((profile: { id: string }) => profile.id === customer.uid)).toBe(true);
  expect(migrationList.stats.migratedProfiles).toBeGreaterThan(0);
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill(operator.email);
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
  await navigate("Gestor de planos");
  await page.getByLabel("E-mail do cliente").fill(customer.email);
  await page
    .getByRole("button", { name: "Buscar cliente", exact: true })
    .click();
  await expect(page.locator(".managed-profile")).toHaveCount(1);
  await expect(page.locator(".managed-profile")).toContainText(customer.email);
  await expect(page.locator(".managed-profile")).toContainText("Cliente migrou de Essencial para Pro");
  await page
    .getByRole("button", { name: "Gerenciar assinatura", exact: true })
    .click();
  await page.getByLabel("@cliente_222", { exact: true }).check();
  await page
    .getByLabel("Motivo da alteração (registro interno)")
    .fill("Contratação confirmada pela equipe no teste");
  await page
    .getByLabel("Conferi o cliente, o plano e as contas.", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "Salvar assinatura", exact: true })
    .click();
  await expect(page.locator(".plan-manager .success-alert")).toContainText(
    "Assinatura atualizada",
  );
  const approved = (await db.doc(`workspaces/${customer.uid}`).get()).data()!;
  expect(approved.subscription).toMatchObject({
    plan: "pro",
    status: "active",
    activeAccountIds: ["111", "222"],
  });
  const publicAudit = await db
    .collection(`workspaces/${customer.uid}/audit`)
    .get();
  expect(publicAudit.docs.every((doc) => doc.data().reason === undefined)).toBe(
    true,
  );
  await page
    .getByRole("tab", { name: "Preços dos planos", exact: true })
    .click();
  await page
    .getByLabel("Mensalidade do Pro (R$)", { exact: true })
    .fill("79,90");
  await page
    .getByLabel("Valor anual do Pro (R$)", { exact: true })
    .fill("799,00");
  await page
    .getByLabel("Exibir preços do Pro aos clientes", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Salvar preços dos planos", exact: true })
    .click();
  await expect(page.locator(".plan-manager .success-alert")).toContainText(
    "Preços salvos",
  );
  const customerState = await (
    await request.get("/api/state", { headers: customer.headers })
  ).json();
  expect(customerState.planCatalog.pro.monthlyCents).toBe(7990);
  expect(customerState.planCatalog.pro.yearlyCents).toBe(79900);
  await page.screenshot({
    path: `test-results/plan-manager-prices-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("tab", { name: "Clientes e migrações", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Gerenciar assinatura", exact: true })
    .click();
  await page.getByLabel("Situação da assinatura").selectOption("suspended");
  await page
    .getByLabel("Motivo da alteração (registro interno)")
    .fill("Pausa administrativa solicitada no teste");
  await page
    .getByLabel("Conferi o cliente, o plano e as contas.", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "Salvar assinatura", exact: true })
    .click();
  await expect(page.locator(".plan-manager .success-alert")).toContainText(
    "Assinatura atualizada",
  );
  expect(
    (
      await request.post("/api/subscription/essential", {
        headers: customer.headers,
        data: { accountId: "111" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/accounts/111/activate", {
        headers: customer.headers,
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/subscription/request-pro", {
        headers: customer.headers,
        data: {},
      })
    ).status(),
  ).toBe(403);
  await expect(
    connectAccount(db, customer.uid, account("333"), "fixture", customer.uid),
  ).rejects.toThrow("suspensa");
  await db
    .doc(`workspaces/${customer.uid}/posts/paused-test`)
    .set({
      accountId: "111",
      status: "scheduled",
      scheduledAt: "2020-01-01T00:00:00Z",
      revision: 1,
    });
  expect(
    await firestoreStore(
      `workspaces/${customer.uid}/posts/paused-test`,
    ).claim(),
  ).toBeNull();
  expect(
    (await db.doc(`workspaces/${customer.uid}/followers/111`).get()).data()!
      .users,
  ).toEqual(["ana"]);
  const suspendedProfile = (
    await (
      await request.get(
        `/api/admin/plan-manager?search=${encodeURIComponent(customer.email)}`,
        { headers },
      )
    ).json()
  ).profiles[0];
  const reactivation = {
    plan: "pro",
    status: "active",
    activeAccountIds: ["111", "222"],
    reason: "Reativação confirmada",
    expectedRevision: suspendedProfile.revision,
  };
  expect(
    (
      await request.put(`/api/admin/subscriptions/${customer.uid}`, {
        headers,
        data: reactivation,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.put(`/api/admin/subscriptions/${customer.uid}`, {
        headers,
        data: reactivation,
      })
    ).status(),
  ).toBe(409);
  const history = await (
    await request.get(`/api/admin/subscriptions/${customer.uid}/history`, {
      headers,
    })
  ).json();
  expect(
    history.events.some(
      (event: { reason?: string }) => event.reason === "Reativação confirmada",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await auth.setCustomUserClaims(operator.uid, {});
  expect(
    (await request.get("/api/admin/plan-manager", { headers })).status(),
  ).toBe(403);
});

test("recusa pedido com mensagem, preserva dados e rejeita decisões antigas", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(90000);
  const customer = await signup(request, baseURL!, "decline-customer");
  const operator = await signup(request, baseURL!, "decline-operator");
  const { auth, db } = admin();
  await auth.setCustomUserClaims(operator.uid, { platformAdmin: true });
  const headers = await adminToken(request, operator.email, baseURL!);
  await db.doc(`workspaces/${customer.uid}`).update({
    "subscription.requestedPlan": "pro", "subscription.requestStatus": "pending",
  });
  await db.doc(`planRequests/${customer.uid}`).set({
    id: "legacy-test", workspaceId: customer.uid, status: "pending", createdAt: new Date().toISOString(),
  });
  const current = (await db.doc(`planRequests/${customer.uid}`).get()).data()!;
  const payload = {
    requestId: current.id,
    message: "Precisamos confirmar os dados da contratação.",
  };
  expect(
    (
      await request.post(`/api/admin/subscriptions/${customer.uid}/decline`, {
        headers,
        data: payload,
      })
    ).ok(),
  ).toBe(true);
  const state = await (
    await request.get("/api/state", { headers: customer.headers })
  ).json();
  expect(state.workspace.subscription.requestStatus).toBe("declined");
  expect(state.workspace.subscription.requestMessage).toContain(
    "confirmar os dados",
  );
  expect(state.workspace.subscription.plan).toBe("essential");
  expect(
    (
      await request.post(`/api/admin/subscriptions/${customer.uid}/decline`, {
        headers,
        data: payload,
      })
    ).status(),
  ).toBe(409);
  await request.post("/api/subscription/request-pro", {
    headers: customer.headers,
    data: {},
  });
  expect((await db.doc(`workspaces/${customer.uid}`).get()).data()!.subscription.plan).toBe("pro");
  expect((await db.doc(`planRequests/${customer.uid}`).get()).data()!.status).toBe("declined");
  expect(
    (
      await request.put(`/api/admin/subscriptions/${customer.uid}`, {
        headers,
        data: {
          plan: "pro",
          status: "active",
          activeAccountIds: [],
          reason: "Decisão antiga",
          expectedRevision: 0,
          requestId: current.id,
        },
      })
    ).status(),
  ).toBe(409);
  const before = (
    await (await request.get("/api/admin/plan-manager", { headers })).json()
  ).catalog;
  const draftCatalog = {
    ...before,
    essential: { ...before.essential, monthlyCents: 3990, published: false },
  };
  expect(
    (
      await request.put("/api/admin/plan-catalog", {
        headers,
        data: draftCatalog,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.put("/api/admin/plan-catalog", {
        headers,
        data: draftCatalog,
      })
    ).status(),
  ).toBe(409);
  const publicState = await (
    await request.get("/api/state", { headers: customer.headers })
  ).json();
  expect(publicState.planCatalog.essential.monthlyCents).toBeNull();
});
