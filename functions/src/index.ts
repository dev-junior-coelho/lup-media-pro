import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { runScheduler, renewAccounts } from "../../lib/server/worker";
const encryption = defineSecret("TOKEN_ENCRYPTION_KEY");
export const publishScheduled = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    region: "southamerica-east1",
    timeoutSeconds: 300,
    memory: "512MiB",
    maxInstances: 1,
    secrets: [encryption],
  },
  async () => {
    process.env.TOKEN_ENCRYPTION_KEY = encryption.value();
    const result = await runScheduler();
    console.info("scheduler", result);
  },
);
export const refreshInstagramTokens = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "UTC",
    region: "southamerica-east1",
    secrets: [encryption],
  },
  async () => {
    process.env.TOKEN_ENCRYPTION_KEY = encryption.value();
    await renewAccounts();
  },
);
