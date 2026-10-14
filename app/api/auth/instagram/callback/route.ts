import { callback } from "@/lib/server/oauth";
import { HttpError } from "@/lib/server/security";
import { MetaError } from "@/lib/server/meta";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    return await callback(req);
  } catch (e) {
    if (!(e instanceof HttpError))
      console.error("instagram_callback_failed", {
        category: e instanceof MetaError ? "meta" : "internal",
        code: e instanceof MetaError ? e.code : undefined,
        operation: e instanceof MetaError ? e.operation : undefined,
      });
    return Response.json(
      {
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof MetaError
              ? `Instagram recusou a conexão (código ${e.code}, etapa ${e.operation ?? "perfil ou permissões"}). Reinicie a conexão nas configurações.`
              : "Não foi possível conectar. Reinicie a conexão nas configurações.",
      },
      { status: e instanceof HttpError ? e.status : 502 },
    );
  }
}
