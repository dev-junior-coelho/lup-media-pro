import { afterEach, expect, it, vi } from "vitest";
import { identity } from "../lib/server/security";

const verifyIdToken = vi.hoisted(() => vi.fn());
vi.mock("../lib/server/firebase", () => ({
  admin: () => ({ auth: { verifyIdToken } }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  verifyIdToken.mockReset();
});
const request = () =>
  new Request("https://app.example/api/state", {
    headers: { authorization: "Bearer test-token" },
  });
it("valida o token e verifica revogação", async () => {
  verifyIdToken.mockResolvedValue({ uid: "user" });
  await expect(identity(request())).resolves.toEqual({ uid: "user" });
  expect(verifyIdToken).toHaveBeenCalledWith("test-token", true);
});
it.each([
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/argument-error",
  "auth/user-disabled",
])("rejeita sessão inválida: %s", async (code) => {
  verifyIdToken.mockRejectedValue({ code });
  await expect(identity(request())).rejects.toMatchObject({ status: 401 });
});
it.each([
  "auth/internal-error",
  "auth/insufficient-permission",
  "app/invalid-credential",
])("distingue falha do servidor de sessão inválida: %s", async (code) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  verifyIdToken.mockRejectedValue({ code, message: "sensitive detail" });
  await expect(identity(request())).rejects.toMatchObject({ status: 503 });
  expect(log).toHaveBeenCalledWith(
    "Falha ao validar sessão no Firebase:",
    code,
  );
});
it("exige autenticação antes de consultar o Firebase", async () => {
  await expect(
    identity(new Request("https://app.example/api/state")),
  ).rejects.toMatchObject({ status: 401 });
  expect(verifyIdToken).not.toHaveBeenCalled();
});
