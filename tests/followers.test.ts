import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  compare,
  followerRelations,
  parseExport,
  restoreFollowers,
  importZip,
  importFollowerFiles,
  differences,
  profileLink,
} from "../lib/shared/followers";
import { emptyFollowers } from "../lib/shared/schema";
describe("exportações e migração", () => {
  it("restaura marcações legadas sem apagar a lista e prioriza protegidos", () => {
    const c = { ...emptyFollowers, users: ["ana"], protected: ["ana"] };
    expect(restoreFollowers({ completed: ["ana"] }, c).users).toEqual(["ana"]);
    expect(restoreFollowers({ completed: ["ana"] }, c).completed).toEqual([]);
    expect(() => restoreFollowers({}, c)).toThrow("inválido");
  });
  it("compara relações sem confundir com unfollows", () => {
    expect(compare(["Ana", "@bia", "c"], ["ana", "d"])).toEqual({
      notFollowingBack: ["bia", "c"],
      fans: ["d"],
      mutual: ["ana"],
    });
    expect(differences(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });
  it("lê JSON oficial com timestamps", () =>
    expect(
      parseExport(
        "following.json",
        JSON.stringify({
          relationships_following: [
            {
              title: "ANA",
              string_list_data: [{ value: "ana", timestamp: 10 }],
            },
          ],
        }),
      ),
    ).toEqual({ users: ["ana"], timestamps: { ana: 10000 } }));
  it("lê HTML somente de links Instagram", () =>
    expect(
      parseExport(
        "followers.html",
        '<a href="https://www.instagram.com/_u/ana/">Ana</a><a href="https://evil.example/bia">bia</a>',
      ).users,
    ).toEqual(["ana"]));
  it("preserva marcações ao importar ZIP", async () => {
    const z = new JSZip();
    z.file(
      "connections/followers_and_following/following.json",
      JSON.stringify({
        relationships_following: [{ title: "ana" }, { title: "bia" }],
      }),
    );
    z.file(
      "connections/followers_and_following/followers_1.json",
      JSON.stringify([{ string_list_data: [{ value: "ana" }] }]),
    );
    const b = await z.generateAsync({ type: "uint8array" });
    const d = await importZip(new Blob([new Uint8Array(b)]), {
      ...emptyFollowers,
      completed: ["bia"],
      protected: ["c"],
    });
    expect(d.users).toEqual(["bia"]);
    expect(d.completed).toEqual(["bia"]);
    expect(d.protected).toEqual(["c"]);
  });
  it("rejeita ZIP incompleto", async () => {
    const z = new JSZip();
    z.file("following.json", "[]");
    await expect(
      importZip(
        new Blob([
          new Uint8Array(await z.generateAsync({ type: "uint8array" })),
        ]),
        emptyFollowers,
      ),
    ).rejects.toThrow("seguidores");
  });
  it("restaura backup combinado preservando progresso", () => {
    expect(
      restoreFollowers(
        {
          format: "instagram-manager-pro-v1",
          followers: {
            users: ["ana"],
            completed: ["ana"],
            protected: [],
            history: [],
          },
        },
        { ...emptyFollowers, completed: ["bia"] },
      ).completed,
    ).toEqual(["bia", "ana"]);
  });
  it("gera intent Android com fallback e impede handles maliciosos", () => {
    expect(profileLink("ana", "app", true)).toContain("browser_fallback_url=");
    expect(profileLink("ana", "web", true)).toBe(
      "https://www.instagram.com/ana/",
    );
    expect(() => profileLink("../evil", "app", true)).toThrow();
  });
});

it("ignora entradas vazias e preserva nomes reais presentes no arquivo", () => {
  const parsed = parseExport(
    "following.json",
    JSON.stringify([
      null,
      { username: "ana", full_name: "Ana Silva", string_list_data: [] },
    ]),
  );
  expect(parsed.users).toEqual(["ana"]);
  expect(parsed.displayNames).toEqual({ ana: "Ana Silva" });
});
it("normaliza nomes de usuário do backup e preserva nomes já cadastrados", () => {
  const result = restoreFollowers(
    { users: ["@Ana", "ANA"], displayNames: { ana: "Nome antigo" } },
    {
      ...emptyFollowers,
      displayNames: { ana: "Ana Silva" },
    },
  );
  expect(result.users).toEqual(["ana"]);
  expect(result.displayNames.ana).toBe("Ana Silva");
});

it("calcula relações distintas e Todos inclui seguidores e seguindo sem duplicatas", () => {
  const result = followerRelations({ ...emptyFollowers, following: ["Ana", "bia"], followers: ["ana", "caio"], users: ["bia"] });
  expect(result.available).toBe(true);
  expect(result.groups).toEqual({ all: ["ana", "bia", "caio"], following: ["ana", "bia"], followers: ["ana", "caio"], notFollowingBack: ["bia"], fans: ["caio"], mutual: ["ana"] });
});
it("não inventa relações para backup legado ou lista ausente", () => {
  const result = followerRelations({ ...emptyFollowers, users: ["ana"], following: ["ana"] });
  expect(result.available).toBe(false);
  expect(result.groups.notFollowingBack).toEqual([]);
  expect(result.groups.all).toEqual(["ana"]);
});
it("reconhece lista vazia quando a importação registrou ambas as listas", () => {
  const result = followerRelations({ ...emptyFollowers, following: ["ana"], source: { name: "Exportação Instagram", updated: "2026-10-14T12:00:00Z", partial: false, following: 1, followers: 0 } });
  expect(result.available).toBe(true);
  expect(result.groups.notFollowingBack).toEqual(["ana"]);
});
it("importa JSON com BOM, título e link sem value", () => {
  const result = parseExport("following.json", '\uFEFF' + JSON.stringify({ relationships_following: [
    { title: "Ana", string_list_data: [{ href: "https://www.instagram.com/_u/ana/", timestamp: 10 }] },
    { string_list_data: [{ href: "https://www.instagram.com/bia/", timestamp: 20 }] }
  ] }));
  expect(result.users).toEqual(["ana", "bia"]);
  expect(result.timestamps).toEqual({ ana: 10000, bia: 20000 });
});
it("rejeita conteúdo não vazio que não reconhece, sem substituir a lista por vazio", () => {
  expect(() => parseExport("followers.json", JSON.stringify([{ unexpected: true }]))).toThrow("Nenhum perfil reconhecido");
});
it("importa arquivos numerados e combina todos os segmentos sem perder marcações", async () => {
  const zip = new JSZip();
  zip.file("connections/following_1.json", JSON.stringify({ relationships_following: [{ title: "ana", string_list_data: [{ timestamp: 10 }] }, { title: "bia" }] }));
  zip.file("connections/followers_1.json", JSON.stringify([{ string_list_data: [{ value: "ana" }] }]));
  zip.file("connections/followers_2.json", JSON.stringify([{ string_list_data: [{ value: "caio" }] }]));
  const result = await importZip(new Blob([new Uint8Array(await zip.generateAsync({ type: "uint8array" }))]), { ...emptyFollowers, protected: ["bia"] });
  expect(result.following).toEqual(["ana", "bia"]);
  expect(result.followers).toEqual(["ana", "caio"]);
  expect(result.users).toEqual(["bia"]);
  expect(result.protected).toEqual(["bia"]);
  expect(followerRelations(result).groups.mutual).toEqual(["ana"]);
});

it("importa JSON e HTML extraídos juntos e preserva marcações", async () => {
  const result = await importFollowerFiles([
    new File(['{"relationships_following":[{"title":"ana"},{"title":"bia"}]}'], "following.json"),
    new File(['<a href="https://www.instagram.com/ana/">ana</a>'], "followers_1.html"),
  ], { ...emptyFollowers, protected: ["bia"] });
  expect(result.following).toEqual(["ana", "bia"]);
  expect(result.followers).toEqual(["ana"]);
  expect(result.users).toEqual(["bia"]);
  expect(result.protected).toEqual(["bia"]);
});
it("rejeita importação avulsa incompleta com orientação", async () => {
  await expect(importFollowerFiles([new File(['[]'], "following.json")], emptyFollowers)).rejects.toThrow("Selecione following");
});
