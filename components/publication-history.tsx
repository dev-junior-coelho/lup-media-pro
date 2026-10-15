import { formatInTimeZone } from "date-fns-tz";
import { CheckCircle, Clock, AlertTriangle, FileText } from "lucide-react";
import type { Post, Account } from "@/lib/shared/schema";

export interface PublicationEvent {
  id: string;
  postId?: string;
  accountId?: string;
  caption?: string;
  at: string;
  status?: string;
  error?: string;
}
const labels: Record<string, string> = {
  draft: "Rascunho salvo",
  scheduled: "Publicação agendada",
  processing: "Preparando publicação",
  published: "Publicação enviada ao Instagram",
  failed: "Não foi possível publicar",
  cancelled: "Publicação cancelada",
};

export function PublicationHistory({
  history,
  posts,
  timezone,
  accounts = [],
}: {
  history: PublicationEvent[];
  posts: Post[];
  accounts?: Account[];
  timezone: string;
}) {
  const lastByPost = new Map<string, string>();
  const events = history
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((event) => {
      if (!event.status && !event.error) return false;
      const key = event.postId ?? event.id;
      const signature = JSON.stringify([
        event.status,
        event.error,
        event.caption,
      ]);
      const duplicate = lastByPost.get(key) === signature;
      lastByPost.set(key, signature);
      return !duplicate;
    });
  return (
    <section className="procard publication-history" style={{ marginTop: 15 }}>
      <h2>Histórico de publicação</h2>
      <p className="mutedcopy">
        Acompanhe o que aconteceu com suas publicações, da mais recente à mais
        antiga.
      </p>
      {events.length ? (
        <ul className="publication-events">
          {events.map((event) => {
            const post = posts.find((p) => p.id === event.postId);
            const caption = (event.caption ?? post?.caption)
              ?.replace(/\s+/g, " ")
              .trim();
            const title = caption
              ? caption.length > 100
                ? `${caption.slice(0, 100)}…`
                : caption
              : post
                ? "Publicação sem legenda"
                : "Publicação anterior";
            const failed = event.status === "failed" || Boolean(event.error);
            const Icon = failed
              ? AlertTriangle
              : event.status === "published"
                ? CheckCircle
                : event.status === "processing" || event.status === "scheduled"
                  ? Clock
                  : FileText;
            const validDate = Number.isFinite(Date.parse(event.at));
            return (
              <li key={event.id} className="publication-event">
                <Icon
                  size={20}
                  aria-hidden="true"
                  className={failed ? "event-warning" : "event-icon"}
                />
                <div className="publication-event-content">
                  <strong>
                    {labels[event.status ?? ""] ??
                      (failed
                        ? "Publicação precisa de atenção"
                        : "Informações da publicação atualizadas")}
                  </strong>
                  <p className="publication-event-caption">{title}</p>
                  {accounts.find(
                    (account) =>
                      account.id === (event.accountId ?? post?.accountId),
                  ) && (
                    <p className="mutedcopy">
                      @
                      {
                        accounts.find(
                          (account) =>
                            account.id === (event.accountId ?? post?.accountId),
                        )!.username
                      }
                    </p>
                  )}
                  {failed && (
                    <p className="mutedcopy">
                      Confira a publicação e a conexão com o Instagram antes de
                      tentar novamente.
                    </p>
                  )}
                  {validDate ? (
                    <time className="mutedcopy" dateTime={event.at}>
                      {formatInTimeZone(
                        event.at,
                        timezone,
                        "dd/MM/yyyy 'às' HH:mm",
                      )}
                    </time>
                  ) : (
                    <span className="mutedcopy">Data não disponível</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-state">
          Quando você agendar ou enviar uma publicação, as atualizações
          aparecerão aqui.
        </p>
      )}
    </section>
  );
}
