import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicationHistory } from "../components/publication-history";
it("oculta eventos internos e repetições, com datas locais e legenda legível", () => {
  const html = renderToStaticMarkup(
    <PublicationHistory
      posts={[]}
      timezone="America/Bahia"
      history={[
        { id: "internal", postId: "technical-id", at: "2026-10-15T01:31:00Z" },
        {
          id: "success",
          postId: "technical-id",
          at: "2026-10-15T01:30:00Z",
          status: "published",
          caption: "Minha publicação",
        },
        {
          id: "processing2",
          postId: "technical-id",
          at: "2026-10-15T01:20:00Z",
          status: "processing",
        },
        {
          id: "processing1",
          postId: "technical-id",
          at: "2026-10-15T01:10:00Z",
          status: "processing",
        },
      ]}
    />,
  );
  expect(html).toContain("Publicação enviada ao Instagram");
  expect(html).toContain("Minha publicação");
  expect(html).toContain("14/10/2026 às 22:30");
  expect(html).not.toContain("technical-id");
  expect(html.match(/<li /g)).toHaveLength(2);
});
