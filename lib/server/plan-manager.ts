import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";
import { admin, workspacePath } from "./firebase";
import { identity, HttpError, rateLimit } from "./security";
import { changeSubscription, declineRequest } from "./subscriptions";
import { activeAccountIds, subscriptionOf } from "../shared/plans";
import {
  catalogOf,
  catalogSchema,
  planChangeSchema,
  type ManagedProfile,
} from "../shared/plan-management";
import type { Account } from "../shared/schema";
export async function requirePlatformAdmin(req: Request) {
  const user = await identity(req);
  if (user.platformAdmin !== true)
    throw new HttpError(403, "Acesso restrito à administração da plataforma.");
  const fresh = await admin().auth.getUser(user.uid);
  if (fresh.disabled || fresh.customClaims?.platformAdmin !== true)
    throw new HttpError(
      403,
      "Seu acesso administrativo não está ativo. Entre novamente.",
    );
  return user.uid;
}
async function body(req: Request) {
  const text = await req.text();
  if (Buffer.byteLength(text) > 20000)
    throw new HttpError(413, "Dados excedem o limite.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Dados inválidos. Confira o formulário.");
  }
}
async function profile(ws: string): Promise<ManagedProfile> {
  const { db, auth } = admin();
  const base = workspacePath(ws);
  const [workspace, accounts, request] = await Promise.all([
    db.doc(base).get(),
    db.collection(`${base}/accounts`).get(),
    db.doc(`planRequests/${ws}`).get(),
  ]);
  if (!workspace.exists) throw new HttpError(404, "Perfil não encontrado.");
  const raw = workspace.data()!;
  const owner = await auth
    .getUser(raw.ownerUid ?? ws)
    .catch((error: { code?: string }) => {
      if (error.code === "auth/user-not-found") return null;
      throw error;
    });
  const subscription = subscriptionOf(raw);
  const list = accounts.docs.map(
    (doc) => ({ ...doc.data(), id: doc.id }) as Account,
  );
  const active = activeAccountIds(subscription, list);
  const pendingLegacy =
    !request.exists &&
    raw.subscription?.requestedPlan === "pro" &&
    !["declined", "approved"].includes(raw.subscription?.requestStatus);
  const requested = request.data();
  return {
    id: ws,
    name: raw.name ?? "Perfil sem nome",
    ownerName: owner?.displayName ?? "",
    email: owner?.email ?? "Titular não encontrado",
    assignedPlan: raw.subscription?.plan === "pro" ? "pro" : "essential",
    subscription,
    ...(raw.lastPlanMigration ? { lastPlanMigration: raw.lastPlanMigration } : {}),
    revision: Number(raw.subscriptionRevision ?? 0),
    accounts: list.map((account) => ({
      id: account.id,
      username: account.username,
      status: account.status,
      accountType: account.accountType ?? "",
      expiresAt: account.expiresAt ?? "",
      permissions: [],
      planPaused: !active.includes(account.id),
    })),
    request: requested
      ? {
          id: requested.id,
          status: requested.status,
          createdAt: requested.createdAt,
          ...(requested.message ? { message: requested.message } : {}),
        }
      : pendingLegacy
        ? {
            id: `legacy-${ws}`,
            status: "pending",
            createdAt: raw.subscription.requestedAt ?? "",
          }
        : null,
  };
}
export async function planManagerApi(req: Request, path: string[]) {
  const uid = await requirePlatformAdmin(req);
  const { db, auth } = admin();
  if (req.method !== "GET") await rateLimit(uid, "plan-admin", 60);
  const [resource, id, action] = path;
  if (resource === "plan-manager" && req.method === "GET" && !id) {
    const url = new URL(req.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const pending = url.searchParams.get("view") === "requests";
    const cursor = url.searchParams.get("cursor");
    if (cursor) workspacePath(cursor);
    const [total, requests, catalog, migrated] = await Promise.all([
      db.collection("workspaces").count().get(),
      db
        .collection("planRequests")
        .where("status", "==", "pending")
        .count()
        .get(),
      db.doc("commercialSettings/plans").get(),
      db.collection("workspaces").where("lastPlanMigration.source", "==", "owner").count().get(),
    ]);
    let ids: string[] = [],
      nextCursor: string | null = null;
    if (search) {
      if (!z.string().email().safeParse(search).success)
        throw new HttpError(400, "Informe o e-mail completo do cliente.");
      const user = await auth
        .getUserByEmail(search)
        .catch((error: { code?: string }) => {
          if (error.code === "auth/user-not-found") return null;
          throw error;
        });
      if (user) {
        const mapping = await db.doc(`users/${user.uid}`).get();
        const ws = mapping.data()?.workspaceId ?? user.uid;
        if ((await db.doc(workspacePath(ws)).get()).exists) ids = [ws];
      }
    } else if (url.searchParams.get("view") === "migrations") {
      let query = db.collection("workspaces").orderBy("lastPlanMigration.at", "desc").limit(26);
      if (cursor) {
        const previous = await db.doc(workspacePath(cursor)).get();
        if (previous.exists) query = query.startAfter(previous);
      }
      const page = await query.get();
      ids = page.docs.slice(0, 25).map((doc) => doc.id);
      if (page.size > 25) nextCursor = ids.at(-1) ?? null;
    } else if (pending) {
      let query = db
        .collection("planRequests")
        .where("status", "==", "pending")
        .orderBy(FieldPath.documentId())
        .limit(26);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      ids = page.docs.slice(0, 25).map((doc) => doc.id);
      if (page.size > 25) nextCursor = ids.at(-1) ?? null;
    } else {
      let query = db
        .collection("workspaces")
        .orderBy(FieldPath.documentId())
        .limit(26);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      ids = page.docs.slice(0, 25).map((doc) => doc.id);
      if (page.size > 25) nextCursor = ids.at(-1) ?? null;
    }
    return Response.json({
      profiles: await Promise.all(ids.map(profile)),
      nextCursor,
      stats: {
        totalProfiles: total.data().count,
        pendingRequests: requests.data().count,
        migratedProfiles: migrated.data().count,
      },
      catalog: catalogOf(catalog.data()),
    });
  }
  if (resource === "subscriptions" && id && req.method === "PUT" && !action) {
    const input = planChangeSchema
      .extend({ expectedRevision: z.number().int().nonnegative() })
      .parse(await body(req));
    await changeSubscription(db, id, input, { uid, source: "platform-admin" });
    return Response.json({ profile: await profile(id) });
  }
  if (
    resource === "subscriptions" &&
    id &&
    action === "decline" &&
    req.method === "POST"
  ) {
    const input = z
      .object({
        requestId: z.string().min(1).max(200),
        message: z.string().trim().min(3).max(300),
      })
      .parse(await body(req));
    await declineRequest(db, id, input.requestId, input.message, uid);
    return Response.json({ profile: await profile(id) });
  }
  if (
    resource === "subscriptions" &&
    id &&
    action === "history" &&
    req.method === "GET"
  ) {
    workspacePath(id);
    const events = await db
      .collection("planAudit")
      .where("workspaceId", "==", id)
      .orderBy("at", "desc")
      .limit(30)
      .get();
    return Response.json({
      events: events.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  }
  if (resource === "plan-catalog" && req.method === "PUT" && !id) {
    const input = catalogSchema.parse(await body(req));
    await db.runTransaction(async (tx) => {
      const ref = db.doc("commercialSettings/plans");
      const previous = catalogOf((await tx.get(ref)).data());
      if (previous.revision !== input.revision)
        throw new HttpError(
          409,
          "Os preços foram alterados por outro administrador. Atualize antes de salvar.",
        );
      const now = new Date().toISOString();
      tx.set(ref, { ...input, revision: previous.revision + 1 });
      tx.set(db.collection("planAudit").doc(), {
        action: "catalog_updated",
        uid,
        at: now,
        previous,
        next: { ...input, revision: previous.revision + 1 },
      });
    });
    return Response.json({
      catalog: catalogOf(
        (await db.doc("commercialSettings/plans").get()).data(),
      ),
    });
  }
  throw new HttpError(404, "Recurso administrativo não encontrado.");
}
