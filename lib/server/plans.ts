import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { Account } from "../shared/schema";
import { activeAccountIds, plans, subscriptionOf } from "../shared/plans";
import { admin, workspacePath } from "./firebase";
import { HttpError } from "./security";

export async function accountAccess(ws: string, accountId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(accountId))
    throw new HttpError(400, "Selecione uma conta do Instagram.");
  const { db } = admin();
  const base = workspacePath(ws);
  const [workspace, snapshot] = await Promise.all([
    db.doc(base).get(),
    db.collection(`${base}/accounts`).get(),
  ]);
  const accounts = snapshot.docs.map(
    (doc) => ({ ...doc.data(), id: doc.id }) as Account,
  );
  if (!accounts.some((account) => account.id === accountId))
    throw new HttpError(404, "Conta não encontrada neste perfil.");
  if (
    !activeAccountIds(subscriptionOf(workspace.data()), accounts).includes(
      accountId,
    )
  )
    throw new HttpError(
      403,
      "Esta conta está pausada no seu plano. Gerencie as contas em Plano e contas.",
    );
}

/** All slot changes serialize on the workspace document, including simultaneous callbacks. */
export async function connectAccount(
  db: Firestore,
  ws: string,
  account: Account,
  token: string,
  uid: string,
) {
  const base = workspacePath(ws);
  await db.runTransaction(async (tx) => {
    const workspace = await tx.get(db.doc(base));
    const snapshot = await tx.get(db.collection(`${base}/accounts`));
    const [legacy, target] = await Promise.all([
      tx.get(db.doc(`${base}/settings/followers`)),
      tx.get(db.doc(`${base}/followers/${account.id}`)),
    ]);
    const accounts = snapshot.docs.map(
      (doc) => ({ ...doc.data(), id: doc.id }) as Account,
    );
    const subscription = subscriptionOf(workspace.data());
    if (subscription.status === "suspended")
      throw new HttpError(
        403,
        "A assinatura está suspensa. Entre em contato com o administrador.",
      );
    const active = activeAccountIds(subscription, accounts);
    if (
      !active.includes(account.id) &&
      active.length >= plans[subscription.plan].accountLimit
    )
      throw new HttpError(
        403,
        `Seu plano ${plans[subscription.plan].name} permite ${plans[subscription.plan].accountLimit} conta(s). Reconecte uma conta ativa ou altere o plano.`,
      );
    const ids = [...new Set([...active, account.id])];
    const legacyOwner = workspace.data()?.legacyFollowersAccountId;
    // An existing legacy list belongs to the sole previous account; never copy it to every new account.
    const previousOwner =
      accounts.length === 1
        ? accounts[0].id
        : accounts.length === 0
          ? account.id
          : null;
    tx.set(
      db.doc(base),
      {
        subscription: { ...subscription, activeAccountIds: ids },
        subscriptionRevision:
          Number(workspace.data()?.subscriptionRevision ?? 0) + 1,
        ...(!legacyOwner && previousOwner
          ? { legacyFollowersAccountId: previousOwner }
          : {}),
      },
      { merge: true },
    );
    if (
      !legacyOwner &&
      previousOwner === account.id &&
      legacy.exists &&
      !target.exists
    )
      tx.set(db.doc(`${base}/followers/${account.id}`), legacy.data()!);
    tx.set(db.doc(`${base}/accounts/${account.id}`), account);
    tx.set(db.doc(`${base}/secrets/${account.id}`), {
      token,
      createdAt: new Date().toISOString(),
    });
    tx.set(db.collection(`${base}/audit`).doc(), {
      action: "instagram_connected",
      uid,
      accountId: account.id,
      at: new Date().toISOString(),
    });
  });
}

export async function readPlanContext(
  tx: Transaction,
  db: Firestore,
  base: string,
) {
  const workspace = await tx.get(db.doc(base));
  const snapshot = await tx.get(db.collection(`${base}/accounts`));
  const accounts = snapshot.docs.map(
    (doc) => ({ ...doc.data(), id: doc.id }) as Account,
  );
  return {
    workspace,
    accounts,
    subscription: subscriptionOf(workspace.data()),
  };
}
