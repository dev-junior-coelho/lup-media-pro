import { afterEach, expect, it, vi } from "vitest";
import { exchangeCode } from "../lib/server/meta";

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
