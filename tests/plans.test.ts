import { expect, it } from "vitest";
import { activeAccountIds, plans, subscriptionOf } from "../lib/shared/plans";
import type { Account } from "../lib/shared/schema";
const accounts = ["a", "b", "c", "d"].map(
  (id) => ({ id, status: "connected" }) as Account,
);
it("inicia no Essencial e respeita o limite de cada plano", () => {
  expect(plans.essential.accountLimit).toBe(1);
  expect(plans.pro.accountLimit).toBe(3);
  expect(activeAccountIds(subscriptionOf(null), accounts)).toEqual(["a"]);
  expect(activeAccountIds({ plan: "pro", status: "active" }, accounts)).toEqual(
    ["a", "b", "c"],
  );
});
it("reconexão necessária ocupa vaga e desconexão libera vaga", () => {
  expect(
    activeAccountIds({ plan: "pro", status: "active" }, [
      { ...accounts[0], status: "reconnect_required" },
      { ...accounts[1], status: "disconnected" },
    ]),
  ).toEqual(["a"]);
});
it("redução preserva a conta escolhida e cancelamento não mantém três vagas", () => {
  expect(
    activeAccountIds(
      { plan: "essential", status: "active", activeAccountIds: ["c"] },
      accounts,
    ),
  ).toEqual(["c"]);
  const cancelled = subscriptionOf({
    subscription: {
      plan: "pro",
      status: "cancelled",
      activeAccountIds: ["b", "c", "d"],
    },
  });
  expect(activeAccountIds(cancelled, accounts)).toEqual(["b"]);
});
