import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { admin, workspacePath } from "./firebase";
import {
  authorize,
  encrypt,
  HttpError,
  publicOrigin,
  rateLimit,
} from "./security";
import { connectAccount } from "./plans";
import { exchangeCode, MetaClient } from "./meta";
export const scopes = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];
function redirectUri() {
  const value = process.env.META_REDIRECT_URI ?? `${publicOrigin()}/api/auth/instagram/callback`;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new HttpError(503, "A conexão com o Instagram está temporariamente indisponível.");
  return url.toString();
}
function externalHost(req: Request) {
  return req.headers.get("x-fh-requested-host") ??
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.headers.get("host") ?? new URL(req.url).host;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function startOAuth(req: Request) {
  const { ws, uid, role } = await authorize(req, true);
  if (!["owner", "admin"].includes(role))
    throw new HttpError(403, "Somente administradores conectam contas.");
  const origin = publicOrigin();
  if (externalHost(req) !== new URL(origin).host) {
    return Response.json({
      hostedUrl: origin,
      message: "Para autorizar o Instagram, use o endereço principal do LUP. Entre com o mesmo e-mail, abra as configurações e conecte a conta desejada. Depois volte aqui e atualize as contas.",
    });
  }
  await rateLimit(uid, "oauth", 5);
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET ||
      Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64").length !== 32)
    throw new HttpError(503, "A conexão com o Instagram está temporariamente indisponível. Tente novamente mais tarde.");
  const requestedAccountId = req.headers.get("x-instagram-account-id") ?? "";
  if (requestedAccountId && !/^[a-zA-Z0-9_-]{1,100}$/.test(requestedAccountId))
    throw new HttpError(400, "Conta inválida.");
  const state = randomBytes(32).toString("hex"),
    browser = randomBytes(32).toString("hex");
  await admin()
    .db.doc(`oauthStates/${hash(state)}`)
    .set({
      ws,
      uid,
      browser: hash(browser),
      expiresAt: Date.now() + 600000,
      requestedAccountId,
    });
  const url = new URL("https://www.instagram.com/oauth/authorize");
  for (const [k, v] of Object.entries({
    client_id: process.env.META_APP_ID,
    redirect_uri: redirectUri(),
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
        "Set-Cookie": `__session=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/instagram; Max-Age=600`,
      },
    },
  );
}
export async function callback(req: Request) {
  const incoming = new URL(req.url);
  const origin = publicOrigin();
  const registered = new URL(redirectUri());
  if (
    externalHost(req) === registered.host && registered.origin !== origin
  ) {
    // Keep Meta's registered redirect URI while completing on the cookie's domain.
    return new Response(null, { status: 303, headers: {
      Location: `${origin}/api/auth/instagram/callback${incoming.search}`,
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    } });
  }
  const u = incoming,
    state = u.searchParams.get("state") ?? "",
    code = u.searchParams.get("code");
  const cookie =
    req.headers.get("cookie")?.match(/(?:^|;\s*)(?:__session|lup_oauth)=([^;]+)/)?.[1] ?? "";
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
    redirectUri(),
  );
  const client = new MetaClient(token.access_token),
    me = await client.me(),
    id = me.user_id ?? me.id;
  if (
    typeof id !== "string" ||
    !/^\d+$/.test(id) ||
    typeof me.username !== "string"
  )
    throw new HttpError(502, "Instagram não retornou um perfil válido.");
  if (data.requestedAccountId && data.requestedAccountId !== id)
    throw new HttpError(
      400,
      "Você autorizou outra conta. Refaça a conexão usando o @ escolhido.",
    );
  const permissions: string[] =
    token.permissions ??
    (await client.permissions()).data
      .filter((x) => x.status === "granted")
      .map((x) => x.permission);
  if (scopes.some((s) => !permissions.includes(s)))
    throw new HttpError(400, "Permissões necessárias não foram concedidas.");
  await connectAccount(
    db,
    data.ws,
    {
      id,
      username: me.username,
      accountType: me.account_type,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      permissions,
      status: "connected",
    },
    encrypt(token.access_token),
    data.uid,
  );
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${publicOrigin()}/?connected=1`,
      "Cache-Control": "private, no-store",
      "Set-Cookie":
        "__session=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/instagram; Max-Age=0",
    },
  });
}
