import { test, expect } from "@playwright/test";
import { admin } from "../lib/server/firebase";

test.skip(process.env.LUP_E2E_EMULATORS !== "true", "Requires demo emulators.");
test("restaura mais de 60 rascunhos sem duplicar nem ativar publicações", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(90000);
  const signup = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
    {
      data: {
        email: `restore-${Date.now()}@example.test`,
        password: "LupTest!12345",
        returnSecureToken: true,
      },
    },
  );
  const { idToken, localId } = await signup.json();
  const headers = { Authorization: `Bearer ${idToken}`, Origin: baseURL! };
  expect(
    (await request.post("/api/bootstrap", { headers, data: {} })).ok(),
  ).toBe(true);
  const posts = Array.from({ length: 70 }, (_, i) => ({
    caption: `Rascunho ${i}`,
    status: "scheduled",
    scheduledAt: "2027-01-01T12:00:00Z",
    accountId: "old",
    mediaIds: ["old"],
  }));
  const first = await request.post("/api/posts/restore", {
    headers,
    data: { posts },
  });
  expect(first.ok()).toBe(true);
  expect(await first.json()).toEqual({ restored: 70, skipped: 0 });
  const second = await request.post("/api/posts/restore", {
    headers,
    data: { posts },
  });
  expect(await second.json()).toEqual({ restored: 0, skipped: 70 });
  const db = admin().db;
  const saved = await db.collection(`workspaces/${localId}/posts`).get();
  expect(saved.size).toBe(70);
  for (const doc of saved.docs)
    expect(doc.data()).toMatchObject({
      status: "draft",
      mediaIds: [],
      accountId: "",
      scheduledAt: null,
    });
  const jobs = await db.collection(`workspaces/${localId}/jobs`).get();
  expect(jobs.docs.every((doc) => doc.data().status === "inactive")).toBe(true);
  const post = saved.docs[0];
  await db
    .doc(`workspaces/${localId}/accounts/test-ig`)
    .set({ status: "connected", username: "test" });
  await db
    .doc(`workspaces/${localId}`)
    .update({ "subscription.activeAccountIds": ["test-ig"] });
  await post.ref.update({
    accountId: "test-ig",
    status: "failed",
    containerId: "expired",
    childIds: ["expired-child"],
    attempts: 5,
  });
  const retry = await request.post(`/api/posts/${post.id}/retry`, {
    headers,
    data: {},
  });
  expect(retry.ok()).toBe(true);
  const retried = (await post.ref.get()).data()!;
  expect(retried.status).toBe("scheduled");
  expect(retried.attempts).toBe(0);
  expect(retried.containerId).toBeUndefined();
  expect(retried.childIds).toBeUndefined();
});
