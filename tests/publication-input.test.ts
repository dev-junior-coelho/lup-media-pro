import { expect, it } from "vitest";
import {
  postInput,
  validatePublication,
  type Account,
  type Media,
} from "../lib/shared/schema";
import { restoredDraft } from "../lib/shared/backup";
const input = {
  type: "post",
  caption: "",
  accountId: "",
  mediaIds: [],
  scheduledAt: null,
  intent: "schedule",
} as const;
it("exige uma conta para agendar e recusa IDs que alterem caminhos", () => {
  expect(postInput.safeParse(input).success).toBe(false);
  expect(postInput.safeParse({ ...input, intent: "draft" }).success).toBe(true);
  expect(
    postInput.safeParse({ ...input, intent: "draft", accountId: "../account" })
      .success,
  ).toBe(false);
});
it("recusa mídias duplicadas", () => {
  expect(
    postInput.safeParse({
      ...input,
      accountId: "ig",
      mediaIds: [
        "84a7cffd-c169-4edb-82a5-b8901c3dcbb5",
        "84a7cffd-c169-4edb-82a5-b8901c3dcbb5",
      ],
    }).success,
  ).toBe(false);
});
it("uma data de expiração inválida não autoriza publicação", () => {
  const account: Account = {
    id: "ig",
    username: "user",
    status: "connected",
    accountType: "BUSINESS",
    expiresAt: "invalid",
    permissions: ["instagram_business_content_publish"],
  };
  expect(() =>
    validatePublication(
      { ...input, intent: "now", mediaIds: [], accountId: "ig" },
      [] as Media[],
      account,
    ),
  ).toThrow("Reconecte");
});
it("restaura conteúdo sem ativar contas, mídias ou agendamentos do backup", () => {
  expect(
    restoredDraft({
      type: "reel",
      caption: "Teste",
      status: "published",
      scheduledAt: "2099-01-01",
      accountId: "ig",
      mediaIds: ["image"],
    }),
  ).toEqual({
    type: "reel",
    caption: "Teste",
    accountId: "",
    mediaIds: [],
    scheduledAt: null,
    intent: "draft",
  });
  expect(() => restoredDraft(null)).toThrow("inválida");
});
