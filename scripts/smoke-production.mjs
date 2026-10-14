import { chromium } from "@playwright/test";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
const origin = "https://lup-media-pro--lup-media-pro.us-central1.hosted.app";
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
const sdk = { apiKey };
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
  for (const path of [
    ws,
    `users/${uid}`,
    `rateLimits/${uid}_bootstrap`,
    `rateLimits/${uid}_write`,
  ])
    await google(`${base}/${path}`, "DELETE");
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${sdk.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    },
  );
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
    authUrl.searchParams.get("client_id") !== "1053568541018948" ||
    authUrl.searchParams.get("redirect_uri") !==
      `${origin}/api/auth/instagram/callback`
  )
    throw Error("OAuth deployment configuration mismatch.");
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
  console.log(
    "Production smoke checks passed; no Instagram operation was invoked.",
  );
} finally {
  try {
    await cleanup();
  } finally {
    await browser.close();
  }
}
