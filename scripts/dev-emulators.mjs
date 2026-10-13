import { spawn } from "node:child_process";
const env = {
  ...process.env,
  APP_ORIGIN: "http://localhost:3000",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-lup-media-pro",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-lup-media-pro.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-lup-media-pro.appspot.com",
  NEXT_PUBLIC_FIREBASE_APP_ID: "demo-app",
  NEXT_PUBLIC_USE_EMULATORS: "true",
  GOOGLE_CLOUD_PROJECT: "demo-lup-media-pro",
  FIREBASE_STORAGE_BUCKET: "demo-lup-media-pro.appspot.com",
};
const child = spawn("npm", ["run", "dev"], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
