import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { admin } from "../lib/server/firebase";
test.skip(process.env.LUP_E2E_EMULATORS !== "true", "Requires demo emulators.");
test("prepara PNG e câmera, preserva a arte com bordas e permite reposicionar um recorte", async ({ page, isMobile }) => {
  test.setTimeout(120000);
  const email = `image-${Date.now()}-${isMobile ? "m" : "d"}@example.test`;
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("ImageTest!12345");
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  await expect(page.locator(".appframe")).toBeVisible({ timeout: 30000 });
  const { auth, db } = admin();
  const user = await auth.getUserByEmail(email);
  await db.doc(`workspaces/${user.uid}/accounts/123`).set({
    username: "restaurante", status: "connected", accountType: "BUSINESS", permissions: ["instagram_business_content_publish"], expiresAt: "2099-01-01T00:00:00Z",
  });
  await db.doc(`workspaces/${user.uid}`).update({ "subscription.activeAccountIds": ["123"] });
  await page.reload();
  await expect(page.locator(".appframe")).toBeVisible();
  const blue = await sharp({ create: { width: 1800, height: 800, channels: 4, background: "#0000ff" } }).png().toBuffer();
  const png = await sharp({ create: { width: 1800, height: 3200, channels: 4, background: "#ff0000" } }).composite([{ input: blue, top: 0, left: 0 }]).png().toBuffer();
  // Opening/closing the preview must release the page and its file picker.
  await page.getByRole("button", { name: "Pré-visualizar publicação", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Pré-visualizar publicação" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Voltar à edição" }).click();
  await expect(preview).not.toBeVisible();
  await page.getByRole("button", { name: "Pré-visualizar publicação", exact: true }).click();
  await preview.press("Escape");
  await expect(preview).not.toBeVisible();
  await page.locator("#upload").setInputFiles({ name: "danificada.png", mimeType: "image/png", buffer: Buffer.from("invalid image") });
  await expect(page.locator("#composerPanel [role=alert]")).toContainText("Não foi possível abrir esta imagem");
  await expect(page.locator("#upload")).toBeEnabled();
  // A temporary failure reloading the workspace must not discard a completed upload.
  let mediaConfirmed = false;
  page.on("response", (response) => {
    if (response.url().endsWith("/api/media") && response.request().method() === "POST" && response.ok()) mediaConfirmed = true;
  });
  await page.route("**/api/state", (route) => mediaConfirmed
    ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Falha temporária ao atualizar os dados"}' })
    : route.continue());
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Adicionar mídia", { exact: true }).click();
  await (await chooser).setFiles({ name: "cartaz.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".media-review")).toContainText("alta demais", { timeout: 30000 });
  await expect(page.locator(".mediathumb img")).toHaveJSProperty("naturalWidth", 1440);
  await expect(page.locator("#composerPanel [role=alert]")).toHaveCount(0);
  await page.unroute("**/api/state");
  let snapshot = await db.collection(`workspaces/${user.uid}/media`).get();
  const original = snapshot.docs[0];
  expect(original.data()).toMatchObject({ mime: "image/jpeg", width: 1440, height: 2560 });
  await page.getByRole("button", { name: "Agendar publicação", exact: true }).click();
  await expect(page.locator("#composerPanel [role=alert]")).toContainText("cartaz.jpg");
  await page.getByRole("button", { name: "Ajustar imagem", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ajustar imagem" });
  await expect(dialog.getByRole("button", { name: "Usar imagem ajustada" })).toBeEnabled();
  await expect(dialog.getByLabel("Manter tudo com bordas")).toBeChecked();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(10);
  expect(Math.abs(bounds!.x + bounds!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await db.collection(`workspaces/${user.uid}/media`).get()).size).toBe(1);
  await page.getByRole("button", { name: "Ajustar imagem", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Usar imagem ajustada" })).toBeEnabled();
  await expect.poll(() => dialog.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).width)).toBe(1080);
  // The full image is preserved, with white space on the left and right.
  const pixels = await dialog.locator("canvas").evaluate((node) => {
    const canvas = node as HTMLCanvasElement, ctx = canvas.getContext("2d")!;
    return [Array.from(ctx.getImageData(0, 500, 1, 1).data), Array.from(ctx.getImageData(540, 500, 1, 1).data)];
  });
  expect(pixels[0].slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels[1][0]).toBeGreaterThan(240);
  expect(pixels[1][1]).toBeLessThan(15);
  await dialog.getByRole("button", { name: "Usar imagem ajustada" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(page.locator(".media-issue")).toHaveCount(0);
  snapshot = await db.collection(`workspaces/${user.uid}/media`).get();
  expect(snapshot.size).toBe(2);
  const copy = snapshot.docs.find((doc) => doc.id !== original.id)!;
  expect(copy.data()).toMatchObject({ width: 1080, height: 1350, mime: "image/jpeg" });
  expect((await original.ref.get()).data()!.height).toBe(2560);
  // A later crop starts from the original, creates another copy and never edits the shared image.
  await page.getByRole("button", { name: "Remover mídia", exact: true }).click();
  await page.getByLabel("Reutilizar da biblioteca").selectOption(original.id);
  await page.getByRole("button", { name: "Ajustar imagem", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Usar imagem ajustada" })).toBeEnabled();
  await dialog.getByLabel("Recortar para preencher").check();
  await dialog.getByLabel("Formato da publicação").selectOption("square");
  const position = dialog.getByLabel("Posição vertical");
  await position.focus();
  await position.press("End");
  await expect(position).toHaveValue("100");
  await expect.poll(() => dialog.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).getContext("2d")!.getImageData(540, 50, 1, 1).data[0])).toBeGreaterThan(240);
  await position.press("Home");
  await expect(position).toHaveValue("0");
  await expect.poll(() => dialog.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).getContext("2d")!.getImageData(540, 50, 1, 1).data[2])).toBeGreaterThan(240);
  await page.screenshot({ path: `test-results/image-adjustment-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Usar imagem ajustada" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await page.getByLabel("Data", { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Agendar publicação", exact: true }).click();
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 1080);
  await expect(preview.getByText("Agendamento:", { exact: false })).toBeVisible();
  await preview.getByRole("button", { name: "Voltar à edição" }).click();
  await expect(page.locator("#upload")).toBeEnabled();
  await page.getByRole("button", { name: "Agendar publicação", exact: true }).click();
  await preview.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.locator(".itemcard")).toHaveCount(1);
  const posts = await db.collection(`workspaces/${user.uid}/posts`).get();
  const scheduled = posts.docs[0].data();
  expect(scheduled.status).toBe("scheduled");
  expect(scheduled.mediaIds).not.toContain(original.id);
  const stored = await db.doc(`workspaces/${user.uid}/media/${scheduled.mediaIds[0]}`).get();
  expect(stored.data()).toMatchObject({ width: 1080, height: 1080 });
  // Verify phone EXIF orientation is flattened before the server measures the JPEG.
  if (isMobile) await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Biblioteca de mídia", exact: true }).click();
  const camera = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#0000ff" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await page.locator("#library-upload").setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: camera });
  await expect(page.getByText("camera.jpg", { exact: true })).toBeVisible({ timeout: 30000 });
  const cameraMedia = await db.collection(`workspaces/${user.uid}/media`).where("name", "==", "camera.jpg").get();
  expect(cameraMedia.docs[0].data()).toMatchObject({ width: 800, height: 1200 });
});
