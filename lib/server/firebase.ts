import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
export function admin() {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw Error("Firebase não configurado.");
  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET ??
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      credential: applicationDefault(),
    });
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    bucket: getStorage(app).bucket(),
  };
}
export function workspacePath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error("Workspace inválido");
  return `workspaces/${id}`;
}
