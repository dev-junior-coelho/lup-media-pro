import { firebaseClient } from "./firebase-client";
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
  workspace?: string,
): Promise<T> {
  const client = firebaseClient(),
    user = client?.auth.currentUser;
  if (!user) throw Error("Faça login para continuar.");
  const token = await user.getIdToken();
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-workspace-id": workspace || user.uid,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const d = await response.json();
    throw Error(d.error ?? "Falha na requisição.");
  }
  return response.json();
}
export async function mediaBlob(id: string, workspace: string) {
  const token = await firebaseClient()!.auth.currentUser!.getIdToken();
  const r = await fetch(`/api/media/${id}`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": workspace },
  });
  if (!r.ok) throw Error("Falha ao carregar mídia.");
  return URL.createObjectURL(await r.blob());
}
