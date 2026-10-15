import { expect, it, vi } from "vitest";
import { firestoreStore } from "../lib/server/worker";
const fake = vi.hoisted(() => ({
  post: {
    accountId: "ig",
    revision: 1,
    status: "scheduled",
    caption: "Conteúdo",
    scheduledAt: "2020-01-01T00:00:00Z",
  } as Record<string, unknown>,
  history: [] as Record<string, unknown>[],
  active: ["ig"],
}));
vi.mock("../lib/server/plans", () => ({
  readPlanContext: async () => ({
    subscription: {
      plan: "essential",
      status: "active",
      activeAccountIds: fake.active,
    },
    accounts: [{ id: "ig", status: "connected" }],
  }),
}));
vi.mock("../lib/server/firebase", () => ({
  admin: () => ({
    bucket: {},
    db: {
      doc: (path: string) => ({
        id: "post",
        path,
        parent: { parent: { path: "workspaces/ws" } },
      }),
      collection: () => ({ doc: () => ({ history: true }) }),
      runTransaction: async (run: (tx: unknown) => unknown) =>
        run({
          get: async () => {
            const snapshot = { ...fake.post };
            return { exists: true, data: () => snapshot };
          },
          update: (_ref: unknown, patch: Record<string, unknown>) =>
            Object.assign(fake.post, patch),
          set: (ref: { history?: boolean }, data: Record<string, unknown>) => {
            if (ref.history) fake.history.push(data);
          },
        }),
    },
  }),
}));
it("registra mudanças visíveis e não gera eventos repetidos de processamento ou links", async () => {
  const store = firestoreStore("workspaces/ws/posts/post");
  await store.claim();
  expect(fake.history.map((event) => event.status)).toEqual(["processing"]);
  await store.save({ status: "processing", phase: "container" });
  await store.save({ permalink: "https://instagram.com/p/test" });
  expect(fake.history).toHaveLength(1);
  await store.save({ status: "published" });
  expect(fake.history.map((event) => event.status)).toEqual([
    "processing",
    "published",
  ]);
  expect(fake.history[1].caption).toBe("Conteúdo");
});

it("conta pausada mantém agendamento sem iniciar envio", async () => {
  fake.post = {
    accountId: "ig",
    revision: 1,
    status: "scheduled",
    caption: "Pausada",
    scheduledAt: "2020-01-01T00:00:00Z",
  };
  fake.active = [];
  fake.history.length = 0;
  expect(await firestoreStore("workspaces/ws/posts/post").claim()).toBeNull();
  expect(fake.post.status).toBe("scheduled");
  expect(fake.history).toHaveLength(0);
});
