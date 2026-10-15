import { test, expect } from "@playwright/test";
import { admin } from "../lib/server/firebase";

test.skip(process.env.LUP_E2E_EMULATORS !== "true", "Requires demo emulators.");
test("importa arquivos extraídos e troca lista antiga por relações verificáveis", async ({ page, isMobile }) => {
  test.setTimeout(90000);
  const email = `followers-${Date.now()}-${isMobile ? "m" : "d"}@example.test`;
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("FollowersTest!12345");
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  await expect(page.locator(".appframe")).toBeVisible({ timeout: 30000 });
  const { db, auth } = admin();
  const user = await auth.getUserByEmail(email);
  await db.doc(`workspaces/${user.uid}/settings/followers`).set({
    users: ["legado"], completed: [], protected: ["bia"], following: [], followers: [], timestamps: {}, displayNames: {}, history: [], linkMode: "web",
    source: { name: "HTML original", updated: "2026-10-13", partial: true },
  });
  await page.reload();
  async function navigate(name: string) {
    if (isMobile) await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name, exact: true }).click();
  }
  await navigate("Seguidores");
  await expect(page.locator(".profile .handle")).toHaveText("@legado");
  await expect(page.getByRole("button", { name: "TOTAL QUE ME SEGUEM (—)", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Importar seguidores e seguindo", exact: true }).click();
  // Incomplete input must not erase the old list.
  await page.locator("#zip").setInputFiles({ name: "following.json", mimeType: "application/json", buffer: Buffer.from('{"relationships_following":[{"title":"ana"}]}') });
  await expect(page.locator(".appframe").getByRole("alert")).toContainText("seguidores e seguindo");
  expect((await db.doc(`workspaces/${user.uid}/settings/followers`).get()).data()!.users).toEqual(["legado"]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#zip").setInputFiles([
    { name: "following.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ relationships_following: [
      { title: "ana", string_list_data: [{ timestamp: 10 }] }, { title: "bia" },
    ] })) },
    { name: "followers_1.html", mimeType: "text/html", buffer: Buffer.from('<a href="https://www.instagram.com/ana/">ana</a><a href="https://www.instagram.com/caio/">caio</a>') },
  ]);
  await expect(page.locator(".notification")).toContainText("Importação concluída", { timeout: 30000 });
  await navigate("Seguidores");
  await expect(page.locator(".profile")).toHaveCount(3);
  await page.getByRole("button", { name: "NÃO ME SEGUEM DE VOLTA (1)", exact: true }).click();
  await expect(page.locator(".profile .handle")).toHaveText("@bia");
  await expect(page.locator(".profile .sub")).toHaveText("Protegido");
  await page.getByRole("button", { name: "NÃO SIGO DE VOLTA (1)", exact: true }).click();
  await expect(page.locator(".profile .handle")).toHaveText("@caio");
  await page.getByRole("button", { name: "MÚTUOS (1)", exact: true }).click();
  await expect(page.locator(".profile .handle")).toHaveText("@ana");
  // Further exports record losses, returns and a second loss without truncating history.
  async function importFollowers(users: string[]) {
    await navigate("Importação e backup");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#zip").setInputFiles([
      { name: "following.json", mimeType: "application/json", buffer: Buffer.from('{"relationships_following":[{"title":"ana"},{"title":"bia"}]}') },
      { name: "followers_1.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(users.map((value) => ({ string_list_data: [{ value }] })))) },
    ]);
    await expect.poll(async () => (await db.doc(`workspaces/${user.uid}/settings/followers`).get()).data()!.followers).toEqual(users);
    await navigate("Seguidores");
  }
  await importFollowers(["ana"]);
  await page.getByRole("button", { name: "QUEM DEIXOU DE SEGUIR · HISTÓRICO", exact: true }).click();
  await expect(page.locator(".follower-change-row .handle")).toHaveText("@caio ↗");
  await expect(page.locator(".follower-change-row")).toContainText("Entre");
  await importFollowers(["ana", "caio"]);
  await importFollowers(["ana"]);
  await page.reload();
  await navigate("Seguidores");
  await page.getByRole("button", { name: "QUEM DEIXOU DE SEGUIR · HISTÓRICO", exact: true }).click();
  await expect(page.locator(".follower-change-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Carregar registros anteriores", exact: true }).click();
  await page.getByRole("combobox", { name: "Tipo de mudança" }).selectOption("all");
  await expect(page.locator(".follower-change-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Carregar registros anteriores", exact: true }).click();
  await expect(page.locator(".follower-change-row")).toHaveCount(3);
  await expect(page.locator(".follower-change-row").filter({ hasText: "Novo seguidor ou retornou" })).toHaveCount(1);
  const changes = await db.collection(`workspaces/${user.uid}/settings/followers/changes`).get();
  expect(changes.size).toBe(4);
  // Saving a review marker must not create a new comparison.
  await page.getByRole("button", { name: "Perfis e relações", exact: true }).click();
  await page.locator(".profile").filter({ hasText: "@ana" }).getByRole("button", { name: "Marcar concluído @ana", exact: true }).click();
  await expect.poll(async () => (await db.doc(`workspaces/${user.uid}/settings/followers`).get()).data()!.completed).toContain("ana");
  expect((await db.collection(`workspaces/${user.uid}/settings/followers/changes`).get()).size).toBe(4);
  // Linking legacy data preserves its history; another Instagram account sees none.
  await db.doc(`workspaces/${user.uid}`).update({ legacyFollowersAccountId: "first" });
  for (const id of ["first", "second"]) await db.doc(`workspaces/${user.uid}/accounts/${id}`).set({ username: id, status: "connected" });
  const login = await page.request.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key", { data: { email, password: "FollowersTest!12345", returnSecureToken: true } });
  const token = (await login.json()).idToken;
  const headers = { Authorization: `Bearer ${token}`, "x-workspace-id": user.uid };
  const first = await page.request.get("/api/followers/changes", { headers: { ...headers, "x-instagram-account-id": "first" } });
  expect((await first.json()).comparisons).toHaveLength(1);
  const second = await page.request.get("/api/followers/changes", { headers: { ...headers, "x-instagram-account-id": "second" } });
  expect((await second.json()).comparisons).toEqual([]);

});
