import type { Firestore } from "firebase-admin/firestore";
import { planChangeSchema, type PlanChange } from "../shared/plan-management";
import { activeAccountIds, plans } from "../shared/plans";
import { workspacePath } from "./firebase";
import { readPlanContext } from "./plans";
import { HttpError } from "./security";
export interface PlanActor {
  uid: string;
  source: "platform-admin" | "owner" | "trusted-admin-cli";
}

/** All plan changes share account, suspension and concurrency checks. */
export async function changeSubscription(
  db: Firestore,
  ws: string,
  raw: PlanChange,
  actor: PlanActor,
) {
  const input = planChangeSchema.parse(raw);
  if (actor.source === "owner" && input.status !== "active")
    throw new HttpError(403, "Somente a administração pode suspender ou cancelar uma assinatura.");
  const base = workspacePath(ws);
  await db.runTransaction(async (tx) => {
    const context = await readPlanContext(tx, db, base);
    if (!context.workspace.exists)
      throw new HttpError(404, "Perfil não encontrado.");
    const current = context.workspace.data()!;
    const revision = Number(current.subscriptionRevision ?? 0);
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== revision
    )
      throw new HttpError(
        409,
        "O plano deste cliente mudou. Atualize a lista antes de salvar.",
      );
    if (actor.source === "owner" && context.subscription.status === "suspended")
      throw new HttpError(
        403,
        "Somente o administrador pode reativar uma assinatura suspensa.",
      );
    if (
      actor.source === "owner" && input.plan === "pro" &&
      context.subscription.plan === "pro" && context.subscription.status === "active"
    ) return;
    const effectivePlan =
      input.status === "cancelled" ? "essential" : input.plan;
    const ids = input.status === "suspended" ? [] :
      actor.source === "owner" && input.plan === "pro"
        ? activeAccountIds(context.subscription, context.accounts)
        : input.activeAccountIds;
    if (input.status === "suspended" && input.activeAccountIds.length)
      throw new HttpError(
        400,
        "Uma assinatura suspensa não pode ter contas ativas.",
      );
    if (ids.length > plans[effectivePlan].accountLimit)
      throw new HttpError(
        400,
        "A seleção de contas ultrapassa o limite do plano.",
      );
    const available = context.accounts.filter(
      (account) => account.status !== "disconnected",
    );
    if (ids.some((id) => !available.some((account) => account.id === id)))
      throw new HttpError(
        400,
        "Uma das contas está desconectada ou não pertence a este cliente.",
      );
    if (input.status !== "suspended" && available.length && !ids.length)
      throw new HttpError(
        400,
        "Escolha pelo menos uma conta para continuar ativa.",
      );
    const posts = await tx.get(db.collection(`${base}/posts`));
    const request = await tx.get(db.doc(`planRequests/${ws}`));
    if (
      posts.docs.some(
        (post) =>
          !ids.includes(post.data().accountId) &&
          (post.data().status === "processing" || post.data().uncertain),
      )
    )
      throw new HttpError(
        409,
        "Aguarde ou reconcilie os envios em andamento antes de pausar essas contas.",
      );
    const pending =
      request.data()?.status === "pending" ||
      (!request.exists &&
        current.subscription?.requestedPlan === "pro" &&
        !["approved", "declined"].includes(
          current.subscription?.requestStatus,
        ));
    const currentRequestId = request.data()?.id ?? `legacy-${ws}`;
    if (input.requestId && (!pending || currentRequestId !== input.requestId))
      throw new HttpError(
        409,
        "A solicitação deste cliente mudou. Atualize a lista.",
      );
    const now = new Date().toISOString();
    const approved =
      input.plan === "pro" && input.status === "active" && pending;
    const subscription = {
      plan: input.plan,
      status: input.status,
      activeAccountIds: ids,
      updatedAt: now,
      activationSource: actor.source,
      ...(approved
        ? { requestStatus: "approved" }
        : current.subscription?.requestedPlan
          ? {
              requestedPlan: current.subscription.requestedPlan,
              requestedAt: current.subscription.requestedAt ?? now,
              ...(current.subscription.requestStatus
                ? { requestStatus: current.subscription.requestStatus }
                : {}),
              ...(current.subscription.requestMessage
                ? { requestMessage: current.subscription.requestMessage }
                : {}),
            }
          : {}),
    };
    tx.update(db.doc(base), {
      subscription,
      subscriptionRevision: revision + 1,
      ...(actor.source === "owner" && context.subscription.plan !== input.plan
        ? { lastPlanMigration: {
            from: context.subscription.plan, to: input.plan,
            at: now, source: "owner", uid: actor.uid,
          } }
        : {}),
    });
    if (approved)
      tx.set(
        db.doc(`planRequests/${ws}`),
        {
          id: currentRequestId,
          workspaceId: ws,
          status: "approved",
          createdAt:
            request.data()?.createdAt ??
            current.subscription?.requestedAt ??
            now,
          resolvedAt: now,
          resolvedBy: actor.uid,
          message: "Plano Pro ativado.",
        },
        { merge: true },
      );
    const audit = {
      action: "subscription_changed",
      plan: input.plan,
      status: input.status,
      accountIds: ids,
      previousPlan: current.subscription?.plan ?? "essential",
      previousStatus: context.subscription.status,
      uid: actor.uid,
      source: actor.source,
      reason: input.reason,
      at: now,
      revision: revision + 1,
    };
    const { reason, ...publicAudit } = audit;
    void reason;
    tx.set(db.collection(`${base}/audit`).doc(), publicAudit);
    tx.set(db.collection("planAudit").doc(), { ...audit, workspaceId: ws });
  });
}
/** Compatibility endpoint: old requests now activate immediately, without payment. */
export async function requestPro(db: Firestore, ws: string, uid: string) {
  await changeSubscription(db, ws, {
    plan: "pro", status: "active", activeAccountIds: [],
    reason: "Cliente migrou automaticamente para o Pro. Nenhuma cobrança realizada.",
  }, { uid, source: "owner" });
}
export async function declineRequest(
  db: Firestore,
  ws: string,
  requestId: string,
  message: string,
  actorUid: string,
) {
  const base = workspacePath(ws);
  await db.runTransaction(async (tx) => {
    const workspace = await tx.get(db.doc(base));
    const request = await tx.get(db.doc(`planRequests/${ws}`));
    const legacy =
      !request.exists &&
      workspace.data()?.subscription?.requestedPlan === "pro" &&
      !["declined", "approved"].includes(
        workspace.data()?.subscription?.requestStatus,
      );
    if (
      !(legacy && requestId === `legacy-${ws}`) &&
      (request.data()?.status !== "pending" || request.data()?.id !== requestId)
    )
      throw new HttpError(
        409,
        "Essa solicitação já foi resolvida ou substituída. Atualize a lista.",
      );
    const now = new Date().toISOString();
    tx.set(
      db.doc(`planRequests/${ws}`),
      {
        id: requestId,
        workspaceId: ws,
        status: "declined",
        createdAt:
          request.data()?.createdAt ??
          workspace.data()?.subscription?.requestedAt ??
          now,
        message,
        resolvedAt: now,
        resolvedBy: actorUid,
      },
      { merge: true },
    );
    tx.update(db.doc(base), {
      "subscription.requestStatus": "declined",
      "subscription.requestMessage": message,
    });
    tx.set(db.collection("planAudit").doc(), {
      action: "pro_declined",
      workspaceId: ws,
      uid: actorUid,
      reason: message,
      at: now,
    });
  });
}

export async function syncLegacyPlanRequests(db: Firestore) {
  const candidates = await db
    .collection("workspaces")
    .where("subscription.requestedPlan", "==", "pro")
    .get();
  for (const candidate of candidates.docs) {
    await db.runTransaction(async (tx) => {
      const workspace = await tx.get(candidate.ref);
      const request = await tx.get(db.doc(`planRequests/${candidate.id}`));
      const raw = workspace.data();
      if (
        !raw ||
        request.exists ||
        raw.subscription?.requestedPlan !== "pro" ||
        ["approved", "declined"].includes(raw.subscription?.requestStatus) ||
        (raw.subscription?.plan === "pro" &&
          raw.subscription?.status === "active")
      )
        return;
      tx.set(db.doc(`planRequests/${candidate.id}`), {
        id: `legacy-${candidate.id}`,
        workspaceId: candidate.id,
        requestedBy: raw.ownerUid ?? candidate.id,
        status: "pending",
        plan: "pro",
        createdAt: raw.subscription.requestedAt ?? new Date().toISOString(),
      });
    });
  }
}
