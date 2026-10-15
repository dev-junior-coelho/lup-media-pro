import type { Account } from "./schema";
export type PlanId = "essential" | "pro";
export interface Subscription {
  plan: PlanId;
  status: "active" | "cancelled" | "suspended";
  requestStatus?: "pending" | "approved" | "declined";
  requestMessage?: string;
  activeAccountIds?: string[];
  requestedPlan?: "pro";
  requestedAt?: string;
}
export const plans = {
  essential: { name: "Essencial", accountLimit: 1 },
  pro: { name: "Pro", accountLimit: 3 },
} as const;
export function subscriptionOf(
  workspace?: { subscription?: Partial<Subscription> } | null,
): Subscription {
  const value = workspace?.subscription;
  return {
    plan:
      value?.plan === "pro" && value.status === "active" ? "pro" : "essential",
    status:
      value?.status === "suspended"
        ? "suspended"
        : value?.status === "cancelled"
          ? "cancelled"
          : "active",
    ...(value?.requestStatus ? { requestStatus: value.requestStatus } : {}),
    ...(value?.requestMessage ? { requestMessage: value.requestMessage } : {}),
    ...(Array.isArray(value?.activeAccountIds)
      ? { activeAccountIds: value.activeAccountIds }
      : {}),
    ...(value?.requestedPlan === "pro"
      ? { requestedPlan: "pro" as const, requestedAt: value.requestedAt }
      : {}),
  };
}
export function activeAccountIds(
  subscription: Subscription,
  accounts: Account[],
): string[] {
  if (subscription.status === "suspended") return [];
  const connected = accounts.filter(
    (account) => account.status !== "disconnected",
  );
  const ids =
    subscription.activeAccountIds ??
    connected.map((account) => account.id).sort();
  return [...new Set(ids)]
    .filter((id) => connected.some((account) => account.id === id))
    .slice(0, plans[subscription.plan].accountLimit);
}
