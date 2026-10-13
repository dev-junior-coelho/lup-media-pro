import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  compare,
  parseExport,
  restoreFollowers,
  importZip,
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
