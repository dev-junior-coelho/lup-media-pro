import { z } from "zod";
import { mediaIssue } from "./media-format";
export const roleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
export const postInput = z
  .object({
    id: z.string().uuid().optional(),
    type: z.enum(["post", "carousel", "reel", "story"]),
    caption: z.string().max(2200),
    accountId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{0,100}$/)
      .default(""),
    mediaIds: z
      .array(z.string().uuid())
      .max(10)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Selecione cada mídia apenas uma vez.",
      ),
    scheduledAt: z.string().datetime().nullable(),
    intent: z.enum(["draft", "schedule", "now"]),
    revision: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.intent === "draft" || Boolean(value.accountId), {
    message: "Selecione uma conta conectada.",
    path: ["accountId"],
  });
export type PostInput = z.infer<typeof postInput>;
export type Status =
  "draft" | "scheduled" | "processing" | "published" | "failed" | "cancelled";
export interface Post {
  id: string;
  type: PostInput["type"];
  caption: string;
  accountId: string;
  mediaIds: string[];
  scheduledAt: string | null;
  status: Status;
  revision: number;
  createdAt: string;
  updatedAt: string;
  containerId?: string;
  instagramId?: string;
  permalink?: string;
  error?: string;
  uncertain?: boolean;
  attempts?: number;
  leaseUntil?: string;
  leaseId?: string;
  containerCreatedAt?: string;
  nextAttemptAt?: string;
  phase?: string;
  childIds?: string[];
  publishedAt?: string;
}
export interface Media {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  createdAt: string;
  width: number;
  height: number;
  duration: number;
  url?: string;
}
export interface Account {
  id: string;
  username: string;
  accountType: string;
  expiresAt: string;
  permissions: string[];
  status: string;
  planPaused?: boolean;
}
export const handles = z
  .array(z.string().regex(/^[a-z0-9._]{1,30}$/i))
  .max(30000);
export const followerSchema = z.object({
  users: handles,
  completed: handles.default([]),
  protected: handles.default([]),
  followers: handles.default([]),
  following: handles.default([]),
  displayNames: z
    .record(
      z.string().regex(/^[a-z0-9._]{1,30}$/i),
      z.string().trim().min(1).max(100),
    )
    .default({}),
  timestamps: z.record(z.string(), z.number()).default({}),
  history: z
    .array(
      z.object({
        at: z.string(),
        user: z.string().max(30),
        action: z.enum(["done", "undone", "protected", "unprotected"]),
      }),
    )
    .max(10000)
    .default([]),
  source: z
    .object({
      name: z.string().max(200),
      updated: z.string(),
      partial: z.boolean(),
      followers: z.number().nullable().optional(),
      following: z.number().nullable().optional(),
    })
    .optional(),
  linkMode: z.enum(["app", "web"]).default("app"),
});
export type Followers = z.infer<typeof followerSchema>;
export const emptyFollowers: Followers = {
  users: [],
  completed: [],
  protected: [],
  followers: [],
  following: [],
  displayNames: {},
  timestamps: {},
  history: [],
  linkMode: "app",
};
export const mediaInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(150),
  mime: z.enum(["image/jpeg", "video/mp4", "video/quicktime"]),
  size: z
    .number()
    .positive()
    .max(300 * 1024 * 1024),
  width: z.number().positive(),
  height: z.number().positive(),
  duration: z.number().nonnegative().default(0),
});
export function validatePublication(
  input: PostInput,
  media: Media[],
  account: Account,
  now = Date.now(),
) {
  if (input.intent === "draft") return;
  if (
    !account ||
    account.status !== "connected" ||
    !Number.isFinite(Date.parse(account.expiresAt)) ||
    Date.parse(account.expiresAt) <= now
  )
    throw Error("Conta desconectada ou token expirado. Reconecte o Instagram.");
  if (!account.permissions.includes("instagram_business_content_publish"))
    throw Error("Permissão de publicação não concedida.");
  if (
    input.intent === "schedule" &&
    (!input.scheduledAt ||
      !Number.isFinite(Date.parse(input.scheduledAt)) ||
      Date.parse(input.scheduledAt) <= now)
  )
    throw Error("Escolha um horário futuro.");
  if (
    input.type === "carousel"
      ? media.length < 2 || media.length > 10
      : media.length !== 1
  )
    throw Error("Selecione uma mídia, ou 2 a 10 imagens no carrossel.");
  if (input.type === "story" && account.accountType !== "BUSINESS")
    throw Error("Stories exigem conta Business e suporte da API.");
  for (const m of media) {
    const issue = mediaIssue(m, input.type);
    if (issue) throw Error(issue);
  }
}
