import { afterEach, expect, it, vi } from "vitest";
import { MediaCache } from "../lib/media-cache";
afterEach(() => vi.restoreAllMocks());
it("reutiliza downloads em andamento e URLs já carregadas", async () => {
  const download = vi.fn().mockResolvedValue("blob:test");
  const cache = new MediaCache(download);
  const first = cache.load("media", "ws");
  expect(cache.load("media", "ws")).toBe(first);
  await first;
  await expect(cache.load("media", "ws")).resolves.toBe("blob:test");
  expect(download).toHaveBeenCalledTimes(1);
});
it("libera URLs removidas e descarta downloads de sessões encerradas", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let finish!: (value: string) => void;
  const cache = new MediaCache(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  cache.set("removed", "blob:removed");
  cache.retain(new Set());
  expect(revoke).toHaveBeenCalledWith("blob:removed");
  cache.retain(new Set(["media"]));
  const pending = cache.load("media", "ws");
  await Promise.resolve();
  cache.clear();
  finish("blob:old-session");
  await expect(pending).resolves.toBeUndefined();
  expect(cache.get("media")).toBeUndefined();
  expect(revoke).toHaveBeenCalledWith("blob:old-session");
});
it("limita downloads simultâneos e permite repetir um download que falhou", async () => {
  let active = 0,
    maximum = 0;
  const download = vi.fn(async (id: string) => {
    active++;
    maximum = Math.max(active, maximum);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (id === "error") throw Error("offline");
    return `blob:${id}`;
  });
  const cache = new MediaCache(download);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => cache.load(String(i), "ws")),
  );
  expect(maximum).toBeLessThanOrEqual(3);
  await cache.load("error", "ws");
  await cache.load("error", "ws");
  expect(download).toHaveBeenCalledTimes(12);
});
