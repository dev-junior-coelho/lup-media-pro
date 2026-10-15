import { expect, it } from "vitest";
import {
  catalogOf,
  catalogSchema,
  defaultCatalog,
  money,
  parsePrice,
  planChangeSchema,
} from "../lib/shared/plan-management";
import { activeAccountIds, subscriptionOf } from "../lib/shared/plans";
import type { Account } from "../lib/shared/schema";
it("trata preços em centavos sem arredondar valores digitados", () => {
  expect(parsePrice("49,90")).toBe(4990);
  expect(parsePrice("0,01")).toBe(1);
  expect(parsePrice("50.5")).toBe(5050);
  expect(parsePrice(" ")).toBeNull();
  expect(() => parsePrice("1.000,00")).toThrow();
  expect(() => parsePrice("9,999")).toThrow();
  expect(() => parsePrice("-1")).toThrow();
});
it("não presume preços e recusa valores comerciais inválidos", () => {
  expect(catalogOf(undefined)).toEqual(defaultCatalog);
  expect(money(null)).toBe("Sob consulta");
  expect(money(4990)).toContain("49,90");
  expect(
    catalogSchema.safeParse({
      ...defaultCatalog,
      pro: { ...defaultCatalog.pro, monthlyCents: -1 },
    }).success,
  ).toBe(false);
});
it("requer motivo e recusa seleção de contas repetidas", () => {
  expect(
    planChangeSchema.safeParse({
      plan: "pro",
      status: "active",
      activeAccountIds: ["a", "a"],
      reason: "Confirmado",
    }).success,
  ).toBe(false);
  expect(
    planChangeSchema.safeParse({
      plan: "pro",
      status: "active",
      activeAccountIds: [],
      reason: "",
    }).success,
  ).toBe(false);
});
it("suspensão mantém dados e bloqueia todas as vagas", () => {
  const subscription = subscriptionOf({
    subscription: {
      plan: "pro",
      status: "suspended",
      activeAccountIds: ["a", "b"],
    },
  });
  expect(subscription.status).toBe("suspended");
  expect(
    activeAccountIds(subscription, [
      { id: "a", status: "connected" },
      { id: "b", status: "connected" },
    ] as Account[]),
  ).toEqual([]);
});
