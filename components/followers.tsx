"use client";
import { FollowerChanges } from "./follower-changes";
import type { FollowerChangePage } from "@/lib/shared/follower-changes";
import { useState } from "react";
import { Heart, Check, Undo2, ExternalLink, Users } from "lucide-react";
import type { Followers } from "@/lib/shared/schema";
import { displayDate, followerActionNames } from "@/lib/shared/presentation";
import { profileLink, followerRelations } from "@/lib/shared/followers";
export function FollowerManager({
  data,
  mode,
  timezone,
  onSave,
  onImport,
  onLoadChanges,
  readOnly = false,
}: {
  data: Followers;
  mode: string;
  readOnly?: boolean;
  timezone: string;
  onSave: (d: Followers) => Promise<void>;
  onImport: () => void;
  onLoadChanges?: (cursor?: string) => Promise<FollowerChangePage>;
}) {
  const [view, setView] = useState("profiles");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState<keyof ReturnType<typeof followerRelations>["groups"]>("all"),
    [status, setStatus] = useState(mode === "protected" ? "safe" : "all"),
    [sort, setSort] = useState("az"),
    [shown, setShown] = useState(50),
    [position, setPosition] = useState(0),
    [undo, setUndo] = useState<
      { user: string; completed: boolean; protected: boolean }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editingName, setEditingName] = useState<string | null>(null),
    [name, setName] = useState("");
  const done = new Set(data.completed),
    safe = new Set(data.protected),
    pending = data.users.filter((u) => !done.has(u) && !safe.has(u));
  const { available, groups } = followerRelations(data);
  const followingSet = new Set(groups.following), followerSet = new Set(groups.followers);
  const relationLabel = (user: string) => !available ? "Relação não confirmada" :
    followingSet.has(user) && followerSet.has(user) ? "Mútuo" :
    followingSet.has(user) ? "Não me segue de volta" : followerSet.has(user) ? "Não sigo de volta" : "Fora das listas importadas";
  const query = search.trim().replace(/^@/, "").toLocaleLowerCase("pt-BR");
  const statusMatches = (u: string) => status === "pending" ? !done.has(u) && !safe.has(u) :
    status === "done" ? done.has(u) : status === "safe" ? safe.has(u) : true;
  const users = groups[filter].filter((u) => statusMatches(u) &&
    (u.includes(query) || data.displayNames?.[u]?.toLocaleLowerCase("pt-BR").includes(query)))
    .sort((a, b) => {
      if (sort === "newest" || sort === "oldest") {
        const ta = data.timestamps[a], tb = data.timestamps[b];
        if (!ta && tb) return 1;
        if (ta && !tb) return -1;
        const delta = (ta ?? 0) - (tb ?? 0);
        if (delta) return (sort === "newest" ? -1 : 1) * delta;
      }
      return sort === "za" ? b.localeCompare(a, "pt-BR") : a.localeCompare(b, "pt-BR");
    });
  async function mark(user: string, action: "done" | "protected") {
    if (busy || readOnly) return;
    setBusy(true);
    setError("");
    const before = {
      user,
      completed: done.has(user),
      protected: safe.has(user),
    };
    const next: Followers = {
      ...data,
      completed: [...data.completed],
      protected: [...data.protected],
      history: [...data.history],
    };
    let historyAction: "done" | "undone" | "protected" | "unprotected";
    if (action === "done") {
      next.completed = done.has(user)
        ? next.completed.filter((u) => u !== user)
        : [...next.completed, user];
      next.protected = next.protected.filter((u) => u !== user);
      historyAction = done.has(user) ? "undone" : "done";
    } else {
      next.protected = safe.has(user)
        ? next.protected.filter((u) => u !== user)
        : [...next.protected, user];
      next.completed = next.completed.filter((u) => u !== user);
      historyAction = safe.has(user) ? "unprotected" : "protected";
    }
    next.history.push({
      at: new Date().toISOString(),
      user,
      action: historyAction,
    });
    next.history = next.history.slice(-10000);
    try {
      await onSave(next);
      setUndo((current) => [...current, before].slice(-30));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function undoAction() {
    const previous = undo.at(-1);
    if (!previous || busy || readOnly) return;
    setError("");
    setBusy(true);
    try {
      await onSave({
        ...data,
        completed: [
          ...data.completed.filter((user) => user !== previous.user),
          ...(previous.completed ? [previous.user] : []),
        ],
        protected: [
          ...data.protected.filter((user) => user !== previous.user),
          ...(previous.protected ? [previous.user] : []),
        ],
        history: [
          ...data.history,
          {
            at: new Date().toISOString(),
            user: previous.user,
            action: previous.protected
              ? "protected"
              : previous.completed
                ? "done"
                : safe.has(previous.user)
                  ? "unprotected"
                  : "undone",
          } as Followers["history"][number],
        ].slice(-10000),
      });
      setUndo((current) => current.slice(0, -1));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const link = (u: string, web = false) =>
    profileLink(
      u,
      web ? "web" : data.linkMode,
      typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent),
    );
  const q = pending.length ? pending[position % pending.length] : null;
  const completedCount = data.users.filter((u) => done.has(u)).length;
  async function saveName(user: string) {
    if (busy || readOnly) return;
    setBusy(true);
    setError("");
    try {
      const displayNames = { ...data.displayNames };
      if (name.trim()) displayNames[user] = name.trim();
      else delete displayNames[user];
      await onSave({ ...data, displayNames });
      setEditingName(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="followershost">
      {mode === "followers" && (
        <>
          <div className="metrics">
            {[
              ["Na lista de revisão", data.users.length],
              ["Pendentes", pending.length],
              ["Concluídos", completedCount],
              ["Protegidos", data.users.filter((u) => safe.has(u)).length],
            ].map(([label, n]) => (
              <div className="metric" key={label}>
                <div className="num">{Number(n).toLocaleString("pt-BR")}</div>
                <div className="txt">{label}</div>
              </div>
            ))}
          </div>
          <div className="progress-card">
            <span>Progresso</span>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={
                data.users.length
                  ? Math.round((completedCount / data.users.length) * 100)
                  : 0
              }
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progresso de seguidores"
            >
              <div
                style={{
                  width: `${data.users.length ? (completedCount / data.users.length) * 100 : 0}%`,
                }}
              />
            </div>
            <button
              className="qsmall button-icon"
              disabled={!undo.length || busy || readOnly}
              onClick={() => void undoAction()}
            >
              <Undo2 size={15} />
              Desfazer
            </button>
          </div>
          {data.source?.partial && (
            <div className="callout">
              A exportação pode conter somente parte dos seguidores. Solicite
              “Todo o período”. Não seguir de volta não significa ter deixado de
              seguir recentemente.
            </div>
          )}
        </>
      )}
      {error && (
        <div className="error-alert" role="alert">
          {error}
        </div>
      )}
      {mode === "followers" && onLoadChanges && <div className="chips follower-view-tabs" role="group" aria-label="Visão dos seguidores">
        <button className={`chip ${view === "profiles" ? "active" : ""}`} aria-pressed={view === "profiles"} onClick={() => setView("profiles")}>Perfis e relações</button>
        <button className={`chip ${view === "changes" ? "active" : ""}`} aria-pressed={view === "changes"} onClick={() => setView("changes")}>QUEM DEIXOU DE SEGUIR · HISTÓRICO</button>
      </div>}
      {mode === "followers" && view === "changes" && onLoadChanges ? <FollowerChanges load={onLoadChanges} timezone={timezone} /> : mode === "quick" ? (
        <section className="quick-shell">
          <div className="quick-card">
            <div className="quick-meta">
              <span>Modo rápido</span>
              <span>
                {pending.length.toLocaleString("pt-BR")}{" "}
                {pending.length === 1 ? "pendente" : "pendentes"}
              </span>
            </div>
            <div className="quick-avatar">
              {(q ? (data.displayNames?.[q]?.[0] ?? q[0]) : "✓").toUpperCase()}
            </div>
            <h2 className="quick-name">
              {q
                ? (data.displayNames?.[q] ?? "Nome não informado")
                : "Tudo em dia"}
            </h2>
            {q && (
              <>
                <p className="quick-handle">@{q}</p>
                {editingName === q ? (
                  <form
                    className="quick-name-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveName(q);
                    }}
                  >
                    <label className="formlabel" htmlFor="profile-name">
                      Nome da pessoa
                    </label>
                    <input
                      id="profile-name"
                      className="proinput"
                      autoFocus
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <div className="flex">
                      <button
                        className="linebutton"
                        disabled={busy || readOnly}
                      >
                        Salvar nome
                      </button>
                      <button
                        type="button"
                        className="qsmall"
                        disabled={busy || readOnly}
                        onClick={() => setEditingName(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className="qsmall"
                    disabled={busy || readOnly}
                    onClick={() => {
                      setName(data.displayNames?.[q] ?? "");
                      setEditingName(q);
                    }}
                  >
                    {data.displayNames?.[q] ? "Editar nome" : "Adicionar nome"}
                  </button>
                )}
              </>
            )}
            <p className="quick-hint">
              {q
                ? available ? "Não aparece como seguidor na exportação." : "Perfil da lista de revisão; relação não confirmada."
                : data.users.length
                  ? "Todos os perfis foram revisados ou protegidos."
                  : "Importe uma lista para começar."}
            </p>
            {q && (
              <>
                {data.source?.partial && (
                  <p className="lightnote">
                    A lista importada pode estar incompleta. Confira o perfil no
                    Instagram.
                  </p>
                )}
                <a
                  className="gradientbtn fullwidth"
                  href={link(q)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir perfil no Instagram ↗
                </a>
                <div className="quick-actions">
                  <button
                    className="linebutton"
                    disabled={busy || readOnly}
                    onClick={() => void mark(q, "done")}
                  >
                    ✓ Marcar feito
                  </button>
                  <button
                    className="linebutton"
                    disabled={busy || readOnly}
                    onClick={() => void mark(q, "protected")}
                  >
                    ♡ Proteger
                  </button>
                </div>
                <div className="quick-footer">
                  <a
                    className="qsmall"
                    href={link(q, true)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir na web
                  </a>
                  <button
                    className="qsmall"
                    onClick={() => setPosition(position + 1)}
                  >
                    Pular →
                  </button>
                </div>
                <p className="quick-tip">
                  Deixe de seguir manualmente no Instagram, volte e marque como
                  concluído. O gerenciador não automatiza essa ação.
                </p>
              </>
            )}
          </div>
        </section>
      ) : mode === "history" ? (
        <section className="procard">
          <h2>Histórico de marcações</h2>
          {data.history.length === 0 ? (
            <p className="empty-state">Nenhuma marcação registrada.</p>
          ) : (
            data.history
              .slice(-200)
              .reverse()
              .map((h, i) => (
                <div className="history-row" key={i}>
                  <span className="hdate">{displayDate(h.at, timezone)}</span>
                  <span className="info">@{h.user}</span>
                  <span>
                    {followerActionNames[h.action] ?? "Marcação atualizada"}
                  </span>
                </div>
              ))
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="controls">
            <input
              className="search"
              aria-label="Pesquisar perfis"
              placeholder="Pesquisar @usuário ou nome"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(50);
              }}
            />
            <select
              className="sort"
              aria-label="Ordenar perfis"
              value={sort}
              onChange={(e) => { setSort(e.target.value); setShown(50); }}
            >
              {[
                ["az", "Nome A–Z"],
                ["za", "Nome Z–A"],
                ["newest", "Seguidos recentemente"],
                ["oldest", "Seguidos há mais tempo"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {!available && <div className="callout" role="status">
            <strong>A lista de revisão não contém as listas de seguidores e seguindo.</strong>
            <p>Os {data.users.length.toLocaleString("pt-BR")} perfis antigos continuam em Todos. Para comparar relações, importe o ZIP do Instagram ou os arquivos de seguidores e seguindo juntos.</p>
            <button className="linebutton" onClick={onImport}>Importar seguidores e seguindo</button>
          </div>}
          <div className="follower-source-note">
            {data.source ? <p>Fonte: {data.source.name} • Importado em {displayDate(data.source.updated, timezone)}.</p> : <p>Dados importados; sem atualização em tempo real.</p>}
            <p>{available ? "Relações calculadas pelas listas importadas, na data da exportação. Não me seguem de volta: você segue, mas não aparecem entre seus seguidores. Não sigo de volta: seguem você e você não os segue. Mútuos: ambos se seguem." : "Importe as duas listas (seguidores e seguindo) para confirmar as relações. Uma lista antiga de revisão não permite essa comparação."}</p>
            {data.source?.partial && <p role="status">Possível exportação parcial: relações podem estar incompletas. Importe Todo o período.</p>}
          </div>
          <div className="chips" role="group" aria-label="Filtrar por relação">
            {[
              ["all", "TODOS"],
              ["following", "TOTAL QUE EU SIGO"],
              ["followers", "TOTAL QUE ME SEGUEM"],
              ["notFollowingBack", "NÃO ME SEGUEM DE VOLTA"],
              ["fans", "NÃO SIGO DE VOLTA"],
              ["mutual", "MÚTUOS"],
            ].map(([v, l]) => (
              <button
                className={`chip ${filter === v ? "active" : ""}`}
                key={v}
                aria-pressed={filter === v}
                disabled={!available && v !== "all" && !groups[v as keyof typeof groups].length}
                onClick={() => {
                  setFilter(v as keyof typeof groups);
                  setShown(50);
                }}
              >
                {l} ({!available && v !== "all" && !groups[v as keyof typeof groups].length ? "—" : groups[v as keyof typeof groups].length})
              </button>
            ))}
          </div>
          <label className="follower-status-filter">
            Marcação
            <select className="sort" value={status} onChange={(e) => { setStatus(e.target.value); setShown(50); }}>
              <option value="all">Todas as marcações</option>
              <option value="pending">Pendentes</option>
              <option value="done">Concluídos</option>
              <option value="safe">Protegidos</option>
            </select>
          </label>
          <p className="lightnote">Marcações são controles locais de revisão. Ordenação por data usa o registro de seguindo; perfis sem data ficam no final.</p>
          <div className="list-head">
            <span>
              {users.length} perfis • {Math.min(shown, users.length)} exibidos
            </span>
            <button className="qsmall" onClick={onImport}>
              Importar dados
            </button>
          </div>
          <div className="profiles follow-list">
            {users.slice(0, shown).map((u) => (
              <article
                className={`profile ${done.has(u) ? "done" : safe.has(u) ? "safe" : ""}`}
                key={u}
              >
                <div className="avatar">{u[0].toUpperCase()}</div>
                <div className="info">
                  <a
                    className="handle"
                    href={link(u)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @{u}
                  </a>
                  {data.displayNames?.[u] && (
                    <div className="profile-display-name">
                      {data.displayNames[u]}
                    </div>
                  )}
                  <span
                    className="follower-relation"
                    data-relation={!available ? "unknown" : followingSet.has(u) && followerSet.has(u) ? "mutual" : followingSet.has(u) ? "not-following-back" : followerSet.has(u) ? "fan" : "unknown"}
                  >
                    <span className="follower-relation-dot" aria-hidden="true" />
                    {relationLabel(u)}
                  </span>
                  <div className="sub">
                    {done.has(u)
                      ? "Concluído"
                      : safe.has(u)
                        ? "Protegido"
                        : "Pendente"}
                  </div>
                </div>
                <div className="row-actions">
                  <a
                    className="open"
                    aria-label={`Abrir perfil @${u}`}
                    href={link(u)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  <button
                    className={`mini ${done.has(u) ? "done" : ""}`}
                    aria-label={`Marcar concluído @${u}`}
                    disabled={busy || readOnly}
                    onClick={() => void mark(u, "done")}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className={`mini ${safe.has(u) ? "safe" : ""}`}
                    aria-label={`Proteger @${u}`}
                    disabled={busy || readOnly}
                    onClick={() => void mark(u, "protected")}
                  >
                    <Heart size={15} />
                  </button>
                  <a
                    className="mini"
                    href={link(u, true)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Web
                  </a>
                </div>
              </article>
            ))}
          </div>
          {users.length === 0 && (
            <div className="empty-state">
              <Users size={30} />
              Nenhum perfil encontrado.
              <br />
              {groups.all.length ? "Ajuste a busca ou os filtros para ver outros perfis." : "Importe a exportação do Instagram para começar."}
            </div>
          )}
          {users.length > shown && (
            <button className="more" onClick={() => setShown(shown + 50)}>
              Mostrar mais
            </button>
          )}
        </section>
      )}
    </div>
  );
}
