import { chromium } from "@playwright/test";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import nextEnv from "@next/env";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
nextEnv.loadEnvConfig(process.cwd());
const origin = "https://lup-media-pro.web.app";
const instagramCallback = "https://lup-media-pro--lup-media-pro.us-central1.hosted.app/api/auth/instagram/callback";
const project = "lup-media-pro",
  bucket = "lup-media-pro.firebasestorage.app";
const config = readFileSync(
  new URL("../apphosting.yaml", import.meta.url),
  "utf8",
);
const apiKey =
  process.env.LUP_SMOKE_FIREBASE_API_KEY ??
  JSON.parse(
    config.match(
      /- variable: NEXT_PUBLIC_FIREBASE_API_KEY\s+value: ("[^"\n]+")/,
    )?.[1] ?? "null",
  );
if (!apiKey) throw Error("Firebase Web API key configuration missing.");
const administrativeAuth = getAuth(initializeApp({ projectId: project, credential: applicationDefault() }, "release-smoke"));
const email = `lup-smoke-${Date.now()}@example.invalid`,
  password = randomBytes(18).toString("base64url");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let uid, token;
const access = execFileSync("gcloud", ["auth", "print-access-token"], {
  encoding: "utf8",
}).trim();
async function google(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      "x-goog-user-project": project,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok && r.status !== 404)
    throw Error(`Cleanup API returned ${r.status}`);
  return r.status === 204 || r.status === 404
    ? null
    : r.json().catch(() => null);
}
async function cleanup() {
  if (!uid) {
    const created = await administrativeAuth.getUserByEmail(email).catch((error) => {
      if (error.code === "auth/user-not-found") return null;
      throw error;
    });
    uid = created?.uid;
  }
  if (!uid) return;
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const ws = `workspaces/${uid}`;
  const collections = await google(`${base}/${ws}:listCollectionIds`, "POST", {
    pageSize: 100,
  });
  for (const c of collections?.collectionIds ?? []) {
    const docs = await google(`${base}/${ws}/${c}?pageSize=100`);
    for (const d of docs?.documents ?? []) {
      if (c === "media" && d.fields?.path?.stringValue?.startsWith(`${ws}/`))
        await google(
          `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(d.fields.path.stringValue)}`,
          "DELETE",
        );
      if (c === "settings" || c === "followers") {
        const changes = await google(`https://firestore.googleapis.com/v1/${d.name}/changes?pageSize=100`);
        for (const change of changes?.documents ?? [])
          await google(`https://firestore.googleapis.com/v1/${change.name}`, "DELETE");
      }
      await google(`https://firestore.googleapis.com/v1/${d.name}`, "DELETE");
    }
  }
  const remaining = await google(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(ws + "/")}`,
  );
  for (const object of remaining?.items ?? [])
    await google(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object.name)}`,
      "DELETE",
    );
  const staged = await google(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent("pending/" + uid + "/")}`,
  );
  for (const object of staged?.items ?? [])
    await google(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object.name)}`,
      "DELETE",
    );
  for (const collection of ["planAudit", "oauthStates"]) {
    const result = await google(`${base}:runQuery`, "POST", {
      structuredQuery: { from: [{ collectionId: collection }], where: {
        fieldFilter: { field: { fieldPath: collection === "planAudit" ? "workspaceId" : "ws" },
          op: "EQUAL", value: { stringValue: uid } },
      } },
    });
    for (const row of result ?? []) if (row.document)
      await google(`https://firestore.googleapis.com/v1/${row.document.name}`, "DELETE");
  }
  for (const path of [
    `planRequests/${uid}`,
    `rateLimits/${uid}_oauth`,
    `rateLimits/${uid}_plan-admin`,
    ws,
    `users/${uid}`,
    `rateLimits/${uid}_bootstrap`,
    `rateLimits/${uid}_write`,
  ])
    await google(`${base}/${path}`, "DELETE");
  await administrativeAuth.deleteUser(uid);
  console.log("Temporary smoke-test records removed.");
}
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Calendário de conteúdo" })
    .waitFor({ timeout: 60000 });
  const session = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("firebase:authUser:"),
    );
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  uid = session?.uid;
  token = session?.stsTokenManager?.accessToken;
  if (!uid || !token) throw Error("Test session unavailable.");
  console.log("HTTPS, signup, login session and workspace bootstrap passed.");
  await page
    .getByLabel("Legenda e hashtags")
    .fill("Teste técnico de persistência — rascunho sem publicação");
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await page
    .locator(".itemcard")
    .filter({ hasText: "Teste técnico de persistência" })
    .waitFor({ timeout: 30000 });
  console.log("Draft persisted through the deployed API.");
  await page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Biblioteca de mídia", exact: true })
    .click();
  const image = await sharp({
    create: { width: 1080, height: 1080, channels: 3, background: "#8729e9" },
  })
    .jpeg()
    .toBuffer();
  await page.locator("#library-upload").setInputFiles({
    name: "technical-smoke.jpg",
    mimeType: "image/jpeg",
    buffer: image,
  });
  try {
    await page
      .getByText("technical-smoke.jpg", { exact: true })
      .waitFor({ timeout: 30000 });
  } catch (e) {
    console.log(
      "Upload feedback:",
      await page.getByRole("alert").allTextContents(),
    );
    throw e;
  }
  console.log(
    "Private Storage upload, server validation and media preview passed.",
  );
  const denial = await page.request.get(`${origin}/api/migration/original`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": uid },
  });
  if (denial.status() !== 403)
    throw Error("Original migration list must be restricted.");
  await page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Painel", exact: true })
    .click();
  mkdirSync("docs/images", { recursive: true });
  await page.screenshot({
    path: "docs/images/production-dashboard.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "Calendário de conteúdo" })
    .waitFor({ timeout: 30000 });
  console.log("Persistent session and legacy data protection passed.");
  const state = await page.request.get(`${origin}/api/state`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": uid },
  });
  const value = await state.json();
  if (
    value.posts.length !== 1 ||
    value.posts[0].status !== "draft" ||
    value.media.length !== 1
  )
    throw Error("Persisted state mismatch.");
  const metadataResponse = await page.request.get(
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(value.media[0].path)}`,
    { headers: { Authorization: `Firebase ${token}` } },
  );
  if (metadataResponse.status() !== 403)
    throw Error("Direct metadata reads must not regenerate permanent tokens.");
  if (value.media[0].private !== true)
    throw Error("Backend did not verify private media metadata.");
  const guest = await page.request.get(
    `${origin}/api/media/${value.media[0].id}`,
    { headers: { "x-workspace-id": uid } },
  );
  if (guest.status() !== 401) throw Error("Guest media access must be denied.");
  const oauth = await page.request.post(`${origin}/api/instagram/connect`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-workspace-id": uid,
      Origin: origin,
    },
    data: {},
  });
  if (oauth.status() !== 200)
    throw Error(`OAuth start returned ${oauth.status()}`);
  const authUrl = new URL((await oauth.json()).url);
  if (
    authUrl.searchParams.get("client_id") !== "1115866234134688" ||
    authUrl.searchParams.get("redirect_uri") !==
      instagramCallback
  )
    throw Error("OAuth deployment configuration mismatch.");
  if (!oauth.headers()["set-cookie"]?.includes("__session="))
    throw Error("OAuth cookie must survive Firebase Hosting forwarding.");
  const relay = await page.request.get(`${instagramCallback}?state=${"0".repeat(64)}`, { maxRedirects: 0 });
  if (relay.status() !== 303 || !relay.headers().location?.startsWith(`${origin}/api/auth/instagram/callback?`))
    throw Error("Legacy Instagram callback did not redirect to short domain.");
  const cookieCheck = await page.request.get(`${origin}/api/auth/instagram/callback?state=${authUrl.searchParams.get("state")}`);
  const cookieResult = await cookieCheck.json();
  if (cookieCheck.status() !== 400 || cookieResult.error !== "Autorização recusada.")
    throw Error("OAuth state/cookie did not survive Hosting forwarding.");
  const { createHash } = await import("node:crypto");
  const stateId = createHash("sha256")
    .update(authUrl.searchParams.get("state"))
    .digest("hex");
  await google(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/oauthStates/${stateId}`,
    "DELETE",
  );
  console.log(
    "OAuth start, App ID, redirect URI and secret binding passed; Instagram login was not performed.",
  );
  await page.getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Painel", exact: true }).click();
  const tallImage = await sharp({ create: { width: 720, height: 1280, channels: 4, background: "#145fca" } }).png().toBuffer();
  await page.locator("#upload").setInputFiles({ name: "technical-portrait.png", mimeType: "image/png", buffer: tallImage });
  await page.locator(".media-review").getByText(/alta demais/).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Ajustar imagem", exact: true }).click();
  const adjustment = page.getByRole("dialog", { name: "Ajustar imagem" });
  await adjustment.getByRole("button", { name: "Usar imagem ajustada" }).click();
  await adjustment.waitFor({ state: "hidden", timeout: 30000 });
  await page.getByLabel("Legenda e hashtags").fill("Teste técnico de imagem ajustada — somente rascunho");
  await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  await page.locator(".itemcard").filter({ hasText: "Teste técnico de imagem ajustada" }).waitFor({ timeout: 30000 });
  const adjustedState = await (await page.request.get(`${origin}/api/state`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": uid },
  })).json();
  const adjustedDraft = adjustedState.posts.find((post) => post.caption.startsWith("Teste técnico de imagem ajustada"));
  const adjustedImage = adjustedState.media.find((media) => media.id === adjustedDraft?.mediaIds[0]);
  if (!adjustedImage || adjustedImage.width !== 1080 || adjustedImage.height !== 1350 ||
      adjustedImage.mime !== "image/jpeg" || adjustedDraft.status !== "draft" ||
      !adjustedState.media.some((media) => media.name === "technical-portrait.jpg" && media.height === 1280))
    throw Error("Image preparation did not preserve the source and save the adjusted draft.");
  console.log("Online PNG conversion, image preview, border adjustment and draft copy passed.");
  // Synthetic exported lists in the temporary workspace; no Instagram action.
  async function importFollowerSample(users) {
    await page.getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name: "Importação e backup", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/followers/import") && response.request().method() === "PUT");
    await page.locator("#zip").setInputFiles([
      { name: "following.json", mimeType: "application/json", buffer: Buffer.from('{"relationships_following":[{"title":"smoke_ana"},{"title":"smoke_bia"}]}') },
      { name: "followers_1.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(users.map((value) => ({ string_list_data: [{ value }] })))) },
    ]);
    if (!(await saved).ok()) throw Error("Follower sample import failed.");
    await page.locator(".notification").filter({ hasText: "Importação concluída" }).waitFor();
  }
  await importFollowerSample(["smoke_ana", "smoke_bia"]);
  await importFollowerSample(["smoke_ana"]);
  await page.reload();
  await page.getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Seguidores", exact: true }).click();
  await page.getByRole("button", { name: "QUEM DEIXOU DE SEGUIR · HISTÓRICO", exact: true }).click();
  await page.locator(".follower-change-row").filter({ hasText: "@smoke_bia" }).waitFor({ timeout: 30000 });
  const archive = await (await page.request.get(`${origin}/api/followers/changes`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": uid },
  })).json();
  if (archive.comparisons?.[0]?.changes?.[0]?.user !== "smoke_bia" || !archive.cursor)
    throw Error("Follower archive did not persist its comparison and baseline.");
  console.log("Online follower comparison, permanent archive, pagination and reload passed.");
  await page.getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Plano e contas", exact: true }).click();
  await page.getByRole("button", { name: "Migrar para o Pro", exact: true }).click();
  await page.getByRole("heading", { name: "Seu plano: Pro", exact: true }).waitFor({ timeout: 30000 });
  const upgraded = await (await page.request.get(`${origin}/api/state`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": uid },
  })).json();
  if (upgraded.workspace.subscription.plan !== "pro") throw Error("Automatic upgrade did not activate Pro.");
  await administrativeAuth.setCustomUserClaims(uid, { platformAdmin: true });
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const signedIn = await login.json();
  if (!login.ok || !signedIn.idToken) throw Error("Could not refresh the temporary admin session.");
  const managed = await page.request.get(`${origin}/api/admin/plan-manager?search=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${signedIn.idToken}` },
  });
  const manager = await managed.json();
  if (!managed.ok() || manager.profiles?.[0]?.assignedPlan !== "pro" ||
      manager.profiles[0].lastPlanMigration?.to !== "pro") throw Error("Plan manager did not reflect automatic migration.");
  console.log("Automatic Pro migration and administrative customer update passed.");
  console.log("Production smoke checks passed; no Instagram operation was invoked.");
} finally {
  try {
    await cleanup();
  } finally {
    await browser.close();
  }
}
