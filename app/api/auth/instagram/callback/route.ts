import { callback } from "@/lib/server/oauth";
import { HttpError } from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    return await callback(req);
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof HttpError
            ? e.message
            : "Não foi possível conectar. Reinicie a conexão nas configurações.",
      },
      { status: e instanceof HttpError ? e.status : 502 },
    );
  }
}
