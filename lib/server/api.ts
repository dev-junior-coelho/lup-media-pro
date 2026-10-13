import { randomUUID } from "node:crypto";
import originalUsers from "../../migration/original-users.json";
import { z } from "zod";
import sharp from "sharp";
import { Readable } from "node:stream";
import { admin, workspacePath } from "./firebase";
import {
  authorize,
  identity,
  sameOrigin,
  rateLimit,
  HttpError,
  decrypt,
} from "./security";
import {
  postInput,
  followerSchema,
  mediaInput,
  validatePublication,
  type Account,
  type Media,
  type Post,
} from "../shared/schema";
import { startOAuth } from "./oauth";
import { MetaClient, MetaError } from "./meta";
async function json(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 900000)
    throw new HttpError(413, "Dados excedem limite.");
  const t = await req.text();
  if (Buffer.byteLength(t) > 900000)
    throw new HttpError(413, "Dados excedem limite.");
  try {
    return JSON.parse(t);
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}
export async function api(req: Request, path: string[]) {
  if (req.method !== "GET") sameOrigin(req);
  if (path.join("/") === "bootstrap" && req.method === "POST") {
    const user = await identity(req);
    await rateLimit(user.uid, "bootstrap", 10);
    const { db } = admin(),
      base = workspacePath(user.uid);
    await db.runTransaction(async (t) => {
      const w = await t.get(db.doc(base));
      if (!w.exists) {
        t.set(db.doc(base), {
          name: "Meu workspace",
          timezone: "America/Bahia",
          createdAt: new Date().toISOString(),
        });
        t.set(db.doc(`${base}/members/${user.uid}`), { role: "owner" });
        t.set(db.doc(`users/${user.uid}`), {
          workspaceId: user.uid,
          email: user.email ?? "",
        });
      }
    });
    return Response.json({ workspaceId: user.uid });
  }
  const write = req.method !== "GET";
  const { ws, uid, role } = await authorize(req, write);
  if (write) await rateLimit(uid, "write");
  const { db, bucket } = admin(),
    base = workspacePath(ws);
  const [resource, id, action] = path;
  if (resource === "migration" && id === "original" && req.method === "GET")
    return Response.json({ users: originalUsers });
  const audit = async (a: string, entity: string) =>
    db
      .collection(`${base}/audit`)
      .add({ action: a, entity, uid, at: new Date().toISOString() });
  if (resource === "instagram" && id === "connect" && req.method === "POST")
    return startOAuth(req);
  if (resource === "accounts" && id && req.method === "DELETE") {
    if (!["owner", "admin"].includes(role))
      throw new HttpError(403, "Somente administradores.");
    const secret = await db.doc(`${base}/secrets/${id}`).get();
    if (secret.exists) {
      try {
        await new MetaClient(decrypt(secret.data()!.token)).revoke(id);
      } catch (e) {
        if (!(e instanceof MetaError && e.code === 190)) throw e;
      }
    }
    await db.doc(`${base}/secrets/${id}`).delete();
    await db.doc(`${base}/accounts/${id}`).update({ status: "disconnected" });
    await audit("instagram_disconnected", id);
    return Response.json({ ok: true });
  }
  if (resource === "state" && req.method === "GET") {
    const collections = ["posts", "accounts", "media", "history"];
    const snapshots = await Promise.all(
      collections.map((c) =>
        db
          .collection(`${base}/${c}`)
          .limit(c === "history" ? 200 : 1000)
          .get(),
      ),
    );
    const data: Record<string, unknown> = {};
    for (let i = 0; i < collections.length; i++)
      data[collections[i]] = snapshots[i].docs.map((d) => ({
        ...d.data(),
        id: d.id,
      }));
    data.followers =
      (await db.doc(`${base}/settings/followers`).get()).data() ?? null;
    data.workspace = (await db.doc(base).get()).data();
    return Response.json(data);
  }
  if (resource === "posts" && !id && req.method === "POST") {
    const input = postInput.parse(await json(req)),
      postId = input.id ?? randomUUID(),
      ref = db.doc(`${base}/posts/${postId}`);
    const media = await Promise.all(
      input.mediaIds.map(async (m) => {
        const s = await db.doc(`${base}/media/${m}`).get();
        if (!s.exists)
          throw new HttpError(400, "Mídia não pertence ao workspace.");
        return { ...s.data(), id: m } as Media;
      }),
    );
    if (input.intent !== "draft") {
      const account = await db.doc(`${base}/accounts/${input.accountId}`).get();
      try {
        validatePublication(input, media, account.data() as Account);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    await db.runTransaction(async (t) => {
      const previous = await t.get(ref);
      const p = previous.data() as Post | undefined;
      if (p && ["processing", "published"].includes(p.status))
        throw new HttpError(
          409,
          "Publicação em processamento ou concluída não pode ser editada.",
        );
      if (p && input.revision !== p.revision)
        throw new HttpError(409, "Publicação alterada. Atualize a página.");
      if (p?.uncertain)
        throw new HttpError(
          409,
          "Reconcilie o resultado incerto antes de editar.",
        );
      const now = new Date().toISOString();
      t.set(ref, {
        id: postId,
        type: input.type,
        caption: input.caption,
        accountId: input.accountId,
        mediaIds: input.mediaIds,
        scheduledAt: input.intent === "now" ? now : input.scheduledAt,
        status: input.intent === "draft" ? "draft" : "scheduled",
        revision: (p?.revision ?? 0) + 1,
        createdAt: p?.createdAt ?? now,
        updatedAt: now,
        attempts: 0,
        uncertain: false,
      });
      t.set(db.doc(`${base}/jobs/${postId}`), {
        postId,
        revision: (p?.revision ?? 0) + 1,
        status: input.intent === "draft" ? "inactive" : "queued",
        scheduledAt: input.scheduledAt,
        updatedAt: now,
      });
    });
    await audit("post_saved", postId);
    return Response.json({ id: postId });
  }
  if (
    resource === "posts" &&
    id &&
    req.method === "POST" &&
    action === "reconcile"
  ) {
    const ref = db.doc(`${base}/posts/${id}`),
      p = (await ref.get()).data() as Post | undefined;
    if (!p?.uncertain || !p.containerId)
      throw new HttpError(400, "Publicação não exige reconciliação.");
    const secret = (
      await db.doc(`${base}/secrets/${p.accountId}`).get()
    ).data();
    if (!secret) throw new HttpError(400, "Reconecte a conta.");
    const result = await new MetaClient(decrypt(secret.token)).status(
      p.containerId,
    );
    if (result.status_code !== "PUBLISHED")
      throw new HttpError(
        409,
        "A Meta ainda não confirmou o envio. A retentativa permanece bloqueada.",
      );
    await db.runTransaction(async (t) => {
      const live = (await t.get(ref)).data();
      if (live?.revision !== p.revision || live?.containerId !== p.containerId)
        throw new HttpError(409, "Publicação alterada.");
      t.update(ref, {
        status: "published",
        uncertain: false,
        error: "",
        phase: "complete",
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      t.set(
        db.doc(`${base}/jobs/${id}`),
        { status: "published" },
        { merge: true },
      );
    });
    await audit("post_reconciled", id);
    return Response.json({ ok: true });
  }
  if (resource === "posts" && id && req.method === "POST" && action) {
    const ref = db.doc(`${base}/posts/${id}`);
    if (!["cancel", "retry"].includes(action))
      throw new HttpError(404, "Ação desconhecida.");
    await db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) throw new HttpError(404, "Publicação ausente.");
      const p = doc.data() as Post;
      if (p.status === "processing" || p.status === "published" || p.uncertain)
        throw new HttpError(
          409,
          "Operação bloqueada durante processamento ou resultado incerto.",
        );
      if (action === "retry" && p.status !== "failed")
        throw new HttpError(400, "Somente falhas permitem retentativa.");
      t.update(ref, {
        status: action === "cancel" ? "cancelled" : "scheduled",
        revision: p.revision + 1,
        scheduledAt:
          action === "retry" ? new Date().toISOString() : p.scheduledAt,
        nextAttemptAt: new Date(0).toISOString(),
        error: "",
        updatedAt: new Date().toISOString(),
      });
      t.set(
        db.doc(`${base}/jobs/${id}`),
        {
          status: action === "cancel" ? "cancelled" : "queued",
          revision: p.revision + 1,
        },
        { merge: true },
      );
    });
    await audit(action, id);
    return Response.json({ ok: true });
  }
  if (resource === "posts" && id && req.method === "DELETE") {
    const ref = db.doc(`${base}/posts/${id}`);
    await db.runTransaction(async (t) => {
      const p = (await t.get(ref)).data();
      if (p?.status === "processing" || p?.uncertain)
        throw new HttpError(409, "Publicação em processamento.");
      t.delete(ref);
      t.delete(db.doc(`${base}/jobs/${id}`));
    });
    await audit("post_deleted", id);
    return Response.json({ ok: true });
  }
  if (resource === "media" && req.method === "POST") {
    const m = mediaInput.parse(await json(req));
    if (m.mime === "image/jpeg" && m.size > 8 * 1024 * 1024)
      throw new HttpError(400, "JPEG excede 8 MB.");
    const path = `workspaces/${ws}/media/${m.id}`;
    const file = bucket.file(path);
    const [meta] = await file.getMetadata();
    if (Number(meta.size) !== m.size || meta.contentType !== m.mime)
      throw new HttpError(400, "Upload não corresponde aos metadados.");
    const [bytes] = await file.download({ start: 0, end: 31 });
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const video = bytes.subarray(4, 8).toString() === "ftyp";
    if (m.mime === "image/jpeg" ? !jpeg : !video)
      throw new HttpError(400, "Assinatura do arquivo inválida.");
    if (m.mime === "image/jpeg") {
      const [buffer] = await file.download();
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height)
        throw new HttpError(400, "JPEG inválido.");
      m.width = metadata.width;
      m.height = metadata.height;
    }
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: null },
    });
    await db
      .doc(`${base}/media/${m.id}`)
      .set({ ...m, path, createdAt: new Date().toISOString() });
    await audit("media_uploaded", m.id);
    return Response.json({ ok: true });
  }
  if (resource === "media" && id && req.method === "GET") {
    const d = await db.doc(`${base}/media/${id}`).get();
    if (!d.exists) throw new HttpError(404, "Mídia ausente.");
    const m = d.data() as Media;
    const range = req.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0,
      end =
        range && range[2] ? Math.min(Number(range[2]), m.size - 1) : m.size - 1;
    if (start > end || start >= m.size)
      return new Response(null, { status: 416 });
    const stream = bucket.file(m.path).createReadStream({ start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": m.mime,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${m.size}` }
          : {}),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (resource === "media" && id && req.method === "DELETE") {
    const used = await db
      .collection(`${base}/posts`)
      .where("mediaIds", "array-contains", id)
      .limit(1)
      .get();
    if (!used.empty)
      throw new HttpError(
        409,
        "Mídia associada a uma publicação. Remova a associação primeiro.",
      );
    const d = await db.doc(`${base}/media/${id}`).get();
    if (d.exists)
      await bucket.file(d.data()!.path).delete({ ignoreNotFound: true });
    await d.ref.delete();
    await audit("media_deleted", id);
    return Response.json({ ok: true });
  }
  if (resource === "followers" && req.method === "PUT") {
    const input = followerSchema.parse(await json(req));
    const ref = db.doc(`${base}/settings/followers`);
    await db.runTransaction(async (t) => {
      const old = (await t.get(ref)).data();
      t.set(db.collection(`${base}/snapshots`).doc(), {
        at: new Date().toISOString(),
        followers: old?.followers ?? [],
        following: old?.following ?? [],
        source: old?.source ?? null,
      });
      t.set(ref, input);
    });
    await audit("followers_updated", "followers");
    return Response.json({ ok: true });
  }
  if (resource === "settings" && req.method === "PUT") {
    if (!["owner", "admin"].includes(role))
      throw new HttpError(403, "Somente administradores.");
    const input = z
      .object({
        name: z.string().min(1).max(100),
        timezone: z
          .string()
          .max(100)
          .refine((v) => {
            try {
              new Intl.DateTimeFormat("pt", { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }),
      })
      .parse(await json(req));
    await db.doc(base).update(input);
    return Response.json({ ok: true });
  }
  if (resource === "ai")
    throw new HttpError(
      503,
      "IA não configurada. O sistema funciona sem esse módulo.",
    );
  throw new HttpError(404, "Recurso não encontrado.");
}
