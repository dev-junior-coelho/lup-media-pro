import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  browserLocalPersistence,
  connectAuthEmulator,
} from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";
export function firebaseClient() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return null;
  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  const auth = initializeAuth(app, { persistence: browserLocalPersistence }),
    storage = getStorage(app);
  auth.languageCode = "pt-BR";
  storage.maxUploadRetryTime = 60000;
  if (
    process.env.NEXT_PUBLIC_USE_EMULATORS === "true" &&
    !(globalThis as { lupEmulators?: boolean }).lupEmulators
  ) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    (globalThis as { lupEmulators?: boolean }).lupEmulators = true;
  }
  return { auth, storage };
}
