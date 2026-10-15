"use client";
import { useEffect, useRef, useState } from "react";
import type { FollowerChangePage, FollowerComparison } from "@/lib/shared/follower-changes";
import { displayDate } from "@/lib/shared/presentation";
import { profileLink } from "@/lib/shared/followers";
export function FollowerChanges({ load, timezone }: { load: (cursor?: string) => Promise<FollowerChangePage>; timezone: string }) {
  const loader = useRef(load);
  const [items, setItems] = useState<FollowerComparison[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("lost");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    loader.current().then((page) => {
      if (active) { setItems(page.comparisons); setCursor(page.cursor); }
    }).catch((error: Error) => { if (active) setError(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function more() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const page = await loader.current(cursor ?? undefined);
      setItems((current) => [...new Map([...current, ...page.comparisons].map((item) => [item.id, item])).values()]);
      setCursor(page.cursor);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const query = search.trim().replace(/^@/, "").toLowerCase();
  const events = items.flatMap((item) => item.changes.map((change) => ({ ...change, comparison: item })))
    .filter((event) => (filter === "all" || filter === event.type) && event.user.includes(query));
  return <section className="panel follower-changes" aria-label="Histórico de seguidores">
    <h2>Quem deixou de seguir</h2>
    <p className="lightnote">Comparação entre a lista anterior e a nova, preservada por conta a cada importação. As datas são das importações, não o dia exato da saída. Use exportações em ordem cronológica e de Todo o período. Uma ausência também pode ocorrer por mudança de usuário, desativação ou exportação incompleta.</p>
    {items[0] && <div className="follower-source-note">
      <strong>{items[0].baseline ? "Lista inicial registrada" : "Comparação mais recente"}</strong>
      <p>{items[0].from ? `De ${displayDate(items[0].from, timezone)} até ` : "Importada em "}{displayDate(items[0].at, timezone)}</p>
      {items[0].baseline ? <p>Esta importação estabeleceu a base. Nenhuma saída foi presumida.</p> : <p>{items[0].lost} ausentes • {items[0].gained} novos ou retornaram.</p>}
      {items[0].partial && <p>Uma das listas pode estar parcial. As ausências precisam ser conferidas antes de concluir que alguém deixou de seguir.</p>}
    </div>}
    <div className="controls">
      <input className="search" aria-label="Pesquisar no histórico carregado" placeholder="Pesquisar @usuário no histórico carregado" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="sort" aria-label="Tipo de mudança" value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="lost">Deixaram de seguir / ausentes</option>
        <option value="gained">Novos seguidores / retornaram</option>
        <option value="all">Todas as mudanças</option>
      </select>
    </div>
    {busy && <p role="status">Carregando histórico…</p>}
    {error && <div className="error-alert" role="alert">{error}<button className="linebutton" disabled={busy} onClick={() => void more()}>Tentar novamente</button></div>}
    {!busy && !error && !items.length && <p className="empty-state">Nenhuma comparação registrada ainda. Importe uma nova exportação para comparar com os seguidores já salvos. Se ainda não houver uma lista anterior, a primeira importação será a base.</p>}
    <p className="lightnote">{events.length} registros encontrados nas páginas carregadas. Use “Carregar registros anteriores” para consultar períodos mais antigos. Uma pessoa pode aparecer mais de uma vez se sair e retornar em períodos diferentes.</p>
    <div className="follow-list">
      {events.map((event) => <article className="follower-change-row" key={`${event.comparison.id}:${event.type}:${event.user}`}>
        <div>
          <a className="handle" href={profileLink(event.user, "web", false)} target="_blank" rel="noopener noreferrer">@{event.user} ↗</a>
          <span className="follower-relation" data-relation={event.type === "lost" ? "not-following-back" : "mutual"}>
            <span className="follower-relation-dot" aria-hidden="true" />
            {event.comparison.partial ? event.type === "lost" ? "Ausente · lista possivelmente parcial" : "Apareceu · lista possivelmente parcial" : event.type === "lost" ? "Deixou de aparecer nos seguidores" : "Novo seguidor ou retornou"}
          </span>
        </div>
        <p className="lightnote">Entre {event.comparison.from ? displayDate(event.comparison.from, timezone) : "a lista anterior"} e {displayDate(event.comparison.at, timezone)}</p>
      </article>)}
    </div>
    {!busy && !error && items.length > 0 && !events.length && <p className="empty-state">Nenhuma mudança corresponde aos filtros nesta página. A primeira lista apenas estabelece a base; importações sem alterações não registram saídas.</p>}
    {cursor && <button className="more" disabled={busy} onClick={() => void more()}>Carregar registros anteriores</button>}
  </section>;
}
