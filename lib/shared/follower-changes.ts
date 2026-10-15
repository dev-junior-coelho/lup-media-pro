import type { Followers } from "./schema";
export type FollowerChange = { user: string; type: "lost" | "gained" };
export type FollowerComparison = {
  id: string;
  at: string;
  from: string | null;
  partial: boolean;
  baseline: boolean;
  lost: number;
  gained: number;
  changes: FollowerChange[];
};
export type FollowerChangePage = { comparisons: FollowerComparison[]; cursor: string | null };
const handles = (values: string[]) => new Set(values.map((user) => user.trim().replace(/^@/, "").toLowerCase()));
export function compareFollowerImports(previous: Followers | undefined, next: Followers, at: string): Omit<FollowerComparison, "id"> {
  const before = handles(previous?.followers ?? []), after = handles(next.followers);
  const known = Boolean(previous && (before.size > 0 || previous.source?.followers === 0));
  const lost = known ? [...before].filter((user) => !after.has(user)) : [];
  const gained = known ? [...after].filter((user) => !before.has(user)) : [];
  return {
    at,
    from: previous?.source?.updated ?? null,
    partial: Boolean(previous?.source?.partial || next.source?.partial),
    baseline: !known,
    lost: lost.length,
    gained: gained.length,
    changes: [
      ...lost.map((user): FollowerChange => ({ user, type: "lost" })),
      ...gained.map((user): FollowerChange => ({ user, type: "gained" })),
    ],
  };
}
export function comparisonChunks(comparison: Omit<FollowerComparison, "id">) {
  const chunks: Omit<FollowerComparison, "id">[] = [];
  for (let start = 0; start < comparison.changes.length; start += 300)
    chunks.push({ ...comparison, changes: comparison.changes.slice(start, start + 300) });
  return chunks.length ? chunks : [{ ...comparison, changes: [] }];
}
