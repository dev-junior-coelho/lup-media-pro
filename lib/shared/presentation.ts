import { formatInTimeZone } from "date-fns-tz";
import type { Post } from "./schema";

export const statusNames: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  processing: "Em preparação",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};
export const typeNames: Record<string, string> = {
  post: "Post",
  carousel: "Carrossel",
  reel: "Reel",
  story: "Story",
};
export const accountStatusNames: Record<string, string> = {
  connected: "Conectada",
  disconnected: "Desconectada",
  reconnect_required: "Precisa reconectar",
};
export const followerActionNames: Record<string, string> = {
  done: "Marcado como concluído",
  undone: "Marcação desfeita",
  protected: "Perfil protegido",
  unprotected: "Proteção removida",
};
export function displayDate(value: string | undefined, timezone: string) {
  return value && Number.isFinite(Date.parse(value))
    ? formatInTimeZone(value, timezone, "dd/MM/yyyy 'às' HH:mm")
    : "Data não disponível";
}
export function filterPosts(
  posts: Post[],
  filters: {
    status: string;
    account: string;
    term: string;
    from: string;
    until: string;
  },
  timezone: string,
) {
  const term = filters.term.trim().toLocaleLowerCase("pt-BR");
  return posts.filter((post) => {
    const date =
      post.scheduledAt && Number.isFinite(Date.parse(post.scheduledAt))
        ? formatInTimeZone(post.scheduledAt, timezone, "yyyy-MM-dd")
        : "";
    return (
      (filters.status === "all" || post.status === filters.status) &&
      (filters.account === "all" || post.accountId === filters.account) &&
      post.caption.toLocaleLowerCase("pt-BR").includes(term) &&
      (!filters.from || Boolean(date && date >= filters.from)) &&
      (!filters.until || Boolean(date && date <= filters.until))
    );
  });
}
export function postsCsv(posts: Post[], timezone: string) {
  const rows = [
    ["Tipo", "Situação", `Data (${timezone})`, "Legenda", "Observação"],
    ...posts.map((p) => [
      typeNames[p.type] ?? "Publicação",
      statusNames[p.status] ?? "Atualização",
      p.scheduledAt ? displayDate(p.scheduledAt, timezone) : "Sem data",
      p.caption,
      p.error ?? "",
    ]),
  ];
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              (/^[\s]*[=+@-]/.test(value) ? "'" : "") +
              value.replaceAll('"', '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n")
  );
}
