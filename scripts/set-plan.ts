import nextEnv from "@next/env";
import { admin, workspacePath } from "../lib/server/firebase";
import { plans, type PlanId } from "../lib/shared/plans";
import { readPlanContext } from "../lib/server/plans";
import { changeSubscription } from "../lib/server/subscriptions";
nextEnv.loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
if (
  !args.includes("--workspace") ||
  !args.includes("--plan") ||
  !["essential", "pro"].includes(value("--plan"))
)
  throw Error(
    "Uso: npm run plan:set -- --workspace ID --plan pro|essential [--active ID1,ID2]",
  );
const plan = value("--plan") as PlanId;
const base = workspacePath(value("--workspace"));
const db = admin().db;
const selectedIds = await db.runTransaction(async (tx) => {
  const context = await readPlanContext(tx, db, base);
  if (!context.workspace.exists) throw Error("Perfil não encontrado.");
  const available = context.accounts.filter(
    (account) => account.status !== "disconnected",
  );
  return args.includes("--active")
    ? [...new Set(value("--active").split(",").filter(Boolean))]
    : available.map((account) => account.id);
});
await changeSubscription(
  db,
  value("--workspace"),
  {
    plan,
    status: "active",
    activeAccountIds: selectedIds,
    reason: "Ativação administrativa pela ferramenta de manutenção.",
  },
  { uid: "trusted-admin-cli", source: "trusted-admin-cli" },
);
console.log(`Plano ${plans[plan].name} aplicado ao perfil informado.`);
process.exit(0);
