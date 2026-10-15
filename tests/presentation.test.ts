import { expect, it } from "vitest";
import { filterPosts, postsCsv, displayDate } from "../lib/shared/presentation";
import type { Post } from "../lib/shared/schema";
const post = {
  id: "example",
  caption: "Minha publicação",
  type: "post",
  accountId: "account",
  mediaIds: [],
  status: "published",
  scheduledAt: "2026-10-15T01:30:00Z",
  revision: 1,
  createdAt: "",
  updatedAt: "",
} satisfies Post;
it("filtra o dia no fuso do workspace, incluindo o final do dia", () => {
  expect(
    filterPosts(
      [post],
      {
        status: "all",
        account: "all",
        term: "  publicação  ",
        from: "2026-10-14",
        until: "2026-10-14",
      },
      "America/Bahia",
    ),
  ).toEqual([post]);
  expect(
    filterPosts(
      [post],
      {
        status: "all",
        account: "all",
        term: "",
        from: "2026-10-15",
        until: "",
      },
      "America/Bahia",
    ),
  ).toEqual([]);
});
it("não inclui rascunhos sem data em períodos selecionados", () => {
  expect(
    filterPosts(
      [{ ...post, scheduledAt: null }],
      {
        status: "all",
        account: "all",
        term: "",
        from: "",
        until: "2026-10-14",
      },
      "America/Bahia",
    ),
  ).toEqual([]);
});
it("exporta conteúdo legível e impede fórmulas, mesmo com espaços antes", () => {
  const csv = postsCsv(
    [{ ...post, caption: '  =HYPERLINK("test")' }],
    "America/Bahia",
  );
  expect(csv).toContain("Publicado");
  expect(csv).toContain("14/10/2026 às 22:30");
  expect(csv).toContain(`"'  =HYPERLINK(""test"")"`);
  expect(csv).not.toContain(post.id);
});
it("trata datas ausentes ou inválidas sem quebrar a tela", () => {
  expect(displayDate(undefined, "America/Bahia")).toBe("Data não disponível");
  expect(displayDate("bad", "America/Bahia")).toBe("Data não disponível");
});
