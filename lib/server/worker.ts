import { randomUUID } from "node:crypto";
import type { Post, Media, Account } from "../shared/schema";
import { validatePublication } from "../shared/schema";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { readPlanContext } from "./plans";
import { activeAccountIds, subscriptionOf } from "../shared/plans";
import { admin } from "./firebase";
import { decrypt } from "./security";
import { MetaClient, MetaError, refreshToken } from "./meta";
export interface PublishingClient {
  create(id: string, p: Record<string, string>): Promise<{ id: string }>;
  status(id: string): Promise<{ status_code: string }>;
  publish(id: string, c: string): Promise<{ id: string }>;
  limit(id: string): Promise<{
    data: { quota_usage: number; config: { quota_total: number } }[];
  }>;
  media(id: string): Promise<{ id: string; permalink?: string }>;
}
export interface JobStore {
  claim(): Promise<Post | null>;
  save(p: Partial<Post>): Promise<void>;
  account(id: string): Promise<Account & { token: string }>;
  media(ids: string[]): Promise<(Media & { url: string })[]>;
  invalidateAccount?(id: string): Promise<void>;
}
export async function processJob(
  store: JobStore,
  factory: (token: string) => PublishingClient = (t) => new MetaClient(t),
  now = Date.now(),
) {
  const post = await store.claim();
  if (!post) return;
  let publishing = false;
  const save = (patch: Partial<Post>) =>
    store.save({
      ...patch,
      leaseUntil: new Date(0).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
  try {
    const account = await store.account(post.accountId);
    const client = factory(account.token);
    if (post.phase === "publishing" || post.uncertain) {
      if (!post.containerId)
        throw Error("Contêiner ausente para reconciliação.");
      const result = await client.status(post.containerId);
      if (result.status_code === "PUBLISHED") {
        await save({
          status: "published",
          uncertain: false,
          error: "",
          publishedAt: new Date(now).toISOString(),
          phase: "complete",
        });
        return;
      }
      await save({
        status: "failed",
        uncertain: true,
        error:
          "Resultado de publicação incerto. Verifique no Instagram antes de qualquer nova tentativa.",
      });
      return;
    }
    const media = await store.media(post.mediaIds);
    validatePublication({ ...post, intent: "now" }, media, account, now);
    const limit = await client.limit(account.id);
    const quota = limit.data[0];
    if (quota && quota.quota_usage >= quota.config.quota_total) {
      await save({
        status: "scheduled",
        nextAttemptAt: new Date(now + 3600000).toISOString(),
        error: "Limite de publicação atingido.",
      });
      return;
    }
    if (!post.containerId) {
      if (
        post.type === "carousel" &&
        (post.childIds ?? []).length < media.length
      ) {
        const index = (post.childIds ?? []).length;
        const child = await client.create(account.id, {
          image_url: media[index].url,
          is_carousel_item: "true",
        });
        await save({
          status: "processing",
          childIds: [...(post.childIds ?? []), child.id],
          phase: "children",
        });
        return;
      }
      if (post.type === "carousel") {
        for (const child of post.childIds ?? []) {
          const status = await client.status(child);
          if (
            status.status_code === "ERROR" ||
            status.status_code === "EXPIRED"
          )
            throw Error("Falha ao processar imagem do carrossel.");
          if (status.status_code !== "FINISHED") {
            await save({
              status: "processing",
              nextAttemptAt: new Date(now + 60000).toISOString(),
            });
            return;
          }
        }
      }
      const params: Record<string, string> = { caption: post.caption };
      if (post.type === "carousel") {
        params.media_type = "CAROUSEL";
        params.children = (post.childIds ?? []).join(",");
      } else if (post.type === "reel") {
        params.media_type = "REELS";
        params.video_url = media[0].url;
      } else if (post.type === "story") {
        delete params.caption;
        params.media_type = "STORIES";
        params[media[0].mime.startsWith("video/") ? "video_url" : "image_url"] =
          media[0].url;
      } else params.image_url = media[0].url;
      const c = await client.create(account.id, params);
      await save({
        containerId: c.id,
        containerCreatedAt: new Date(now).toISOString(),
        status: "processing",
        phase: "container",
        nextAttemptAt: new Date(now + 60000).toISOString(),
      });
      return;
    }
    const result = await client.status(post.containerId);
    if (result.status_code === "PUBLISHED") {
      await save({
        status: "published",
        phase: "complete",
        publishedAt: new Date(now).toISOString(),
      });
      return;
    }
    if (["ERROR", "EXPIRED"].includes(result.status_code))
      throw Error("Contêiner recusado ou expirado pela Meta.");
    if (result.status_code !== "FINISHED") {
      if (
        now - Date.parse(post.containerCreatedAt ?? post.createdAt) >
        24 * 3600000
      )
        throw Error("Processamento excedeu prazo do contêiner.");
      await save({
        status: "processing",
        nextAttemptAt: new Date(now + 60000).toISOString(),
      });
      return;
    }
    // Persist before sending: crash or timeout after dispatch always reconciles instead of republishing.
    await store.save({
      phase: "publishing",
      uncertain: true,
      updatedAt: new Date(now).toISOString(),
    });
    publishing = true;
    const published = await client.publish(account.id, post.containerId);
    await save({
      status: "published",
      instagramId: published.id,
      phase: "complete",
      uncertain: false,
      error: "",
      publishedAt: new Date(now).toISOString(),
    });
    try {
      const detail = await client.media(published.id);
      await store.save({ permalink: detail.permalink ?? "" });
    } catch {
      /* Publication was confirmed. Permalink can be fetched separately. */
    }
  } catch (e) {
    const meta = e instanceof MetaError ? e : null;
    const attempts = (post.attempts ?? 0) + 1;
    const uncertain = publishing || Boolean(meta?.uncertain);
    if (meta?.code === 190) {
      await store.invalidateAccount?.(post.accountId);
    }
    await save({
      status: uncertain
        ? "processing"
        : meta?.transient && attempts < 5
          ? "scheduled"
          : "failed",
      uncertain,
      attempts,
      error:
        meta?.code === 190
          ? "Token expirado ou revogado. Reconecte a conta."
          : e instanceof Error
            ? e.message
            : "Falha no processamento.",
      nextAttemptAt: new Date(
        now + Math.min(3600000, 60000 * 2 ** attempts),
      ).toISOString(),
    });
  }
}
export function firestoreStore(path: string): JobStore {
  const { db, bucket } = admin();
  const ref = db.doc(path);
  let revision = -1,
    leaseId = "";
  return {
    async claim() {
      return db.runTransaction(async (t) => {
        const context = await readPlanContext(t, db, ref.parent.parent!.path);
        const s = await t.get(ref);
        if (!s.exists) return null;
        const p = s.data() as Post;
        const now = Date.now();
        if (
          !["scheduled", "processing"].includes(p.status) ||
          Date.parse(p.scheduledAt ?? "9999-01-01") > now ||
          Date.parse(p.nextAttemptAt ?? "1970-01-01") > now ||
          Date.parse(p.leaseUntil ?? "1970-01-01") > now
        )
          return null;
        if (
          !activeAccountIds(context.subscription, context.accounts).includes(
            p.accountId,
          ) &&
          !p.uncertain &&
          p.phase !== "publishing"
        )
          return null;
        revision = p.revision;
        leaseId = randomUUID();
        t.update(ref, {
          leaseId,
          status: "processing",
          leaseUntil: new Date(now + 120000).toISOString(),
        });
        if (p.status !== "processing")
          t.set(db.collection(`${ref.parent.parent!.path}/history`).doc(), {
            postId: ref.id,
            accountId: p.accountId,
            caption: p.caption,
            status: "processing",
            at: new Date(now).toISOString(),
          });
        return { ...p, id: ref.id };
      });
    },
    async save(patch) {
      await db.runTransaction(async (t) => {
        const s = await t.get(ref);
        if (s.data()?.revision !== revision || s.data()?.leaseId !== leaseId)
          throw Error("Lease ou revisão do job mudou.");
        t.update(ref, patch);
        if (patch.status)
          t.set(
            db.doc(`${ref.parent.parent!.path}/jobs/${ref.id}`),
            {
              status: patch.status,
              updatedAt: patch.updatedAt ?? new Date().toISOString(),
            },
            { merge: true },
          );
        const previous = s.data()!;
        if (
          (patch.status && patch.status !== previous.status) ||
          (patch.error && patch.error !== previous.error)
        )
          t.set(db.collection(`${ref.parent.parent!.path}/history`).doc(), {
            postId: ref.id,
            accountId: previous.accountId ?? "",
            caption: previous.caption ?? "",
            status: patch.status ?? previous.status,
            ...(patch.error ? { error: patch.error } : {}),
            at: new Date().toISOString(),
          });
      });
    },
    async invalidateAccount(id) {
      await db
        .doc(`${ref.parent.parent!.path}/accounts/${id}`)
        .update({ status: "reconnect_required" });
    },
    async account(id) {
      const ws = ref.parent.parent!.path;
      const pub = await db.doc(`${ws}/accounts/${id}`).get(),
        secret = await db.doc(`${ws}/secrets/${id}`).get();
      if (!pub.exists || !secret.exists)
        throw Error("Reconecte sua conta Instagram.");
      return {
        ...(pub.data() as Account),
        id,
        token: decrypt(secret.data()!.token),
      };
    },
    async media(ids) {
      const ws = ref.parent.parent!.path;
      return Promise.all(
        ids.map(async (id) => {
          const d = await db.doc(`${ws}/media/${id}`).get();
          if (!d.exists) throw Error("Mídia ausente.");
          const m = d.data() as Media;
          const [url] = await bucket.file(m.path).getSignedUrl({
            action: "read",
            expires: Date.now() + 2 * 3600000,
          });
          return { ...m, id, url };
        }),
      );
    },
  };
}
export async function runScheduler() {
  const db = admin().db;
  const query = db
    .collectionGroup("posts")
    .where("status", "in", ["scheduled", "processing"])
    .where("scheduledAt", "<=", new Date().toISOString())
    .orderBy("scheduledAt");
  const eligible: QueryDocumentSnapshot[] = [];
  const access = new Map<string, Promise<string[]>>();
  let cursor: QueryDocumentSnapshot | undefined;
  let scanned = 0;
  while (eligible.length < 50) {
    const page = await (cursor ? query.startAfter(cursor) : query)
      .limit(100)
      .get();
    if (page.empty) break;
    for (const doc of page.docs) {
      scanned++;
      const base = doc.ref.parent.parent!.path;
      if (!access.has(base))
        access.set(
          base,
          Promise.all([
            db.doc(base).get(),
            db.collection(`${base}/accounts`).get(),
          ]).then(([workspace, accounts]) =>
            activeAccountIds(
              subscriptionOf(workspace.data()),
              accounts.docs.map(
                (account) => ({ ...account.data(), id: account.id }) as Account,
              ),
            ),
          ),
        );
      const post = doc.data() as Post;
      if (
        Date.parse(post.nextAttemptAt ?? "1970-01-01") > Date.now() ||
        Date.parse(post.leaseUntil ?? "1970-01-01") > Date.now()
      )
        continue;
      if (
        (await access.get(base))!.includes(post.accountId) ||
        post.uncertain ||
        post.phase === "publishing"
      )
        eligible.push(doc);
      if (eligible.length >= 50) break;
    }
    if (page.size < 100) break;
    cursor = page.docs.at(-1);
  }
  const results = await Promise.allSettled(
    eligible.map((doc) => processJob(firestoreStore(doc.ref.path))),
  );
  return {
    scanned,
    errors: results.filter((result) => result.status === "rejected").length,
  };
}
export async function renewAccounts() {
  const db = admin().db;
  const accounts = await db
    .collectionGroup("accounts")
    .where("status", "==", "connected")
    .where("expiresAt", "<=", new Date(Date.now() + 7 * 86400000).toISOString())
    .limit(100)
    .get();
  for (const a of accounts.docs) {
    const secret = db.doc(`${a.ref.parent.parent!.path}/secrets/${a.id}`);
    try {
      const raw = (await secret.get()).data();
      if (!raw) continue;
      const value = await refreshToken(decrypt(raw.token));
      const { encrypt } = await import("./security");
      await secret.update({ token: encrypt(value.access_token) });
      await a.ref.update({
        expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString(),
      });
    } catch {
      await a.ref.update({ status: "reconnect_required" });
    }
  }
}
