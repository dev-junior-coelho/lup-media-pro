import { firebaseClient } from "./firebase-client";
async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("O servidor demorou para responder. Tente novamente."));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
  workspace?: string,
  accountId?: string,
): Promise<T> {
  return withDeadline(
    async (signal) => {
      const client = firebaseClient(),
        user = client?.auth.currentUser;
      if (!user) throw Error("Faça login para continuar.");
      const token = await user.getIdToken();
      const response = await fetch(`/api/${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-workspace-id": workspace || user.uid,
          ...(accountId ? { "x-instagram-account-id": accountId } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (!response.ok) {
        const d = await response.json().catch(() => null);
        throw Error(
          typeof d?.error === "string"
            ? d.error
            : "Não foi possível concluir a operação. Tente novamente.",
        );
      }
      return response.json();
    },
    path === "posts/restore" || (path === "media" && method === "POST")
      ? 120000
      : 20000,
  );
}
export async function mediaBlob(id: string, workspace: string) {
  return withDeadline(async (signal) => {
    const user = firebaseClient()?.auth.currentUser;
    if (!user) throw Error("Faça login para continuar.");
    const token = await user.getIdToken();
    const r = await fetch(`/api/media/${id}`, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "x-workspace-id": workspace,
      },
    });
    if (!r.ok) throw Error("Falha ao carregar mídia.");
    return URL.createObjectURL(await r.blob());
  }, 120000);
}
