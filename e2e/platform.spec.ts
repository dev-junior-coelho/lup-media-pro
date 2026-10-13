import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { admin } from "../lib/server/firebase";
import JSZip from "jszip";
test.skip(
  process.env.LUP_E2E_EMULATORS !== "true",
  "Requires independent demo emulators.",
);
test("cadastro, login, rascunho, mídia, agenda, cancelamento e migração", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90000);
  const email = `lup-${Date.now()}-${isMobile ? "m" : "d"}@example.test`,
    password = "LupTest!12345";
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Calendário de conteúdo" }),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: `test-results/dashboard-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  const user = await admin().auth.getUserByEmail(email);
  const ws = user.uid;
  const other = await page.request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
    { data: { email: `other-${email}`, password, returnSecureToken: true } },
  );
  const otherToken = (await other.json()).idToken;
  const denied = await page.request.get("/api/state", {
    headers: { Authorization: `Bearer ${otherToken}`, "x-workspace-id": ws },
  });
  expect(denied.status()).toBe(403);
  async function navigate(label: string) {
    if (isMobile)
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    await page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name: label, exact: true })
      .click();
  }
  await page.getByLabel("Legenda e hashtags").fill("Rascunho de integração");
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await expect(
    page
      .locator(".itemcard")
      .getByText("Rascunho de integração", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Legenda e hashtags").fill("Rascunho editado");
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await expect(
    page.locator(".itemcard").getByText("Rascunho editado", { exact: true }),
  ).toBeVisible();
  await navigate("Biblioteca de mídia");
  const jpeg = await sharp({
    create: { width: 1080, height: 1080, channels: 3, background: "#8729e9" },
  })
    .jpeg()
    .toBuffer();
  await page
    .locator("#library-upload")
    .setInputFiles({ name: "teste.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByText("teste.jpg", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await admin()
    .db.doc(`workspaces/${ws}/accounts/test-ig`)
    .set({
      id: "test-ig",
      username: "test_account",
      accountType: "BUSINESS",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      permissions: [
        "instagram_business_basic",
        "instagram_business_content_publish",
      ],
      status: "connected",
    });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Calendário de conteúdo" }),
  ).toBeVisible();
  await page.getByLabel("Legenda e hashtags").fill("Agendamento testado");
  await page
    .getByLabel("Reutilizar da biblioteca")
    .selectOption({ label: "teste.jpg" });
  await page.getByLabel("Conta do Instagram").selectOption("test-ig");
  await page.getByLabel("Data", { exact: true }).fill("2027-01-20");
  await page
    .getByRole("button", { name: "Agendar publicação", exact: true })
    .click();
  await expect(
    page.getByText("Agendamento testado", { exact: true }),
  ).toBeVisible();
  const scheduled = page
    .locator(".itemcard")
    .filter({ hasText: "Agendamento testado" });
  await scheduled.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Data", { exact: true }).fill("2027-01-21");
  await page
    .getByRole("button", { name: "Agendar publicação", exact: true })
    .click();
  await expect(page.getByText(/21\/01\/2027/)).toBeVisible();
  await page
    .locator(".itemcard")
    .filter({ hasText: "Agendamento testado" })
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(
    page
      .locator(".itemcard .statuspill")
      .getByText("Cancelado", { exact: true }),
  ).toBeVisible();
  await navigate("Backup e migração");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Importar lista e dados locais anteriores" })
    .click();
  await expect(page.locator(".notification")).toContainText("migrada", {
    timeout: 30000,
  });
  await navigate("Seguidores");
  await expect(
    page.locator(".metrics .metric").first().locator(".num"),
  ).toHaveText("1.976");
  const first = page.locator(".profile").first();
  const handle = (await first.locator(".handle").innerText()).slice(1);
  await first
    .getByRole("button", { name: `Marcar concluído @${handle}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Concluídos", exact: true }).click();
  await expect(page.locator(".profile .handle")).toHaveText("@" + handle);
  await navigate("Importação ZIP");
  const zip = new JSZip();
  zip.file(
    "following.json",
    JSON.stringify({
      relationships_following: [{ title: handle }, { title: "other" }],
    }),
  );
  zip.file(
    "followers_1.json",
    JSON.stringify([{ string_list_data: [{ value: "other" }] }]),
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#zip").setInputFiles({
    name: "instagram.zip",
    mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page.locator(".notification")).toContainText("concluída");
  await navigate("Seguidores");
  await page.getByRole("button", { name: "Concluídos", exact: true }).click();
  await expect(page.locator(".profile .handle")).toHaveText("@" + handle);
  await navigate("Backup e migração");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar backup" }).click();
  const backup = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(backup.followers.completed).toContain(handle);
  expect(backup.mediaIncluded).toBe(false);
  page.once("dialog", (d) => d.accept());
  await page.locator("#backup").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator(".notification")).toContainText("concluída");
  await navigate("Seguidores");
  await page.getByRole("button", { name: "Concluídos", exact: true }).click();
  await expect(page.locator(".profile .handle")).toHaveText("@" + handle);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (isMobile)
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Calendário de conteúdo" }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.getByRole("button", { name: "Esqueci minha senha" }).click();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar recuperação" }).click();
  await expect(page.getByRole("status")).toContainText("instruções");
});
