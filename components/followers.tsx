"use client";
import { useState } from "react";
import { Heart, Check, Undo2, ExternalLink, Users } from "lucide-react";
import type { Followers } from "@/lib/shared/schema";
import { profileLink, compare } from "@/lib/shared/followers";
export function FollowerManager({
  data,
  mode,
  onSave,
  onImport,
}: {
  data: Followers;
  mode: string;
  onSave: (d: Followers) => Promise<void>;
  onImport: () => void;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(mode === "protected" ? "safe" : "pending"),
    [sort, setSort] = useState("az"),
    [shown, setShown] = useState(50),
    [position, setPosition] = useState(0),
    [undo, setUndo] = useState<Followers[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const done = new Set(data.completed),
    safe = new Set(data.protected),
    pending = data.users.filter((u) => !done.has(u) && !safe.has(u));
  const comparisons = compare(data.following, data.followers);
  let users =
    filter === "fans"
      ? comparisons.fans
      : filter === "mutual"
        ? comparisons.mutual
        : data.users;
  users = users
    .filter(
      (u) =>
        u.includes(search.toLowerCase().replace(/^@/, "")) &&
        (filter === "pending"
          ? !done.has(u) && !safe.has(u)
          : filter === "done"
            ? done.has(u)
            : filter === "safe"
              ? safe.has(u)
              : true),
    )
    .sort((a, b) =>
      sort === "za"
        ? b.localeCompare(a)
        : sort === "newest" || sort === "oldest"
          ? (sort === "newest" ? -1 : 1) *
            ((data.timestamps[a] ?? 0) - (data.timestamps[b] ?? 0))
          : a.localeCompare(b),
    );
  async function mark(user: string, action: "done" | "protected") {
    if (busy) return;
    setBusy(true);
    setError("");
    const before = data;
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
    try {
      await onSave(next);
      setUndo([...undo, before].slice(-30));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function undoAction() {
    const previous = undo.at(-1);
    if (!previous) return;
    setBusy(true);
    try {
      await onSave(previous);
      setUndo(undo.slice(0, -1));
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
  return (
    <div className="followershost">
      <div className="metrics">
        {[
          ["Na lista", data.users.length],
          ["Pendentes", pending.length],
          ["Concluídos", data.users.filter((u) => done.has(u)).length],
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
              ? Math.round(
                  (data.users.filter((u) => done.has(u)).length /
                    data.users.length) *
                    100,
                )
              : 0
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso de seguidores"
        >
          <div
            style={{
              width: `${data.users.length ? (data.users.filter((u) => done.has(u)).length / data.users.length) * 100 : 0}%`,
            }}
          />
        </div>
        <button
          className="qsmall button-icon"
          disabled={!undo.length || busy}
          onClick={() => void undoAction()}
        >
          <Undo2 size={15} />
          Desfazer
        </button>
      </div>
      {data.source?.partial && (
        <div className="callout">
          A exportação pode conter somente parte dos seguidores. Solicite “Todo
          o período”. Não seguir de volta não significa ter deixado de seguir
          recentemente.
        </div>
      )}
      {error && (
        <div className="error-alert" role="alert">
          {error}
        </div>
      )}
      {mode === "quick" ? (
        <section className="quick-shell">
          <div className="quick-card">
            <div className="quick-meta">
              <span>Modo rápido</span>
              <span>{pending.length} pendentes</span>
            </div>
            <div className="quick-avatar">{q?.[0].toUpperCase() ?? "✓"}</div>
            <h2 className="quick-name">{q ? "@" + q : "Tudo em dia"}</h2>
            <p className="quick-hint">
              {q
                ? "Não aparece como seguidor na exportação."
                : "Importe uma lista para começar."}
            </p>
            {q && (
              <>
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
                    disabled={busy}
                    onClick={() => void mark(q, "done")}
                  >
                    ✓ Marcar feito
                  </button>
                  <button
                    className="linebutton"
                    disabled={busy}
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
                  <span className="hdate">
                    {new Date(h.at).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="info">@{h.user}</span>
                  <span>{h.action}</span>
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
              placeholder="Pesquisar @usuário"
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
              onChange={(e) => setSort(e.target.value)}
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
          <div className="chips">
            {[
              ["pending", "Pendentes"],
              ["all", "Todos"],
              ["done", "Concluídos"],
              ["safe", "Protegidos"],
              ["fans", "Me seguem"],
              ["mutual", "Mútuos"],
            ].map(([v, l]) => (
              <button
                className={`chip ${filter === v ? "active" : ""}`}
                key={v}
                onClick={() => {
                  setFilter(v);
                  setShown(50);
                }}
              >
                {l}
              </button>
            ))}
          </div>
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
                    href={link(u)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={14} />
                  </a>
                  <button
                    className={`mini ${done.has(u) ? "done" : ""}`}
                    aria-label={`Marcar concluído @${u}`}
                    disabled={busy}
                    onClick={() => void mark(u, "done")}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className={`mini ${safe.has(u) ? "safe" : ""}`}
                    aria-label={`Proteger @${u}`}
                    disabled={busy}
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
              Importe a exportação do Instagram ou os dados anteriores.
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
