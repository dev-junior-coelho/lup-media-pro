"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { ref, uploadBytesResumable } from "firebase/storage";
import { formatInTimeZone } from "date-fns-tz";
import {
  Instagram,
  LayoutDashboard,
  CalendarDays,
  Image,
  Users,
  Zap,
  Heart,
  History,
  Upload,
  Download,
  Settings,
  BarChart3,
  Megaphone,
  Menu,
  Plus,
  LogOut,
  Clock,
  CheckCircle,
  FileText,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import { Auth } from "./auth";
import { Calendar } from "./calendar";
import { Composer } from "./composer";
import { FollowerManager } from "./followers";
import { MediaView } from "./media";
import { firebaseClient } from "@/lib/firebase-client";
import { request, mediaBlob } from "@/lib/client-api";
import {
  emptyFollowers,
  type Followers,
  type Media,
  type Account,
  type Post,
  type PostInput,
} from "@/lib/shared/schema";
import {
  importZip,
  restoreFollowers,
  legacyKeys,
  differences,
} from "@/lib/shared/followers";
interface State {
  posts: Post[];
  accounts: Account[];
  media: Media[];
  history: {
    id: string;
    postId: string;
    at: string;
    status?: string;
    error?: string;
  }[];
  followers: Followers | null;
  workspace: { name: string; timezone: string };
}
const initialState: State = {
  posts: [],
  accounts: [],
  media: [],
  history: [],
  followers: null,
  workspace: { name: "Meu workspace", timezone: "America/Bahia" },
};
const nav = [
  ["dashboard", "Painel", LayoutDashboard],
  ["calendar", "Calendário", CalendarDays],
  ["posts", "Publicações", FileText],
  ["library", "Biblioteca de mídia", Image],
  ["followers", "Seguidores", Users],
  ["quick", "Modo rápido", Zap],
  ["protected", "Perfis protegidos", Heart],
  ["history", "Histórico", History],
  ["import", "Importação ZIP", Upload],
  ["backup", "Backup e migração", Download],
  ["reports", "Relatórios", BarChart3],
  ["ads", "Anúncios", Megaphone],
  ["settings", "Configurações", Settings],
] as const;
const statusNames: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  processing: "Processando",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [data, setData] = useState<State>(initialState),
    [ws, setWs] = useState(""),
    [screen, setScreen] = useState("dashboard"),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Post | null>(null),
    [date, setDate] = useState(""),
    [composerKey, setComposerKey] = useState(0),
    [term, setTerm] = useState(""),
    [status, setStatus] = useState("all"),
    [accountFilter, setAccountFilter] = useState("all"),
    [from, setFrom] = useState(""),
    [until, setUntil] = useState("");
  const urls = useRef(new Map<string, string>()),
    mounted = useRef(true);
  const timezone = data.workspace.timezone ?? "America/Bahia";
  const followers = data.followers ?? emptyFollowers;
  const notify = useCallback((s: string) => {
    setNotice(s);
    setTimeout(() => setNotice(""), 6000);
  }, []);
  const refresh = useCallback(async (workspace: string) => {
    const authenticatedUid = firebaseClient()?.auth.currentUser?.uid;
    const state = await request<State>("state", "GET", undefined, workspace);
    const media = await Promise.all(
      state.media.map(async (m) => {
        let url = urls.current.get(m.id);
        if (!url) {
          try {
            url = await mediaBlob(m.id, workspace);
            urls.current.set(m.id, url);
          } catch {}
        }
        return { ...m, url };
      }),
    );
    if (
      mounted.current &&
      firebaseClient()?.auth.currentUser?.uid === authenticatedUid
    )
      setData({ ...state, media });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const c = firebaseClient();
    if (!c) {
      setTimeout(() => setReady(true), 0);
      return;
    }
    return onAuthStateChanged(c.auth, async (u) => {
      setUser(u);
      setReady(true);
      setError("");
      if (!u) {
        setMenu(false);
        setWs("");
        setScreen("dashboard");
        setEditing(null);
        setData(initialState);
        for (const url of urls.current.values()) URL.revokeObjectURL(url);
        urls.current.clear();
        return;
      }
      try {
        const boot = await request<{ workspaceId: string }>(
          "bootstrap",
          "POST",
          {},
        );
        await refresh(boot.workspaceId);
        if (c.auth.currentUser?.uid === u.uid) setWs(boot.workspaceId);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }, [refresh]);
  useEffect(() => {
    if (!user || !ws) return;
    const id = setInterval(() => {
      void refresh(ws).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [user, ws, refresh]);
  function go(s: string) {
    setScreen(s);
    setMenu(false);
    setTerm("");
    setStatus("all");
  }
  function compose(day?: string, p?: Post) {
    setEditing(p ?? null);
    setDate(day ?? formatInTimeZone(new Date(), timezone, "yyyy-MM-dd"));
    setComposerKey((v) => v + 1);
    go("create");
  }
  async function execute(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh(ws);
      if (success) notify(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(input: PostInput) {
    setBusy(true);
    try {
      await request("posts", "POST", input, ws);
      await refresh(ws);
      notify(
        input.intent === "draft"
          ? "Rascunho salvo."
          : "Publicação registrada na fila do servidor.",
      );
      setEditing(null);
      go("posts");
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList): Promise<Media[]> {
    const output: Media[] = [];
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "video/mp4", "video/quicktime"].includes(file.type))
        throw Error("Use JPEG, MP4 ou MOV.");
      if (file.size > (file.type === "image/jpeg" ? 8 : 300) * 1024 * 1024)
        throw Error("Arquivo excede o limite de tamanho.");
      const meta = await probe(file);
      const id = crypto.randomUUID(),
        path = `workspaces/${ws}/media/${id}`;
      await new Promise<void>((resolve, reject) => {
        uploadBytesResumable(ref(firebaseClient()!.storage, path), file, {
          contentType: file.type,
        }).on("state_changed", undefined, reject, () => resolve());
      });
      await request(
        "media",
        "POST",
        { id, name: file.name, mime: file.type, size: file.size, ...meta },
        ws,
      );
      const m: Media = {
        id,
        name: file.name,
        mime: file.type,
        size: file.size,
        path,
        ...meta,
        createdAt: new Date().toISOString(),
        url: URL.createObjectURL(file),
      };
      urls.current.set(id, m.url!);
      output.push(m);
    }
    await refresh(ws);
    return output;
  }
  async function saveFollowers(next: Followers) {
    await request("followers", "PUT", next, ws);
    setData((d) => ({ ...d, followers: next }));
  }
  async function importFile(file: File, kind: "zip" | "backup") {
    await execute(async () => {
      if (file.size > 100 * 1024 * 1024) throw Error("Arquivo excede limite.");
      if (kind === "zip") {
        const next = await importZip(file, followers),
          diff = differences(followers.followers, next.followers);
        if (
          !confirm(
            `Importar ${next.following.length} seguindo e ${next.followers.length} seguidores? ${diff.added.length} novos e ${diff.removed.length} ausentes em relação à exportação anterior. Marcações serão preservadas.${next.source?.partial ? " A exportação pode estar parcial." : ""}`,
          )
        )
          return;
        await saveFollowers(next);
      } else {
        const raw = JSON.parse(await file.text());
        if (
          !confirm(
            "Restaurar os dados deste backup? Marcações atuais serão preservadas e posts restaurados serão rascunhos sem agendamento.",
          )
        )
          return;
        const next = restoreFollowers(raw, followers);
        await saveFollowers(next);
        for (const p of Array.isArray(raw.posts) ? raw.posts : [])
          await request(
            "posts",
            "POST",
            {
              type: ["post", "reel", "carousel", "story"].includes(p.type)
                ? p.type
                : "post",
              caption: String(p.caption ?? "").slice(0, 2200),
              accountId: "",
              mediaIds: [],
              scheduledAt: null,
              intent: "draft",
            },
            ws,
          );
      }
    }, "Importação concluída.");
  }
  function backup() {
    download(
      {
        format: "lup-media-pro-v1",
        savedAt: new Date().toISOString(),
        posts: data.posts,
        followers,
        media: data.media.map(({ url, ...m }) => {
          void url;
          return m;
        }),
        mediaIncluded: false,
      },
      "lup-media-pro-backup.json",
    );
    notify("Backup dos dados exportado. Guarde as mídias separadamente.");
  }
  async function migrateOriginal() {
    if (
      !confirm(
        "Importar a lista original de 1.976 perfis e preservar marcações atuais? A exportação original é parcial.",
      )
    )
      return;
    await execute(async () => {
      const { users } = await request<{ users: string[] }>(
        "migration/original",
        "GET",
        undefined,
        ws,
      );
      let candidate: unknown = {
        ...emptyFollowers,
        users,
        source: {
          name: "HTML original • 13/10/2026",
          updated: "2026-10-13",
          partial: true,
          followers: 15,
        },
      };
      const stored = localStorage.getItem(legacyKeys[0]);
      if (stored) candidate = JSON.parse(stored);
      else {
        const old = JSON.parse(localStorage.getItem(legacyKeys[1]) ?? "[]");
        if (Array.isArray(old))
          candidate = { ...(candidate as object), completed: old };
      }
      await saveFollowers(restoreFollowers(candidate, followers));
      const legacyPosts = JSON.parse(
        localStorage.getItem(legacyKeys[2]) ?? "[]",
      );
      for (const p of Array.isArray(legacyPosts) ? legacyPosts : [])
        await request(
          "posts",
          "POST",
          {
            type: ["post", "carousel", "reel", "story"].includes(p.type)
              ? p.type
              : "post",
            caption: String(p.caption ?? "").slice(0, 2200),
            accountId: "",
            mediaIds: [],
            scheduledAt: null,
            intent: "draft",
          },
          ws,
        );
    }, "Lista anterior migrada.");
  }
  function exportCsv() {
    const rows = [
      ["id", "tipo", "status", "data_utc", "legenda", "erro"],
      ...data.posts.map((p) => [
        p.id,
        p.type,
        p.status,
        p.scheduledAt ?? "",
        p.caption,
        p.error ?? "",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              (/^[=+@-]/.test(v) ? "'" : "") +
              v.replaceAll('"', '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n");
    download(csv, "lup-media-pro-publicacoes.csv", "text/csv;charset=utf-8");
  }
  const visible = data.posts.filter(
    (p) =>
      (status === "all" || p.status === status) &&
      (accountFilter === "all" || p.accountId === accountFilter) &&
      p.caption.toLowerCase().includes(term.toLowerCase()) &&
      (!from || (p.scheduledAt ?? "") >= from) &&
      (!until || (p.scheduledAt ?? "").slice(0, 10) <= until),
  );
  const postList = (posts: Post[]) =>
    posts.length ? (
      <div className="itemlist">
        {posts.map((p) => (
          <article className="itemcard" key={p.id}>
            <div className="itemcover">
              <MediaView
                media={data.media.find((m) => m.id === p.mediaIds[0])}
              />
            </div>
            <div className="itemcore">
              <b>{p.caption.slice(0, 110) || "Sem legenda"}</b>
              <p>
                {p.type} •{" "}
                {p.scheduledAt
                  ? formatInTimeZone(
                      p.scheduledAt,
                      timezone,
                      "dd/MM/yyyy HH:mm",
                    )
                  : "Sem data"}{" "}
                •{" "}
                <span className={`statuspill ${p.status}`}>
                  {statusNames[p.status]}
                </span>
              </p>
              {p.error && <p role="status">{p.error}</p>}
              {p.permalink && (
                <a href={p.permalink} target="_blank" rel="noopener noreferrer">
                  Ver no Instagram ↗
                </a>
              )}
            </div>
            <div className="itemactions">
              <button
                disabled={
                  ["processing", "published"].includes(p.status) || p.uncertain
                }
                onClick={() => compose(undefined, p)}
              >
                Editar
              </button>
              <button
                onClick={() =>
                  compose(undefined, {
                    ...p,
                    id: undefined as unknown as string,
                    revision: undefined as unknown as number,
                    status: "draft",
                  })
                }
              >
                Duplicar
              </button>
              {p.status === "scheduled" && (
                <button
                  onClick={() =>
                    void execute(async () => {
                      await request(`posts/${p.id}/cancel`, "POST", {}, ws);
                    }, "Agendamento cancelado.")
                  }
                >
                  Cancelar
                </button>
              )}
              {p.uncertain && (
                <button
                  onClick={() =>
                    void execute(async () => {
                      await request(`posts/${p.id}/reconcile`, "POST", {}, ws);
                    }, "Publicação confirmada pela Meta.")
                  }
                >
                  Consultar resultado na Meta
                </button>
              )}
              {p.status === "failed" && !p.uncertain && (
                <button
                  onClick={() =>
                    void execute(async () => {
                      await request(`posts/${p.id}/retry`, "POST", {}, ws);
                    }, "Retentativa registrada.")
                  }
                >
                  Tentar novamente
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm("Excluir esta publicação?"))
                    void execute(async () => {
                      await request(`posts/${p.id}`, "DELETE", undefined, ws);
                    }, "Publicação excluída.");
                }}
              >
                Excluir
              </button>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <div className="empty-state">
        Nenhuma publicação encontrada.
        <br />
        Crie um agendamento ou salve um rascunho.
      </div>
    );
  const filters = (
    <div className="toolbar">
      <input
        className="proinput"
        aria-label="Buscar publicações"
        placeholder="Buscar na legenda…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <select
        className="proselect"
        aria-label="Filtrar status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="all">Todos os status</option>
        {Object.entries(statusNames).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
      <select
        className="proselect"
        aria-label="Filtrar conta"
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
      >
        <option value="all">Todas as contas</option>
        {data.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.username}
          </option>
        ))}
      </select>
      <input
        className="proselect"
        type="date"
        aria-label="Período inicial"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <input
        className="proselect"
        type="date"
        aria-label="Período final"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
      />
    </div>
  );
  if (!ready)
    return (
      <main className="auth-shell">
        <p role="status">Carregando LUP Media Pro…</p>
      </main>
    );
  if (!user) return <Auth />;
  if (!ws && !error)
    return (
      <main className="auth-shell">
        <p role="status">Preparando seu workspace…</p>
      </main>
    );
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const editor = (
    <Composer
      key={composerKey}
      initial={editing}
      date={date || today}
      accounts={data.accounts}
      media={data.media}
      timezone={timezone}
      onSave={save}
      onUpload={upload}
      busy={busy}
    />
  );
  return (
    <div className="appframe">
      {menu && (
        <button
          className="sideoverlay show"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="sidebrand">
          <span className="logo">
            <Instagram size={24} />
          </span>
          <span className="brandwords">
            LUP
            <br />
            Media Pro
          </span>
        </div>
        <nav className="sidenav" aria-label="Menu principal">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={screen === id ? "active" : ""}
              onClick={() => go(id)}
              title={label}
            >
              <Icon />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidefoot">
          <b>LUP Soluções Inteligentes</b>
          <div className="user-email">{user.email}</div>
          <button
            className="qsmall button-icon"
            style={{ color: "white" }}
            onClick={() => void signOut(firebaseClient()!.auth)}
          >
            <LogOut size={14} />
            Sair
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div
            className="flex"
            style={{ alignItems: "center", flexWrap: "nowrap" }}
          >
            <button
              className="mobilemenu"
              aria-label="Abrir menu"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <div>
              <h1>
                {screen === "create"
                  ? "Criar publicação"
                  : nav.find((n) => n[0] === screen)?.[1]}
              </h1>
              <p>
                Planeje seu conteúdo e organize seu Instagram em um só lugar.
              </p>
            </div>
          </div>
          <div className="topbar-right">
            <button className="gradientbtn" onClick={() => compose()}>
              <Plus size={16} />
              Novo agendamento
            </button>
          </div>
        </header>
        {error && (
          <div className="error-alert" role="alert">
            {error}
            <button className="qsmall" onClick={() => setError("")}>
              Fechar
            </button>
          </div>
        )}
        {busy && (
          <p className="upload-progress" role="status">
            Processando…
          </p>
        )}
        {screen === "dashboard" && (
          <>
            <div className="dashboardcards">
              {[
                ["Agendados", "scheduled", Clock],
                ["Publicados", "published", CheckCircle],
                ["Rascunhos", "draft", FileText],
                ["Com erro", "failed", AlertTriangle],
              ].map(([label, s, Icon]) => (
                <div className="dashcard" key={String(s)}>
                  <div className="statrow">
                    <div className="staticon">
                      <Icon size={22} />
                    </div>
                    <div>
                      <div className="statlabel">{label as string}</div>
                      <strong>
                        {data.posts.filter((p) => p.status === s).length}
                      </strong>
                    </div>
                  </div>
                  <div className="stathelp">Dados do seu workspace</div>
                </div>
              ))}
            </div>
            <div className="dashgrid">
              <Calendar
                posts={data.posts}
                timezone={timezone}
                onDay={(d) => compose(d)}
                onEdit={(p) => compose(undefined, p)}
              />
              {editor}
            </div>
            <div className="lowergrid">
              <section className="procard">
                <div className="protitle">
                  <h2>
                    <Users size={17} /> Gerenciador de seguidores
                  </h2>
                  <button
                    className="smallaction"
                    onClick={() => go("followers")}
                  >
                    Ver lista →
                  </button>
                </div>
                <div className="followstats">
                  <span>
                    Na lista <b>{followers.users.length}</b>
                  </span>
                  <span>
                    Feitos{" "}
                    <b>
                      {
                        followers.completed.filter((u) =>
                          followers.users.includes(u),
                        ).length
                      }
                    </b>
                  </span>
                  <span>
                    Protegidos{" "}
                    <b>
                      {
                        followers.protected.filter((u) =>
                          followers.users.includes(u),
                        ).length
                      }
                    </b>
                  </span>
                </div>
                <div className="minibar">
                  <span
                    style={{
                      width: `${followers.users.length ? (followers.completed.filter((u) => followers.users.includes(u)).length / followers.users.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="mutedcopy">
                  Compare exportações e preserve seu progresso.
                </p>
                <button
                  className="linebutton fullwidth"
                  onClick={() => go("import")}
                >
                  Importar exportação
                </button>
              </section>
              <section className="procard">
                <div className="protitle">
                  <h2>
                    <Zap size={17} /> Modo rápido
                  </h2>
                </div>
                <p className="quickname">
                  {followers.users.find(
                    (u) =>
                      !followers.completed.includes(u) &&
                      !followers.protected.includes(u),
                  ) ?? "Nenhum perfil pendente"}
                </p>
                <button
                  className="gradientbtn fullwidth"
                  onClick={() => go("quick")}
                >
                  Abrir modo rápido
                </button>
                <p className="lightnote">
                  Abra, revise e marque cada perfil manualmente.
                </p>
              </section>
              <div className="rightstack">
                <section className="procard">
                  <div className="protitle">
                    <h2>
                      <Download size={17} /> Histórico e backup
                    </h2>
                  </div>
                  <div className="twobtn">
                    <button className="linebutton" onClick={backup}>
                      Backup completo
                    </button>
                    <button
                      className="linebutton"
                      onClick={() => go("history")}
                    >
                      Ver histórico
                    </button>
                  </div>
                </section>
                <section className="procard">
                  <div className="protitle">
                    <h2>
                      <LinkIcon size={17} /> Contas conectadas
                    </h2>
                  </div>
                  {data.accounts.length ? (
                    data.accounts.map((a) => (
                      <p className="mutedcopy" key={a.id}>
                        @{a.username} • {a.status}
                      </p>
                    ))
                  ) : (
                    <p className="mutedcopy">
                      Conecte sua conta profissional para publicar.
                    </p>
                  )}
                  <button
                    className="linebutton fullwidth"
                    onClick={() => go("settings")}
                  >
                    Gerenciar contas
                  </button>
                </section>
              </div>
            </div>
            <section className="procard" style={{ marginTop: 15 }}>
              <div className="protitle">
                <h2>Próximas publicações</h2>
              </div>
              {postList(
                data.posts
                  .filter((p) => p.status === "scheduled")
                  .sort((a, b) =>
                    (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""),
                  )
                  .slice(0, 5),
              )}
            </section>
          </>
        )}
        {screen === "create" && (
          <div style={{ maxWidth: 650, margin: "auto" }}>{editor}</div>
        )}
        {screen === "calendar" && (
          <>
            {filters}
            <Calendar
              full
              posts={visible}
              timezone={timezone}
              onDay={(d) => compose(d)}
              onEdit={(p) => compose(undefined, p)}
            />
          </>
        )}
        {screen === "posts" && (
          <>
            {filters}
            {postList(visible)}
          </>
        )}
        {screen === "library" && (
          <>
            <div className="toolbar">
              <input
                className="proinput"
                aria-label="Pesquisar mídias"
                placeholder="Pesquisar mídia…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <select
                className="proselect"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Tipo de mídia"
              >
                <option value="all">Todos os formatos</option>
                <option value="image">Imagens</option>
                <option value="video">Vídeos</option>
              </select>
              <label className="gradientbtn" htmlFor="library-upload">
                Adicionar mídia
              </label>
              <input
                id="library-upload"
                type="file"
                accept="image/jpeg,video/mp4,video/quicktime"
                multiple
                hidden
                onChange={(e) => {
                  const f = e.target.files;
                  if (f)
                    void execute(async () => {
                      await upload(f);
                    }, "Mídia enviada.");
                }}
              />
            </div>
            <p className="mutedcopy">
              {(
                data.media.reduce((n, m) => n + m.size, 0) /
                1024 /
                1024
              ).toFixed(1)}{" "}
              MB usados • Arquivos privados do workspace
            </p>
            <div className="librarygrid">
              {data.media
                .filter(
                  (m) =>
                    m.name.toLowerCase().includes(term.toLowerCase()) &&
                    (status === "all" || m.mime.startsWith(status)),
                )
                .map((m) => (
                  <article className="libtile" key={m.id}>
                    <div className="mediaimg">
                      <MediaView media={m} />
                    </div>
                    <div className="libfoot">
                      <span className="libname">{m.name}</span>
                      <button
                        onClick={() =>
                          compose(undefined, {
                            mediaIds: [m.id],
                            type: m.mime.startsWith("video") ? "reel" : "post",
                            caption: "",
                            accountId: "",
                            scheduledAt: null,
                          } as Post)
                        }
                      >
                        Usar na publicação
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Excluir esta mídia da biblioteca?"))
                            void execute(async () => {
                              await request(
                                `media/${m.id}`,
                                "DELETE",
                                undefined,
                                ws,
                              );
                            }, "Mídia excluída.");
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            {!data.media.length && (
              <div className="empty-state">
                Sua biblioteca ainda está vazia. Adicione uma imagem ou vídeo.
              </div>
            )}
          </>
        )}
        {["followers", "quick", "protected", "history"].includes(screen) && (
          <>
            <FollowerManager
              key={screen}
              data={followers}
              mode={screen}
              onSave={saveFollowers}
              onImport={() => go("import")}
            />
            {screen === "history" && (
              <section className="procard" style={{ marginTop: 15 }}>
                <h2>Histórico de publicação</h2>
                {data.history.length ? (
                  data.history
                    .slice()
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((h) => (
                      <p className="mutedcopy" key={h.id}>
                        {h.at} • {h.status ?? "Atualização"} •{" "}
                        {h.error ?? h.postId}
                      </p>
                    ))
                ) : (
                  <p className="empty-state">Nenhuma execução registrada.</p>
                )}
              </section>
            )}
          </>
        )}
        {["import", "backup"].includes(screen) && (
          <div className="settings-grid">
            <section className="settingbox">
              <h3>Importar ZIP oficial do Instagram</h3>
              <p>
                Solicite “Seguidores e seguindo”, “Todo o período”, em JSON ou
                HTML. Marcações atuais são preservadas. Diferenças entre
                exportações não comprovam unfollows quando o período está
                limitado.
              </p>
              <label className="gradientbtn" htmlFor="zip">
                Selecionar ZIP
              </label>
              <input
                id="zip"
                type="file"
                accept=".zip"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f, "zip");
                  e.target.value = "";
                }}
              />
            </section>
            <section className="settingbox">
              <h3>Backup e restauração</h3>
              <p>
                Exporte posts e seguidores. Fotos e vídeos devem ser guardados
                separadamente. Publicações restauradas viram rascunhos para
                impedir envios acidentais.
              </p>
              <div className="flex">
                <button className="linebutton" onClick={backup}>
                  Baixar backup
                </button>
                <label className="linebutton" htmlFor="backup">
                  Restaurar JSON
                </label>
                <input
                  hidden
                  id="backup"
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f, "backup");
                    e.target.value = "";
                  }}
                />
              </div>
            </section>
            <section className="settingbox">
              <h3>Migrar o gerenciador anterior</h3>
              <p>
                Importe a lista original de 1.976 perfis. Para trazer o
                progresso de outro navegador ou do HTML aberto como arquivo,
                exporte o backup no gerenciador original e restaure aqui.
              </p>
              <button
                className="linebutton"
                onClick={() => void migrateOriginal()}
              >
                Importar lista e dados locais anteriores
              </button>
            </section>
            <section className="settingbox">
              <h3>Abrir perfis</h3>
              <p>No Android, tente abrir o aplicativo com fallback HTTPS.</p>
              <select
                className="proselect"
                aria-label="Modo de abertura"
                value={followers.linkMode}
                onChange={(e) =>
                  void execute(() =>
                    saveFollowers({
                      ...followers,
                      linkMode: e.target.value as "app" | "web",
                    }),
                  )
                }
              >
                <option value="app">Aplicativo, quando possível</option>
                <option value="web">Navegador</option>
              </select>
            </section>
          </div>
        )}
        {screen === "reports" && (
          <>
            <section className="procard">
              <div className="protitle">
                <h2>Relatório de publicações</h2>
                <button className="linebutton" onClick={exportCsv}>
                  Exportar CSV
                </button>
              </div>
              {filters}
              <div className="reports-grid">
                {[
                  ["Concluídas", "published"],
                  ["Falhas", "failed"],
                  ["Agendadas", "scheduled"],
                ].map(([l, s]) => (
                  <div className="metric" key={s}>
                    <strong>
                      {visible.filter((p) => p.status === s).length}
                    </strong>
                    <p>{l}</p>
                  </div>
                ))}
              </div>
              <p className="lightnote">
                Alcance, interações e horários recomendados: Dado indisponível.
                Permissões de insights ainda não configuradas.
              </p>
            </section>
            <section className="procard" style={{ marginTop: 15 }}>
              <h2>Dados da última exportação</h2>
              <p className="mutedcopy">
                Seguidores: {followers.source?.followers ?? "Dado indisponível"}{" "}
                • Seguindo: {followers.source?.following ?? "Dado indisponível"}{" "}
                • {followers.source?.updated ?? "Sem exportação"}
              </p>
            </section>
          </>
        )}
        {screen === "ads" && (
          <section className="procard">
            <h2>Gestão de anúncios</h2>
            <p className="empty-state">
              Módulo futuro. A configuração da Meta Marketing API será
              independente da conexão do Instagram.
            </p>
          </section>
        )}
        {screen === "settings" && (
          <div className="settings-grid">
            <section className="settingbox">
              <h3>Contas do Instagram</h3>
              <p>
                Conecte a conta profissional usando o aplicativo LUP Media Pro
                já existente na Meta.
              </p>
              {data.accounts.map((a) => (
                <div className="account-card" key={a.id}>
                  <Instagram />
                  <div className="info">
                    <b>@{a.username}</b>
                    <p>
                      {a.status} • Token válido até{" "}
                      {new Date(a.expiresAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <button
                    className="linebutton"
                    onClick={() => {
                      if (
                        confirm(
                          `Desconectar @${a.username} e revogar o acesso?`,
                        )
                      )
                        void execute(async () => {
                          await request(
                            `accounts/${a.id}`,
                            "DELETE",
                            undefined,
                            ws,
                          );
                        }, "Conta desconectada.");
                    }}
                  >
                    Desconectar
                  </button>
                </div>
              ))}
              <button
                className="gradientbtn button-icon"
                onClick={() =>
                  void execute(async () => {
                    const d = await request<{ url: string }>(
                      "instagram/connect",
                      "POST",
                      {},
                      ws,
                    );
                    window.location.assign(d.url);
                  })
                }
              >
                <Instagram size={16} />
                Conectar / reconectar Instagram
              </button>
            </section>
            <section className="settingbox">
              <h3>Workspace</h3>
              <SettingsForm
                name={data.workspace.name}
                timezone={timezone}
                onSave={(d) =>
                  execute(async () => {
                    await request("settings", "PUT", d, ws);
                  }, "Configurações salvas.")
                }
              />
              <p className="lightnote">
                ID: {ws}. Papéis disponíveis no modelo: proprietário,
                administrador, editor e visualizador.
              </p>
            </section>
            <section className="settingbox">
              <h3>Inteligência artificial</h3>
              <p>
                Não configurada. O editor continua disponível para escrita
                manual. A integração deve ser habilitada no servidor com um
                provedor e credenciais próprios.
              </p>
            </section>
          </div>
        )}
        <p className="footer-note">
          LUP Media Pro • LUP Soluções Inteligentes • {timezone}
        </p>
      </main>
      {notice && (
        <div className="notification" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
function SettingsForm({
  name,
  timezone,
  onSave,
}: {
  name: string;
  timezone: string;
  onSave: (v: { name: string; timezone: string }) => Promise<void>;
}) {
  const [n, setN] = useState(name),
    [tz, setTz] = useState(timezone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ name: n, timezone: tz });
      }}
    >
      <label className="formlabel" htmlFor="ws-name">
        Nome
      </label>
      <input
        id="ws-name"
        className="proinput"
        value={n}
        required
        onChange={(e) => setN(e.target.value)}
      />
      <label className="formlabel" htmlFor="ws-timezone">
        Fuso horário
      </label>
      <input
        id="ws-timezone"
        className="proinput"
        value={tz}
        required
        onChange={(e) => setTz(e.target.value)}
      />
      <button className="linebutton" style={{ marginTop: 10 }}>
        Salvar configurações
      </button>
    </form>
  );
}
async function probe(
  file: File,
): Promise<{ width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const element = document.createElement(
        file.type.startsWith("video/") ? "video" : "img",
      );
      const timer = setTimeout(
        () => reject(Error("Não foi possível ler os metadados.")),
        10000,
      );
      const done = () => {
        clearTimeout(timer);
        if (element instanceof HTMLVideoElement)
          resolve({
            width: element.videoWidth,
            height: element.videoHeight,
            duration: element.duration,
          });
        else
          resolve({
            width: element.naturalWidth,
            height: element.naturalHeight,
            duration: 0,
          });
      };
      element.onerror = () => {
        clearTimeout(timer);
        reject(Error("Mídia inválida."));
      };
      if (element instanceof HTMLVideoElement) {
        element.onloadedmetadata = done;
        element.preload = "metadata";
      } else element.onload = done;
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
function download(value: unknown, name: string, mime = "application/json") {
  const url = URL.createObjectURL(
      new Blob(
        [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
        { type: mime },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
