import { afterEach, expect, it, vi } from "vitest";
import { exchangeCode, MetaClient } from "../lib/server/meta";

afterEach(() => vi.unstubAllGlobals());

it.each([
  { access_token: "short-fixture", user_id: "123" },
  { data: [{ access_token: "short-fixture", user_id: "123" }] },
])("troca o token direto ou dentro de data sem enviar undefined", async (short) => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json(short))
    .mockResolvedValueOnce(Response.json({ access_token: "long-fixture", expires_in: 5184000 }));
  vi.stubGlobal("fetch", request);
  const token = await exchangeCode("code-fixture", "https://app.example/callback");
  const url = new URL(String(request.mock.calls[1][0]));
  expect(url.searchParams.get("access_token")).toBe("short-fixture");
  expect(token.access_token).toBe("long-fixture");
});

it("rejeita resposta curta sem token antes da próxima requisição", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ data: [] }));
  vi.stubGlobal("fetch", request);
  await expect(exchangeCode("fixture", "https://app.example/callback"))
    .rejects.toMatchObject({ operation: "short_token_response" });
  expect(request).toHaveBeenCalledTimes(1);
});

it("rejeita token longo sem validade antes de gravar a conta", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "short-fixture" }))
    .mockResolvedValueOnce(Response.json({ access_token: "long-fixture" }));
  vi.stubGlobal("fetch", request);
  await expect(exchangeCode("fixture", "https://app.example/callback"))
    .rejects.toMatchObject({ operation: "long_token_response" });
});

it.each([
  { permissions: "instagram_business_basic,instagram_business_content_publish" },
  { permissions: ["instagram_business_basic", "instagram_business_content_publish"] },
])("preserva as permissões efetivamente concedidas na resposta Meta", async ({ permissions }) => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [{ access_token: "short-fixture", permissions }] }))
    .mockResolvedValueOnce(Response.json({ access_token: "long-fixture", expires_in: 5184000 })));
  const token = await exchangeCode("fixture", "https://app.example/callback");
  expect(token.permissions).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
});

it("consulta permissões e revogação da identidade autenticada pelo token", async () => {
  const request = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ data: [] })));
  vi.stubGlobal("fetch", request);
  const client = new MetaClient("fixture");
  await client.permissions();
  await client.revoke();
  for (const [url] of request.mock.calls)
    expect(new URL(String(url)).pathname).toBe("/v24.0/me/permissions");
  expect(request.mock.calls[1][1].method).toBe("DELETE");
});

it("mantém o tipo desconhecido quando o campo opcional não existe e preserva perfil", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: "123", user_id: "456", username: "fixture" }))
    .mockResolvedValueOnce(Response.json({ error: { code: 100 } }, { status: 400 }));
  vi.stubGlobal("fetch", request);
  expect(await new MetaClient("fixture").me()).toEqual({
    id: "123", user_id: "456", username: "fixture", account_type: "UNKNOWN",
  });
});

it("falha no perfil básico com identificação exata da etapa", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: 100 } }, { status: 400 })));
  await expect(new MetaClient("fixture").me()).rejects.toMatchObject({ code: 100, operation: "profile" });
});
