import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { admin, workspacePath } from "./firebase";
import {
  authorize,
  encrypt,
  HttpError,
  publicOrigin,
  rateLimit,
} from "./security";
import { exchangeCode, MetaClient } from "./meta";
export const scopes = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function startOAuth(req: Request) {
  const { ws, uid, role } = await authorize(req, true);
  if (!["owner", "admin"].includes(role))
    throw new HttpError(403, "Somente administradores conectam contas.");
  await rateLimit(uid, "oauth", 5);
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET)
    throw new HttpError(503, "Configure o aplicativo Meta no servidor.");
  const state = randomBytes(32).toString("hex"),
    browser = randomBytes(32).toString("hex");
  await admin()
    .db.doc(`oauthStates/${hash(state)}`)
    .set({ ws, uid, browser: hash(browser), expiresAt: Date.now() + 600000 });
  const url = new URL("https://www.instagram.com/oauth/authorize");
  for (const [k, v] of Object.entries({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${publicOrigin()}/api/auth/instagram/callback`,
    response_type: "code",
    scope: scopes.join(","),
    enable_fb_login: "0",
    force_authentication: "1",
    state,
  }))
    url.searchParams.set(k, v);
  return Response.json(
    { url: url.toString() },
    {
      headers: {
        "Set-Cookie": `lup_oauth=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/instagram; Max-Age=600`,
      },
    },
  );
}
export async function callback(req: Request) {
  const u = new URL(req.url),
    state = u.searchParams.get("state") ?? "",
    code = u.searchParams.get("code");
  const cookie =
    req.headers.get("cookie")?.match(/(?:^|;\s*)lup_oauth=([^;]+)/)?.[1] ?? "";
  if (!/^[a-f0-9]{64}$/.test(state) || !cookie)
    throw new HttpError(400, "Estado OAuth inválido.");
  const db = admin().db,
    ref = db.doc(`oauthStates/${hash(state)}`);
  const data = await db.runTransaction(async (t) => {
    const doc = await t.get(ref),
      d = doc.data();
    if (
      !d ||
      d.expiresAt < Date.now() ||
      !timingSafeEqual(Buffer.from(d.browser), Buffer.from(hash(cookie)))
    )
      throw new HttpError(400, "Autorização expirada ou inválida.");
    t.delete(ref);
    return d;
  });
  if (!code || u.searchParams.has("error"))
    throw new HttpError(400, "Autorização recusada.");
  const membership = await db
    .doc(`${workspacePath(data.ws)}/members/${data.uid}`)
    .get();
  if (!["owner", "admin"].includes(membership.data()?.role))
    throw new HttpError(403, "Permissão removida.");
  const token = await exchangeCode(
    code,
    `${publicOrigin()}/api/auth/instagram/callback`,
  );
  const client = new MetaClient(token.access_token),
    me = await client.me(),
    id = me.user_id ?? me.id;
  const granted = await client.permissions(id);
  const permissions = granted.data
    .filter((x) => x.status === "granted")
    .map((x) => x.permission);
  if (scopes.some((s) => !permissions.includes(s)))
    throw new HttpError(400, "Permissões necessárias não foram concedidas.");
  const batch = db.batch();
  batch.set(db.doc(`${workspacePath(data.ws)}/accounts/${id}`), {
    id,
    username: me.username,
    accountType: me.account_type,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    permissions,
    status: "connected",
  });
  batch.set(db.doc(`${workspacePath(data.ws)}/secrets/${id}`), {
    token: encrypt(token.access_token),
    createdAt: new Date().toISOString(),
  });
  batch.set(db.collection(`${workspacePath(data.ws)}/audit`).doc(), {
    action: "instagram_connected",
    uid: data.uid,
    accountId: id,
    at: new Date().toISOString(),
  });
  await batch.commit();
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${publicOrigin()}/?connected=1`,
      "Set-Cookie":
        "lup_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/instagram; Max-Age=0",
    },
  });
}
