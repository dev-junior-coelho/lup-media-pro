import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt, sameOrigin } from "../lib/server/security";
import { workspacePath } from "../lib/server/firebase";
it("criptografa e autentica tokens", () => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const encrypted = encrypt("token-secret");
  expect(encrypted).not.toContain("token-secret");
  expect(decrypt(encrypted)).toBe("token-secret");
  expect(() => decrypt(encrypted.replace(/^./, "!"))).toThrow();
});
it("impede path traversal em workspace", () =>
  expect(() => workspacePath("../victim")).toThrow());
it("rejeita mutações de outra origem", () => {
  expect(() =>
    sameOrigin(
      new Request("https://app.example/api/posts", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  ).toThrow();
  expect(() =>
    sameOrigin(
      new Request("https://app.example/api/posts", {
        headers: { origin: "https://app.example" },
      }),
    ),
  ).not.toThrow();
});
