import { defineConfig, devices } from "@playwright/test";
const emulator = process.env.LUP_E2E_EMULATORS === "true";
const env: Record<string, string> = emulator
  ? {
      APP_ORIGIN: "http://127.0.0.1:3000",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-lup-media-pro",
      NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-lup-media-pro.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-lup-media-pro.appspot.com",
      NEXT_PUBLIC_FIREBASE_APP_ID: "demo-app",
      NEXT_PUBLIC_USE_EMULATORS: "true",
      GOOGLE_CLOUD_PROJECT: "demo-lup-media-pro",
      FIREBASE_STORAGE_BUCKET: "demo-lup-media-pro.appspot.com",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
    }
  : {};
Object.assign(process.env, env);
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120000,
    env,
  },
});
