import { z } from "zod";
import type { Account } from "./schema";
import type { PlanId, Subscription } from "./plans";
export const catalogEntrySchema = z.object({
  monthlyCents: z.number().int().min(0).max(10000000).nullable(),
  yearlyCents: z.number().int().min(0).max(100000000).nullable(),
  description: z.string().trim().max(240),
  published: z.boolean(),
});
export const catalogSchema = z.object({
  revision: z.number().int().nonnegative(),
  essential: catalogEntrySchema,
  pro: catalogEntrySchema,
});
export type PlanCatalog = z.infer<typeof catalogSchema>;
export const defaultCatalog: PlanCatalog = {
  revision: 0,
  essential: {
    monthlyCents: null,
    yearlyCents: null,
    description: "Organize uma conta do Instagram.",
    published: false,
  },
  pro: {
    monthlyCents: null,
    yearlyCents: null,
    description: "Gerencie até três contas com visão conjunta.",
    published: false,
  },
};
export function catalogOf(value: unknown): PlanCatalog {
  const parsed = catalogSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultCatalog;
}
export function money(cents: number | null) {
  return cents === null
    ? "Sob consulta"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(cents / 100);
}
export function parsePrice(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value.trim()))
    throw Error("Use um valor como 49,90, sem pontos de milhar.");
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw Error("Preço inválido.");
  return cents;
}
export interface ManagedProfile {
  id: string;
  name: string;
  ownerName: string;
  email: string;
  assignedPlan: PlanId;
  subscription: Subscription;
  revision: number;
  lastPlanMigration?: { from: PlanId; to: PlanId; at: string };
  accounts: Account[];
  request: {
    id: string;
    status: "pending" | "approved" | "declined";
    createdAt: string;
    message?: string;
  } | null;
}
export interface PlanManagerData {
  profiles: ManagedProfile[];
  nextCursor: string | null;
  stats: { totalProfiles: number; pendingRequests: number; migratedProfiles: number };
  catalog: PlanCatalog;
}
export const planChangeSchema = z.object({
  plan: z.enum(["essential", "pro"]),
  status: z.enum(["active", "cancelled", "suspended"]),
  activeAccountIds: z
    .array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/))
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length),
  expectedRevision: z.number().int().nonnegative().optional(),
  requestId: z.string().max(200).optional(),
  reason: z.string().trim().min(3).max(500),
});
export type PlanChange = z.infer<typeof planChangeSchema>;
