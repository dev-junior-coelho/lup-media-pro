import { expect, it } from "vitest";
import { mediaIssue } from "../lib/shared/media-format";
import { validatePublication, type Media, type PostInput, type Account } from "../lib/shared/schema";
const image: Media = { id: "image", name: "Cardápio.jpg", mime: "image/jpeg", size: 20000, width: 1080, height: 1920, duration: 0, path: "private/image", createdAt: "2026-10-14" };
const account: Account = { id: "1", username: "restaurante", accountType: "BUSINESS", status: "connected", expiresAt: "2099-01-01T00:00:00Z", permissions: ["instagram_business_content_publish"] };
const post: PostInput = { type: "post", intent: "now", mediaIds: ["image"], accountId: "1", caption: "", scheduledAt: null };
it("identifica a imagem alta e orienta o ajuste no editor e na API", () => {
  const issue = mediaIssue(image, "post");
  expect(issue).toContain("Cardápio.jpg");
  expect(issue).toContain("alta demais");
  expect(issue).toContain("bordas");
  expect(() => validatePublication(post, [image], account)).toThrow(issue!);
});
it("permite guardar a arte original como rascunho e usá-la em Story", () => {
  expect(() => validatePublication({ ...post, intent: "draft" }, [image], account)).not.toThrow();
  expect(mediaIssue(image, "story")).toBeNull();
  expect(() => validatePublication({ ...post, type: "story" }, [image], account)).not.toThrow();
});
it("aceita a cópia com enquadramento vertical e distingue largura de tamanho do arquivo", () => {
  expect(mediaIssue({ ...image, height: 1350 }, "post")).toBeNull();
  expect(mediaIssue({ ...image, width: 1920, height: 1000 }, "post")).toContain("larga demais");
  expect(mediaIssue({ ...image, width: 200, height: 200 }, "post")).toContain("pequena demais");
  expect(mediaIssue({ ...image, size: 9 * 1024 * 1024 }, "post")).toContain("8 MB");
});
it("explica a troca de tipo quando uma imagem é selecionada para Reel", () => {
  expect(mediaIssue(image, "reel")).toContain("Reels precisam de vídeo");
});
