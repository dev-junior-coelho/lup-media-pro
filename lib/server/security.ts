import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { admin, workspacePath } from "./firebase";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function encrypt(token: string) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw Error("Chave de criptografia não configurada.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((v) => Buffer.from(v, "base64"));
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64"),
    iv,
  );
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
export async function identity(req: Request) {
  const match = req.headers.get("authorization")?.match(/^Bearer (.+)$/);
  if (!match) throw new HttpError(401, "Faça login.");
  try {
    return await admin().auth.verifyIdToken(match[1], true);
  } catch {
    throw new HttpError(401, "Sessão inválida.");
  }
}
export async function authorize(req: Request, write = false) {
  const user = await identity(req),
    ws = req.headers.get("x-workspace-id") || user.uid;
  workspacePath(ws);
  const member = await admin()
    .db.doc(`${workspacePath(ws)}/members/${user.uid}`)
    .get();
  const role = member.data()?.role;
  if (!role || (write && !["owner", "admin", "editor"].includes(role)))
    throw new HttpError(403, "Sem permissão neste workspace.");
  return { uid: user.uid, ws, role };
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin !== new URL(req.url).origin && origin !== process.env.APP_ORIGIN)
    throw new HttpError(403, "Origem inválida.");
}
export async function rateLimit(uid: string, action: string, max = 60) {
  const db = admin().db,
    ref = db.doc(`rateLimits/${uid}_${action}`),
    now = Date.now();
  await db.runTransaction(async (t) => {
    const d = (await t.get(ref)).data();
    const reset = !d || now - d.start > 60000;
    const count = reset ? 1 : d.count + 1;
    if (count > max)
      throw new HttpError(429, "Muitas requisições. Aguarde um minuto.");
    t.set(ref, { start: reset ? now : d.start, count });
  });
}
export function publicOrigin() {
  const u = new URL(process.env.APP_ORIGIN ?? "");
  if (
    u.protocol !== "https:" &&
    !(u.hostname === "localhost" && process.env.FIRESTORE_EMULATOR_HOST)
  )
    throw Error("APP_ORIGIN precisa ser HTTPS.");
  return u.origin;
}
