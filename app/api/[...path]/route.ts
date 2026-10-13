import { api } from "@/lib/server/api";
import { HttpError } from "@/lib/server/security";
import { ZodError } from "zod";
export const runtime = "nodejs";
async function handler(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    return await api(req, (await ctx.params).path);
  } catch (e) {
    if (!(e instanceof HttpError) && !(e instanceof ZodError))
      console.error("api_failure", {
        name: e instanceof Error ? e.name : "unknown",
        frames: e instanceof Error ? e.stack?.split("\n").slice(1, 4) : [],
      });
    const status =
      e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500;
    return Response.json(
      {
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof ZodError
              ? "Dados inválidos. Verifique os campos."
              : "Não foi possível concluir a operação. Verifique a configuração do servidor.",
      },
      { status },
    );
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
