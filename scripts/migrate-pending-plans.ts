import nextEnv from "@next/env";
import { admin } from "../lib/server/firebase";
import { requestPro } from "../lib/server/subscriptions";
nextEnv.loadEnvConfig(process.cwd());
const { db } = admin();
const candidates = await db.collection("workspaces")
  .where("subscription.requestedPlan", "==", "pro").get();
let migrated = 0;
for (const candidate of candidates.docs) {
  const raw = candidate.data();
  if (["declined", "approved"].includes(raw.subscription?.requestStatus) ||
      raw.subscription?.status === "suspended" ||
      (raw.subscription?.plan === "pro" && raw.subscription?.status === "active")) continue;
  await requestPro(db, candidate.id, raw.ownerUid ?? candidate.id);
  migrated++;
}
console.log(`Solicitações antigas migradas automaticamente: ${migrated}.`);
