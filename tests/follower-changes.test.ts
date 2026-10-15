import { expect, it } from "vitest";
import { emptyFollowers } from "../lib/shared/schema";
import { compareFollowerImports, comparisonChunks } from "../lib/shared/follower-changes";
const at = "2026-10-15T03:00:00Z";
it("a primeira lista e uma migração sem seguidores apenas estabelecem a base", () => {
  for (const previous of [undefined, emptyFollowers, { ...emptyFollowers, users: ["ana"], source: { name: "Legado", updated: at, partial: true, followers: 15 } }]) {
    const result = compareFollowerImports(previous, { ...emptyFollowers, followers: ["ana"] }, at);
    expect(result.baseline).toBe(true);
    expect(result.changes).toEqual([]);
  }
});
it("compara seguidores e não quem eu sigo, preservando o intervalo", () => {
  const result = compareFollowerImports({ ...emptyFollowers, followers: ["ANA", "@bia", "ana"], following: ["caio"], source: { name: "Instagram", updated: "2026-10-01T12:00:00Z", partial: false } }, { ...emptyFollowers, followers: ["ana", "caio"], following: ["bia"] }, at);
  expect(result).toMatchObject({ from: "2026-10-01T12:00:00Z", at, baseline: false, lost: 1, gained: 1, changes: [{ user: "bia", type: "lost" }, { user: "caio", type: "gained" }] });
});
it("lista vazia registrada é uma base válida; lista parcial fica sinalizada", () => {
  const result = compareFollowerImports({ ...emptyFollowers, source: { name: "Instagram", updated: at, followers: 0, partial: false } }, { ...emptyFollowers, followers: ["ana"], source: { name: "Instagram", updated: at, partial: true } }, at);
  expect(result).toMatchObject({ baseline: false, partial: true, gained: 1 });
});
it("mesma lista em outra ordem não gera saída; retorno e nova saída são eventos distintos", () => {
  const a = { ...emptyFollowers, followers: ["ana", "bia"] }, b = { ...emptyFollowers, followers: ["ana"] };
  expect(compareFollowerImports(a, { ...a, followers: ["bia", "ana"] }, at).changes).toEqual([]);
  expect(compareFollowerImports(a, b, at).changes).toEqual([{ user: "bia", type: "lost" }]);
  expect(compareFollowerImports(b, a, at).changes).toEqual([{ user: "bia", type: "gained" }]);
  expect(compareFollowerImports(a, b, at).changes).toEqual([{ user: "bia", type: "lost" }]);
});
it("divide listas grandes sem cortar eventos e sem exceder o limite transacional", () => {
  const previous = { ...emptyFollowers, followers: Array.from({ length: 30000 }, (_, i) => `old${i}`) };
  const next = { ...emptyFollowers, followers: Array.from({ length: 30000 }, (_, i) => `new${i}`) };
  const result = compareFollowerImports(previous, next, at), chunks = comparisonChunks(result);
  expect(chunks).toHaveLength(200);
  expect(chunks.flatMap((chunk) => chunk.changes)).toEqual(result.changes);
  expect(chunks.every((chunk) => chunk.changes.length <= 300)).toBe(true);
});
