import { FieldValue } from "firebase-admin/firestore";
import { randomUUID, createHash } from "node:crypto";
import originalUsers from "../../migration/original-users.json";
import { z } from "zod";
import sharp from "sharp";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  type Followers,
  type Account,
  type Media,
  type Post,
} from "../shared/schema";
import { accountAccess, readPlanContext } from "./plans";
import { plans, activeAccountIds, subscriptionOf } from "../shared/plans";
import { compareFollowerImports, comparisonChunks } from "../shared/follower-changes";
import { restoredDraft } from "../shared/backup";
import { planManagerApi } from "./plan-manager";
import { requestPro, changeSubscription } from "./subscriptions";
import { catalogOf } from "../shared/plan-management";
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
  if (path[0] === "admin") return planManagerApi(req, path.slice(1));
  if (path.join("/") === "bootstrap" && req.method === "POST") {
    const user = await identity(req);
    await rateLimit(user.uid, "bootstrap", 10);
    const { db } = admin(),
      base = workspacePath(user.uid);
    await db.runTransaction(async (t) => {
      const w = await t.get(db.doc(base));
      if (!w.exists) {
        t.set(db.doc(base), {
          ownerUid: user.uid,
          name: "Meu workspace",
          timezone: "America/Bahia",
          subscription: {
            plan: "essential",
            status: "active",
            activeAccountIds: [],
          },
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
  const { ws, uid, role, platformAdmin } = await authorize(req, write);
  if (write) await rateLimit(uid, "write");
  const { db, bucket } = admin(),
    base = workspacePath(ws);
  const [resource, id, action] = path;
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new HttpError(400, "Identificador inválido.");
  if (resource === "migration" && id === "original" && req.method === "GET") {
    if (
      !(
        process.env.FIRESTORE_EMULATOR_HOST &&
        process.env.GOOGLE_CLOUD_PROJECT?.startsWith("demo-")
      ) &&
      uid !== process.env.LEGACY_MIGRATION_OWNER_UID
    )
      throw new HttpError(
        403,
        "A lista original está restrita ao proprietário configurado. Restaure seu backup para migrar os próprios dados.",
      );
    return Response.json({ users: originalUsers });
  }
  const audit = async (a: string, entity: string) =>
    db
      .collection(`${base}/audit`)
      .add({ action: a, entity, uid, at: new Date().toISOString() });
  if (resource === "instagram" && id === "connect" && req.method === "POST")
    return startOAuth(req);
  if (resource === "subscription" && req.method === "POST") {
    if (role !== "owner")
      throw new HttpError(403, "Somente o proprietário gerencia o plano.");
    if (id === "request-pro") {
      await requestPro(db, ws, uid);
      return Response.json({ activated: true });
    }
    if (id === "essential") {
      const input = z
        .object({
          accountId: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,100}$/)
            .nullable(),
        })
        .parse(await json(req));
      await changeSubscription(
        db,
        ws,
        {
          plan: "essential",
          status: "active",
          activeAccountIds: input.accountId ? [input.accountId] : [],
          reason: "Alteração solicitada pelo proprietário.",
        },
        { uid, source: "owner" },
      );
      return Response.json({ ok: true });
    }
    throw new HttpError(404, "Opção de plano não encontrada.");
  }
  if (
    resource === "accounts" &&
    id &&
    action === "activate" &&
    req.method === "POST"
  ) {
    if (!["owner", "admin"].includes(role))
      throw new HttpError(403, "Somente administradores gerenciam contas.");
    await db.runTransaction(async (tx) => {
      const { accounts, subscription, workspace } = await readPlanContext(
        tx,
        db,
        base,
      );
      if (!accounts.some((a) => a.id === id && a.status !== "disconnected"))
        throw new HttpError(400, "Reconecte esta conta primeiro.");
      if (subscription.status === "suspended")
        throw new HttpError(
          403,
          "A assinatura está suspensa. Entre em contato com o administrador.",
        );
      const active = activeAccountIds(subscription, accounts);
      if (
        !active.includes(id) &&
        active.length >= plans[subscription.plan].accountLimit
      )
        throw new HttpError(403, "O limite do seu plano foi atingido.");
      tx.update(db.doc(base), {
        subscription: {
          ...subscription,
          activeAccountIds: [...new Set([...active, id])],
        },
        subscriptionRevision:
          Number(workspace.data()?.subscriptionRevision ?? 0) + 1,
      });
    });
    return Response.json({ ok: true });
  }
  if (resource === "accounts" && id && req.method === "DELETE") {
    if (!["owner", "admin"].includes(role))
      throw new HttpError(403, "Somente administradores.");
    const secret = await db.doc(`${base}/secrets/${id}`).get();
    if (secret.exists) {
      try {
        await new MetaClient(decrypt(secret.data()!.token)).revoke();
      } catch (e) {
        if (!(e instanceof MetaError && e.code === 190)) throw e;
      }
    }
    await db.doc(`${base}/secrets/${id}`).delete();
    await db.runTransaction(async (tx) => {
      const { accounts, subscription, workspace } = await readPlanContext(
        tx,
        db,
        base,
      );
      tx.update(db.doc(`${base}/accounts/${id}`), { status: "disconnected" });
      tx.update(db.doc(base), {
        subscription: {
          ...subscription,
          activeAccountIds: activeAccountIds(subscription, accounts).filter(
            (accountId) => accountId !== id,
          ),
        },
        subscriptionRevision:
          Number(workspace.data()?.subscriptionRevision ?? 0) + 1,
      });
    });
    await audit("instagram_disconnected", id);
    return Response.json({ ok: true });
  }
  if (resource === "state" && req.method === "GET") {
    const collections = ["posts", "accounts", "media", "history"];
    const snapshots = await Promise.all(
      collections.map((c) => {
        const collection = db.collection(`${base}/${c}`);
        return (c === "history" ? collection.orderBy("at", "desc") : collection)
          .limit(c === "history" ? 200 : 1000)
          .get();
      }),
    );
    const data: Record<string, unknown> = {};
    for (let i = 0; i < collections.length; i++)
      data[collections[i]] = snapshots[i].docs.map((d) => ({
        ...d.data(),
        id: d.id,
      }));
    const [legacy, accountFollowers, workspace] = await Promise.all([
      db.doc(`${base}/settings/followers`).get(),
      db.collection(`${base}/followers`).get(),
      db.doc(base).get(),
    ]);
    const accounts = data.accounts as Account[];
    const subscription = subscriptionOf(workspace.data());
    const active = activeAccountIds(subscription, accounts);
    data.accounts = accounts.map((account) => ({
      ...account,
      planPaused: !active.includes(account.id),
    }));
    const legacyAccountId =
      workspace.data()?.legacyFollowersAccountId ??
      (accounts.length === 1 ? accounts[0].id : null);
    const followersByAccount = Object.fromEntries(
      accountFollowers.docs.map((doc) => [doc.id, doc.data()]),
    );
    if (
      legacyAccountId &&
      !followersByAccount[legacyAccountId] &&
      legacy.exists
    )
      followersByAccount[legacyAccountId] = legacy.data()!;
    data.followers = legacyAccountId ? null : (legacy.data() ?? null);
    data.followersByAccount = followersByAccount;
    data.workspace = { ...workspace.data(), subscription };
    data.role = role;
    data.platformAdmin = platformAdmin;
    const catalog = catalogOf(
      (await db.doc("commercialSettings/plans").get()).data(),
    );
    data.planCatalog = {
      ...catalog,
      essential: catalog.essential.published
        ? catalog.essential
        : {
            ...catalog.essential,
            monthlyCents: null,
            yearlyCents: null,
            description: "",
            published: false,
          },
      pro: catalog.pro.published
        ? catalog.pro
        : {
            ...catalog.pro,
            monthlyCents: null,
            yearlyCents: null,
            description: "",
            published: false,
          },
    };
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
    if (input.accountId) await accountAccess(ws, input.accountId);
    if (input.intent !== "draft") {
      const account = await db.doc(`${base}/accounts/${input.accountId}`).get();
      try {
        validatePublication(input, media, account.data() as Account);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    await db.runTransaction(async (t) => {
      if (input.accountId) {
        const context = await readPlanContext(t, db, base);
        if (
          !activeAccountIds(context.subscription, context.accounts).includes(
            input.accountId,
          )
        )
          throw new HttpError(403, "Esta conta está pausada no seu plano.");
      }
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
      const scheduledAt =
        input.intent === "now"
          ? now
          : input.intent === "draft"
            ? null
            : input.scheduledAt;
      const status = input.intent === "draft" ? "draft" : "scheduled";
      t.set(ref, {
        id: postId,
        type: input.type,
        caption: input.caption,
        accountId: input.accountId,
        mediaIds: input.mediaIds,
        scheduledAt,
        status,
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
        scheduledAt,
        updatedAt: now,
      });
      t.set(db.collection(`${base}/history`).doc(), {
        postId,
        accountId: input.accountId,
        caption: input.caption,
        status,
        at: now,
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
  if (
    resource === "posts" &&
    id === "restore" &&
    req.method === "POST" &&
    !action
  ) {
    const input = z
      .object({
        posts: z.array(z.record(z.string(), z.unknown())).max(1000),
        accountId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{0,100}$/)
          .default(""),
      })
      .parse(await json(req));
    if (input.accountId) await accountAccess(ws, input.accountId);
    const drafts = input.posts.map((source, index) => {
      const draft = { ...restoredDraft(source), accountId: input.accountId };
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            "lup-restored-draft",
            source.id ?? index,
            input.accountId,
            draft.type,
            draft.caption,
          ]),
        )
        .digest("hex");
      const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const id =
        z.string().uuid().safeParse(source.id).success &&
        (source.accountId ?? "") === input.accountId
          ? String(source.id)
          : uuid;
      return { ...draft, id };
    });
    const unique = [
      ...new Map(drafts.map((draft) => [draft.id, draft])).values(),
    ];
    let restored = 0;
    for (let index = 0; index < unique.length; index += 100) {
      const chunk = unique.slice(index, index + 100);
      restored += await db.runTransaction(async (t) => {
        if (input.accountId) {
          const context = await readPlanContext(t, db, base);
          if (
            !activeAccountIds(context.subscription, context.accounts).includes(
              input.accountId,
            )
          )
            throw new HttpError(403, "Esta conta está pausada no seu plano.");
        }
        const refs = chunk.map((draft) => db.doc(`${base}/posts/${draft.id}`));
        const existing = await t.getAll(...refs);
        const now = new Date().toISOString();
        let count = 0;
        chunk.forEach((draft, i) => {
          if (existing[i].exists) return;
          const { intent, ...post } = draft;
          void intent;
          t.set(refs[i], {
            ...post,
            status: "draft",
            revision: 1,
            createdAt: now,
            updatedAt: now,
          });
          t.set(db.doc(`${base}/jobs/${draft.id}`), {
            postId: draft.id,
            status: "inactive",
            revision: 1,
            scheduledAt: null,
            updatedAt: now,
          });
          t.set(db.collection(`${base}/history`).doc(), {
            postId: draft.id,
            accountId: draft.accountId,
            caption: draft.caption,
            status: "draft",
            at: now,
          });
          count++;
        });
        return count;
      });
    }
    await audit("posts_restored", "backup");
    return Response.json({ restored, skipped: input.posts.length - restored });
  }
  if (resource === "posts" && id && req.method === "POST" && action) {
    const ref = db.doc(`${base}/posts/${id}`);
    if (!["cancel", "retry"].includes(action))
      throw new HttpError(404, "Ação desconhecida.");
    if (action === "retry") {
      const post = (await ref.get()).data();
      if (!post) throw new HttpError(404, "Publicação ausente.");
      await accountAccess(ws, post.accountId);
    }
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
      if (action === "cancel" && p.status !== "scheduled")
        throw new HttpError(400, "Somente agendamentos podem ser cancelados.");
      const now = new Date().toISOString();
      const status = action === "cancel" ? "cancelled" : "scheduled";
      t.update(ref, {
        ...(action === "retry"
          ? {
              attempts: 0,
              containerId: FieldValue.delete(),
              childIds: FieldValue.delete(),
              containerCreatedAt: FieldValue.delete(),
              phase: FieldValue.delete(),
              leaseId: FieldValue.delete(),
              leaseUntil: FieldValue.delete(),
            }
          : {}),
        status,
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
          scheduledAt: action === "retry" ? now : p.scheduledAt,
        },
        { merge: true },
      );
      t.set(db.collection(`${base}/history`).doc(), {
        postId: id,
        accountId: p.accountId,
        caption: p.caption,
        status,
        at: now,
      });
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
    const pendingPath = `pending/${ws}/${m.id}`;
    const path = `workspaces/${ws}/private/${m.id}`;
    if ((await db.doc(`${base}/media/${m.id}`).get()).exists)
      return Response.json({ ok: true });
    let file = bucket.file(pendingPath);
    if (!(await file.exists())[0])
      file = bucket.file(`workspaces/${ws}/media/${m.id}`);
    const [meta] = await file.getMetadata();
    if (meta.contentEncoding && meta.contentEncoding !== "identity")
      throw new HttpError(400, "Codificação de upload não suportada.");
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
    const privateFile = bucket.file(path);
    if (!(await privateFile.exists())[0])
      await pipeline(
        file.createReadStream(),
        privateFile.createWriteStream({
          resumable: false,
          metadata: { contentType: m.mime },
          preconditionOpts: { ifGenerationMatch: 0 },
        }),
      );
    const [privateMetadata] = await privateFile.getMetadata();
    if (
      privateMetadata.metadata?.firebaseStorageDownloadTokens ||
      Number(privateMetadata.size) !== m.size ||
      privateMetadata.contentType !== m.mime
    )
      throw new HttpError(
        500,
        "Não foi possível proteger a mídia. Tente novamente.",
      );
    await db
      .doc(`${base}/media/${m.id}`)
      .set({ ...m, path, private: true, createdAt: new Date().toISOString() });
    await file.delete({ ignoreNotFound: true });
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
  if (
    resource === "followers" &&
    id === "claim-legacy" &&
    req.method === "POST"
  ) {
    const input = z
      .object({ accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
      .parse(await json(req));
    await accountAccess(ws, input.accountId);
    await db.runTransaction(async (tx) => {
      const workspace = await tx.get(db.doc(base));
      const [legacy, target] = await Promise.all([
        tx.get(db.doc(`${base}/settings/followers`)),
        tx.get(db.doc(`${base}/followers/${input.accountId}`)),
      ]);
      if (workspace.data()?.legacyFollowersAccountId)
        throw new HttpError(
          409,
          "A lista anterior já foi vinculada a uma conta.",
        );
      if (!legacy.exists)
        throw new HttpError(404, "Nenhuma lista anterior encontrada.");
      if (target.exists)
        throw new HttpError(
          409,
          "Essa conta já possui uma lista. Faça backup antes de combinar os dados.",
        );
      tx.set(db.doc(`${base}/followers/${input.accountId}`), legacy.data()!);
      tx.update(db.doc(base), { legacyFollowersAccountId: input.accountId });
    });
    return Response.json({ ok: true });
  }
  if (resource === "followers" && id === "changes" && req.method === "GET") {
    const accountId = req.headers.get("x-instagram-account-id");
    if (accountId && !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) throw new HttpError(400, "Conta inválida.");
    const [workspace, accounts, legacy] = await Promise.all([
      db.doc(base).get(), db.collection(`${base}/accounts`).get(), db.doc(`${base}/settings/followers`).get(),
    ]);
    const owner = workspace.data()?.legacyFollowersAccountId ?? (accounts.size === 1 ? accounts.docs[0].id : null);
    const path = accountId && !(legacy.exists && owner === accountId) ? `${base}/followers/${accountId}` : `${base}/settings/followers`;
    const collection = db.doc(path).collection("changes");
    const cursor = new URL(req.url).searchParams.get("cursor");
    let query = collection.orderBy("at", "desc").orderBy("__name__", "desc").limit(2);
    if (cursor) {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(cursor)) throw new HttpError(400, "Página inválida.");
      const previous = await collection.doc(cursor).get();
      if (!previous.exists) throw new HttpError(400, "Página não encontrada.");
      query = query.startAfter(previous);
    }
    const result = await query.get();
    const first = result.docs[0];
    return Response.json({ comparisons: first ? [{ ...first.data(), id: first.id }] : [], cursor: result.size > 1 ? first.id : null });
  }
  if (resource === "followers" && req.method === "PUT") {
    const input = followerSchema.parse(await json(req));
    const importing = id === "import";
    if (importing && (!input.source || input.source.followers !== input.followers.length || input.source.following !== input.following.length))
      throw new HttpError(400, "Importe as duas listas para registrar a comparação.");
    const accountId = req.headers.get("x-instagram-account-id");
    if (accountId) await accountAccess(ws, accountId);
    else {
      const accounts = await db.collection(`${base}/accounts`).limit(1).get();
      if (!accounts.empty)
        throw new HttpError(
          400,
          "Selecione a conta dos seguidores antes de salvar.",
        );
    }
    const ref = db.doc(
      accountId
        ? `${base}/followers/${accountId}`
        : `${base}/settings/followers`,
    );
    await db.runTransaction(async (t) => {
      const workspace = await t.get(db.doc(base));
      const accounts = await t.get(db.collection(`${base}/accounts`));
      const [snapshot, legacy] = await Promise.all([
        t.get(ref),
        t.get(db.doc(`${base}/settings/followers`)),
      ]);
      const owner =
        workspace.data()?.legacyFollowersAccountId ??
        (accounts.size === 1 ? accounts.docs[0].id : null);
      if (
        accountId &&
        owner === accountId &&
        !workspace.data()?.legacyFollowersAccountId &&
        legacy.exists
      )
        t.update(db.doc(base), { legacyFollowersAccountId: owner });
      if (
        accountId &&
        !activeAccountIds(
          subscriptionOf(workspace.data()),
          accounts.docs.map(
            (doc) => ({ ...doc.data(), id: doc.id }) as Account,
          ),
        ).includes(accountId)
      )
        throw new HttpError(403, "Esta conta está pausada no seu plano.");
      const old =
        snapshot.data() ?? (owner === accountId ? legacy.data() : undefined);
      if (
        JSON.stringify(old?.followers ?? []) !==
          JSON.stringify(input.followers) ||
        JSON.stringify(old?.following ?? []) !== JSON.stringify(input.following)
      )
        t.set(db.collection(`${base}/snapshots`).doc(), {
          at: new Date().toISOString(),
          accountId: accountId ?? null,
          followers: old?.followers ?? [],
          following: old?.following ?? [],
          source: old?.source ?? null,
        });
      if (importing) {
        const at = new Date().toISOString();
        const comparison = compareFollowerImports(old as Followers | undefined, input, at);
        const batchId = randomUUID();
        for (const [index, chunk] of comparisonChunks(comparison).entries())
          t.set((legacy.exists && owner === accountId ? db.doc(`${base}/settings/followers`) : ref).collection("changes").doc(`${batchId}_${String(999 - index).padStart(3, "0")}`), chunk);
        input.source = { ...input.source!, updated: at };
      }
      t.set(ref, input);
    });
    await audit("followers_updated", accountId ?? "legacy");
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
