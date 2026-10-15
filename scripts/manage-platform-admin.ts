import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import { syncLegacyPlanRequests } from "../lib/server/subscriptions";
import { admin } from "../lib/server/firebase";
nextEnv.loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1];
const enabled = args.includes("--grant");
if (
  !args.includes("--email") ||
  !email?.includes("@") ||
  enabled === args.includes("--revoke")
)
  throw Error(
    "Uso: npm run admin:access -- --email EMAIL --grant|--revoke [--create-if-missing]",
  );
const { auth, db } = admin();
let user = await auth
  .getUserByEmail(email)
  .catch((error: { code?: string }) => {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  });
if (!user && enabled && args.includes("--create-if-missing"))
  user = await auth.createUser({
    email,
    displayName: "Administrador LUP",
    password: randomBytes(32).toString("base64url"),
  });
if (!user)
  throw Error(
    "Conta não encontrada. Cadastre o usuário ou use --create-if-missing para criar o acesso sem senha.",
  );
if (user.disabled && enabled)
  throw Error(
    "A conta está desabilitada. Verifique o cadastro antes de conceder acesso.",
  );
const claims = { ...user.customClaims };
if (enabled) claims.platformAdmin = true;
else delete claims.platformAdmin;
if (enabled) await syncLegacyPlanRequests(db);
await auth.setCustomUserClaims(user.uid, claims);
if (!enabled) await auth.revokeRefreshTokens(user.uid);
console.log(
  enabled
    ? "Acesso administrativo concedido. Entre novamente; se a conta não possui senha, use a recuperação de senha."
    : "Acesso administrativo revogado.",
);
process.exit(0);
