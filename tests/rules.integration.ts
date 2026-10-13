import { beforeAll, afterAll, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lup-media-pro",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "workspaces/a/members/alice"), {
      role: "owner",
    });
    await setDoc(doc(c.firestore(), "workspaces/a/members/viewer"), {
      role: "viewer",
    });
    await setDoc(doc(c.firestore(), "workspaces/a/posts/p"), {
      status: "draft",
    });
    await setDoc(doc(c.firestore(), "workspaces/a/secrets/token"), {
      token: "secret",
    });
  });
});
afterAll(async () => {
  await env.cleanup();
});
it("isola workspaces e oculta segredos", async () => {
  await assertSucceeds(
    getDoc(
      doc(
        env.authenticatedContext("alice").firestore(),
        "workspaces/a/posts/p",
      ),
    ),
  );
  await assertFails(
    getDoc(
      doc(env.authenticatedContext("bob").firestore(), "workspaces/a/posts/p"),
    ),
  );
  await assertFails(
    getDoc(
      doc(
        env.authenticatedContext("alice").firestore(),
        "workspaces/a/secrets/token",
      ),
    ),
  );
  await assertFails(
    getDoc(
      doc(env.unauthenticatedContext().firestore(), "workspaces/a/posts/p"),
    ),
  );
});
it("não permite cliente alterar status ou permissões", async () => {
  await assertFails(
    setDoc(
      doc(
        env.authenticatedContext("alice").firestore(),
        "workspaces/a/posts/p",
      ),
      { status: "published" },
    ),
  );
  await assertFails(
    setDoc(
      doc(
        env.authenticatedContext("viewer").firestore(),
        "workspaces/a/members/viewer",
      ),
      { role: "owner" },
    ),
  );
});
it("protege upload, download e formatos", async () => {
  const path = "workspaces/a/media/11111111-1111-4111-8111-111111111111";
  const bytes = new Uint8Array([255, 216, 255]);
  await assertSucceeds(
    uploadBytes(ref(env.authenticatedContext("alice").storage(), path), bytes, {
      contentType: "image/jpeg",
    }),
  );
  await assertSucceeds(
    getBytes(ref(env.authenticatedContext("alice").storage(), path)),
  );
  await assertFails(
    getBytes(ref(env.authenticatedContext("bob").storage(), path)),
  );
  await assertFails(
    uploadBytes(
      ref(
        env.authenticatedContext("viewer").storage(),
        "workspaces/a/media/22222222-2222-4222-8222-222222222222",
      ),
      bytes,
      { contentType: "image/jpeg" },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(
        env.authenticatedContext("alice").storage(),
        "workspaces/a/media/33333333-3333-4333-8333-333333333333",
      ),
      bytes,
      { contentType: "text/html" },
    ),
  );
  expect(bytes.length).toBe(3);
});
