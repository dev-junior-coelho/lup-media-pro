import { afterEach, expect, it, vi } from "vitest";
import { request, mediaBlob } from "../lib/client-api";
const user = vi.hoisted(() => ({ uid: "user", getIdToken: vi.fn() }));
vi.mock("../lib/firebase-client", () => ({
  firebaseClient: () => ({ auth: { currentUser: user } }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  user.getIdToken.mockReset();
});
it("envia o token e o workspace e retorna os dados", async () => {
  user.getIdToken.mockResolvedValue("token");
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ workspaceId: "workspace" }));
  vi.stubGlobal("fetch", fetch);
  await expect(request("bootstrap", "POST", {}, "workspace")).resolves.toEqual({
    workspaceId: "workspace",
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/bootstrap",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer token",
        "x-workspace-id": "workspace",
      }),
    }),
  );
});
it("limita a espera pelo token de autenticação", async () => {
  vi.useFakeTimers();
  user.getIdToken.mockReturnValue(new Promise(() => {}));
  const result = expect(request("state")).rejects.toThrow("O servidor demorou");
  await vi.advanceTimersByTimeAsync(20000);
  await result;
});
it.each(["state", "media"])(
  "cancela requisição pendente de %s",
  async (kind) => {
    vi.useFakeTimers();
    user.getIdToken.mockResolvedValue("token");
    let signal: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      }),
    );
    const operation =
      kind === "media" ? mediaBlob("image", "workspace") : request("state");
    const result = expect(operation).rejects.toThrow("O servidor demorou");
    await vi.advanceTimersByTimeAsync(kind === "media" ? 120000 : 20000);
    await result;
    expect(signal!.aborted).toBe(true);
  },
);
it("também limita a espera pela leitura do corpo da resposta", async () => {
  vi.useFakeTimers();
  user.getIdToken.mockResolvedValue("token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }),
  );
  const result = expect(request("state")).rejects.toThrow("O servidor demorou");
  await vi.advanceTimersByTimeAsync(20000);
  await result;
});
