import type { PostInput } from "./schema";

/** Restored content always requires a new review before it can be sent. */
export function restoredDraft(value: unknown): Omit<PostInput, "id"> {
  if (!value || typeof value !== "object")
    throw Error("O backup contém uma publicação inválida.");
  const post = value as Record<string, unknown>;
  return {
    type: ["post", "carousel", "reel", "story"].includes(String(post.type))
      ? (post.type as PostInput["type"])
      : "post",
    caption: String(post.caption ?? "").slice(0, 2200),
    accountId: "",
    mediaIds: [],
    scheduledAt: null,
    intent: "draft",
  };
}
