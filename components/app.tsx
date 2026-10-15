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
  History,
  Upload,
  Download,
  Settings,
  ShieldCheck,
  BarChart3,
  Menu,
  Plus,
  LogOut,
  Clock,
  CheckCircle,
  FileText,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import { PlanManager } from "./plan-manager";
import { imageUploadTypes, prepareImage } from "@/lib/client-images";
import { defaultCatalog, type PlanCatalog } from "@/lib/shared/plan-management";
import { PlanPanel } from "./plan-panel";
import { plans, type Subscription } from "@/lib/shared/plans";
import { Auth } from "./auth";
import {
  PublicationHistory,
  type PublicationEvent,
} from "./publication-history";
import { Calendar } from "./calendar";
import { Composer, type ComposerInitial } from "./composer";
import { FollowerManager } from "./followers";
import { MediaView } from "./media";
import { firebaseClient } from "@/lib/firebase-client";
import { compareFollowerImports } from "@/lib/shared/follower-changes";
import { MediaCache } from "@/lib/media-cache";
import { request, mediaBlob } from "@/lib/client-api";
import {
  statusNames,
  typeNames,
  accountStatusNames,
  displayDate,
  filterPosts,
  postsCsv,
} from "@/lib/shared/presentation";
import {
  emptyFollowers,
  type Followers,
  type Media,
  type Account,
  type Post,
  type PostInput,
} from "@/lib/shared/schema";
import {
  importFollowerFiles,
  restoreFollowers,
  legacyKeys,
} from "@/lib/shared/followers";
interface State {
  posts: Post[];
  accounts: Account[];
  media: Media[];
  history: PublicationEvent[];
  followers: Followers | null;
  followersByAccount: Record<string, Followers>;
  role: string;
  platformAdmin: boolean;
  planCatalog: PlanCatalog;
  workspace: { name: string; timezone: string; subscription: Subscription };
}
const initialState: State = {
  posts: [],
  accounts: [],
  media: [],
  history: [],
  followers: null,
  followersByAccount: {},
  role: "viewer",
  platformAdmin: false,
  planCatalog: defaultCatalog,
  workspace: {
    name: "Meu workspace",
    timezone: "America/Bahia",
    subscription: { plan: "essential", status: "active" },
  },
};
const nav = [
  ["dashboard", "Painel", LayoutDashboard],
  ["calendar", "Calendário", CalendarDays],
  ["posts", "Publicações", FileText],
  ["library", "Biblioteca de mídia", Image],
  ["followers", "Seguidores", Users],
  ["quick", "Modo rápido", Zap],
  ["history", "Histórico", History],
  ["data", "Importação e backup", Upload],
  ["reports", "Relatórios", BarChart3],
  ["accounts", "Plano e contas", Instagram],
  ["plan-manager", "Gestor de planos", ShieldCheck],
  ["settings", "Configurações", Settings],
] as const;
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
    [instagramConnection, setInstagramConnection] = useState<{ hostedUrl: string; message: string } | null>(null),
    [editing, setEditing] = useState<ComposerInitial | null>(null),
    [date, setDate] = useState(""),
    [composerKey, setComposerKey] = useState(0),
    [term, setTerm] = useState(""),
    [status, setStatus] = useState("all"),
    [accountFilter, setAccountFilter] = useState("all"),
    [selectedAccount, setSelectedAccount] = useState(""),
    [from, setFrom] = useState(""),
    [until, setUntil] = useState("");
  const urls = useRef(new MediaCache(mediaBlob)),
    mounted = useRef(true),
    refreshVersion = useRef(0),
    sessionVersion = useRef(0),
    actionPending = useRef(false),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timezone = data.workspace.timezone ?? "America/Bahia";
  const subscription = data.workspace.subscription;
  const selectedInstagram = data.accounts.find(
    (account) => account.id === selectedAccount,
  );
  const followers =
    selectedAccount === "legacy"
      ? (data.followers ?? emptyFollowers)
      : (data.followersByAccount[selectedAccount] ?? emptyFollowers);
  const selectedPosts =
    selectedAccount === "all"
      ? data.posts
      : data.posts.filter(
          (post) =>
            post.accountId ===
            (selectedAccount === "legacy" ? "" : selectedAccount),
        );
  const selectedHistory =
    selectedAccount === "all"
      ? data.history
      : data.history.filter(
          (event) =>
            event.accountId === selectedAccount ||
            selectedPosts.some((post) => post.id === event.postId),
        );
  const editableAccounts = data.accounts.filter(
    (account) => !account.planPaused && account.status === "connected",
  );
  const canEditFollowers =
    selectedAccount === "legacy"
      ? !data.accounts.length
      : Boolean(selectedInstagram && !selectedInstagram.planPaused);
  function selectAccount(accountId: string) {
    setSelectedAccount(accountId);
    setTerm("");
    setStatus("all");
    setAccountFilter("all");
    setFrom("");
    setUntil("");
    setEditing(null);
    setComposerKey((key) => key + 1);
    setError("");
  }
  const notify = useCallback((s: string) => {
    setNotice(s);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6000);
  }, []);
  const refresh = useCallback(async (workspace: string) => {
    const version = ++refreshVersion.current;
    const session = sessionVersion.current;
    const authenticatedUid = firebaseClient()?.auth.currentUser?.uid;
    const current = () =>
      mounted.current &&
      sessionVersion.current === session &&
      firebaseClient()?.auth.currentUser?.uid === authenticatedUid;
    const state = await request<State>("state", "GET", undefined, workspace);
    if (!current() || version !== refreshVersion.current) return;
    setSelectedAccount((current) => {
      if (current === "all" && state.workspace.subscription.plan === "pro")
        return current;
      if (state.accounts.some((account) => account.id === current))
        return current;
      if (current === "legacy" && state.followers) return current;
      return (
        state.accounts.find((account) => !account.planPaused)?.id ??
        (state.followers ? "legacy" : (state.accounts[0]?.id ?? "legacy"))
      );
    });
    urls.current.retain(new Set(state.media.map((m) => m.id)));
    setData({
      ...state,
      media: state.media.map((m) => ({ ...m, url: urls.current.get(m.id) })),
    });
    for (const media of state.media) {
      if (urls.current.get(media.id)) continue;
      void urls.current.load(media.id, workspace).then((url) => {
        if (!url || !current()) return;
        setData((latest) => ({
          ...latest,
          media: latest.media.map((m) =>
            m.id === media.id ? { ...m, url } : m,
          ),
        }));
      });
    }
  }, []);
  const invalidateSession = useCallback(() => {
    ++sessionVersion.current;
    ++refreshVersion.current;
    urls.current.clear();
  }, []);
  useEffect(() => {
    mounted.current = true;
    const c = firebaseClient();
    if (!c) {
      const timer = setTimeout(() => setReady(true), 0);
      return () => {
        clearTimeout(timer);
        mounted.current = false;
      };
    }
    const unsubscribe = onAuthStateChanged(c.auth, async (u) => {
      const session = ++sessionVersion.current;
      ++refreshVersion.current;
      urls.current.clear();
      setWs("");
      setSelectedAccount("");
      setData(initialState);
      setUser(u);
      setReady(true);
      setError("");
      if (!u) {
        setMenu(false);
        setWs("");
        setScreen("dashboard");
        setEditing(null);
        setData(initialState);
        clearTimeout(noticeTimer.current);
        setNotice("");
        return;
      }
      try {
        const boot = await request<{ workspaceId: string }>(
          "bootstrap",
          "POST",
          {},
        );
        if (!mounted.current || sessionVersion.current !== session) return;
        await refresh(boot.workspaceId);
        if (mounted.current && sessionVersion.current === session)
          setWs(boot.workspaceId);
      } catch (e) {
        if (mounted.current && sessionVersion.current === session)
          setError((e as Error).message);
      }
    });
    return () => {
      mounted.current = false;
      invalidateSession();
      unsubscribe();
      clearTimeout(noticeTimer.current);
    };
  }, [refresh, invalidateSession]);
  useEffect(() => {
    if (!user || !ws) return;
    let polling = false;
    const id = setInterval(() => {
      if (
        polling ||
        actionPending.current ||
        document.visibilityState === "hidden"
      )
        return;
      polling = true;
      void refresh(ws)
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 15000);
    return () => clearInterval(id);
  }, [user, ws, refresh]);
  function go(s: string) {
    setScreen(s);
    setMenu(false);
    setTerm("");
    setStatus("all");
    setAccountFilter("all");
    setFrom("");
    setUntil("");
  }
  function compose(day?: string, p?: ComposerInitial) {
    const existing = p?.id
      ? data.posts.find((post) => post.id === p.id)
      : undefined;
    if (
      existing &&
      data.accounts.find((account) => account.id === existing.accountId)
        ?.planPaused
    ) {
      go("accounts");
      notify("Ative esta conta no plano antes de editar a publicação.");
      return;
    }
    if (
      existing &&
      (["processing", "published"].includes(existing.status) ||
        existing.uncertain)
    ) {
      go("posts");
      notify(
        "Consulte o resultado na lista de publicações. A edição não está disponível durante ou após o envio.",
      );
      return;
    }
    const prepared =
      p &&
      p.accountId &&
      !editableAccounts.some((account) => account.id === p.accountId)
        ? { ...p, accountId: "" }
        : p;
    setEditing(
      prepared ??
        (selectedInstagram && !selectedInstagram.planPaused
          ? { accountId: selectedInstagram.id }
          : null),
    );
    setDate(day ?? formatInTimeZone(new Date(), timezone, "yyyy-MM-dd"));
    setComposerKey((v) => v + 1);
    go("create");
  }
  async function execute(
    action: () => Promise<void | false>,
    success?: string,
  ) {
    if (actionPending.current) return;
    actionPending.current = true;
    ++refreshVersion.current;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result === false) return;
      await refresh(ws);
      if (success) notify(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function save(input: PostInput) {
    if (actionPending.current)
      throw Error("Aguarde a operação atual terminar.");
    actionPending.current = true;
    ++refreshVersion.current;
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
      setSelectedAccount(input.accountId || "legacy");
      go("posts");
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function upload(files: File[], onProgress?: (message: string) => void): Promise<Media[]> {
    const session = sessionVersion.current;
    const guard = () => {
      if (!mounted.current || sessionVersion.current !== session)
        throw Error("A sessão mudou. Entre novamente para enviar as mídias.");
    };
    guard();
    const selected: File[] = [];
    const output: Media[] = [];
    for (const file of files) {
      onProgress?.(`Preparando “${file.name}”…`);
      if (![...imageUploadTypes, "video/mp4", "video/quicktime"].includes(file.type))
        throw Error(`“${file.name}”: use uma foto JPEG, PNG ou WebP, ou um vídeo MP4/MOV.`);
      if (file.type.startsWith("video/") && file.size > 300 * 1024 * 1024)
        throw Error(`“${file.name}”: o vídeo ultrapassa 300 MB. Exporte uma versão mais leve.`);
      guard();
      try {
        selected.push(file.type.startsWith("image/") ? await prepareImage(file) : file);
      } catch (error) {
        throw Error(`“${file.name}”: ${(error as Error).message}`);
      }
      guard();
    }
    for (const file of selected) {
      guard();
      const meta = await probe(file);
      guard();
      const id = crypto.randomUUID(),
        path = `pending/${ws}/${id}`;
      onProgress?.(`Enviando “${file.name}”…`);
      await new Promise<void>((resolve, reject) => {
        uploadBytesResumable(ref(firebaseClient()!.storage, path), file, {
          contentType: file.type,
        }).on("state_changed", (snapshot) => {
          const percent = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
          onProgress?.(`Enviando “${file.name}”… ${percent}%`);
        }, (error) => reject(Error(error.code === "storage/retry-limit-exceeded"
          ? "O envio da imagem não conseguiu conectar ao armazenamento. Tente novamente; se persistir, verifique a configuração do Firebase Storage."
          : error.code === "storage/unauthorized"
            ? "O armazenamento recusou o envio. Verifique sua sessão e as permissões de mídia desta conta."
            : `Não foi possível enviar “${file.name}”: ${error.message}`)), () => resolve());
      });
      guard();
      onProgress?.(`Validando “${file.name}” no servidor…`);
      await request(
        "media",
        "POST",
        { id, name: file.name, mime: file.type, size: file.size, ...meta },
        ws,
      );
      guard();
      const m: Media = {
        id,
        name: file.name,
        mime: file.type,
        size: file.size,
        path: `workspaces/${ws}/private/${id}`,
        ...meta,
        createdAt: new Date().toISOString(),
        url: URL.createObjectURL(file),
      };
      // The server has finalized this upload. Adopt it immediately rather than
      // resetting the editor through a full workspace refresh.
      ++refreshVersion.current;
      urls.current.set(id, m.url!);
      setData((latest) => ({ ...latest, media: [...latest.media.filter((item) => item.id !== id), m] }));
      output.push(m);
    }
    return output;
  }
  async function saveFollowers(next: Followers, importing = false) {
    ++refreshVersion.current;
    const session = sessionVersion.current;
    if (!canEditFollowers)
      throw Error("Selecione uma conta ativa para gerenciar seus seguidores.");
    const accountId =
      selectedAccount === "legacy" ? undefined : selectedAccount;
    await request(importing ? "followers/import" : "followers", "PUT", next, ws, accountId);
    ++refreshVersion.current;
    if (sessionVersion.current === session)
      setData((d) =>
        accountId
          ? {
              ...d,
              followersByAccount: {
                ...d.followersByAccount,
                [accountId]: next,
              },
            }
          : { ...d, followers: next },
      );
  }
  async function importFile(input: File | File[], kind: "zip" | "backup") {
    const files = Array.isArray(input) ? input : [input];
    const file = files[0];
    if (!file) return;
    if (!canEditFollowers) {
      setError("Escolha uma conta ativa antes de importar os dados.");
      return;
    }
    await execute(async () => {
      if (file.size > 100 * 1024 * 1024) throw Error("Arquivo excede limite.");
      if (kind === "zip") {
        const next = await importFollowerFiles(files, followers),
          diff = compareFollowerImports(followers, next, new Date().toISOString());
        if (
          !confirm(
            `Importar ${next.following.length} seguindo e ${next.followers.length} seguidores? ${diff.baseline ? "Esta lista será a base para detectar entradas e saídas nas próximas importações." : `${diff.gained} novos ou retornaram e ${diff.lost} ausentes desde a lista anterior. A comparação será guardada no histórico de seguidores.`} Marcações serão preservadas.${diff.partial ? " Uma das listas pode estar parcial: ausências precisam ser conferidas." : ""}`,
          )
        )
          return false;
        await saveFollowers(next, true);
      } else {
        const raw = JSON.parse(await file.text());
        if (
          !confirm(
            `Restaurar os dados deste backup em ${selectedInstagram ? "@" + selectedInstagram.username : "sua lista anterior"}? Marcações atuais serão preservadas e posts restaurados serão rascunhos sem agendamento.`,
          )
        )
          return false;
        const next = restoreFollowers(raw, followers);
        await saveFollowers(next);
        await restoreDraftPosts(raw.posts);
      }
    }, "Importação concluída.");
  }
  function backup() {
    if (selectedAccount === "all") {
      setError("Escolha uma conta para baixar o backup dela.");
      return;
    }
    download(
      {
        format: "lup-media-pro-v2",
        instagramAccountId:
          selectedAccount === "legacy" ? null : selectedAccount,
        instagramUsername: selectedInstagram?.username ?? null,
        savedAt: new Date().toISOString(),
        posts: selectedPosts,
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
      await restoreDraftPosts(legacyPosts);
    }, "Lista anterior migrada.");
  }
  async function restoreDraftPosts(posts: unknown) {
    if (posts !== undefined && !Array.isArray(posts))
      throw Error("Lista de publicações inválida no backup.");
    if (Array.isArray(posts) && posts.length)
      await request(
        "posts/restore",
        "POST",
        {
          posts,
          accountId: selectedAccount === "legacy" ? "" : selectedAccount,
        },
        ws,
      );
  }
  async function connectInstagram(accountId?: string) {
    await execute(async () => {
      setInstagramConnection(null);
      const result = await request<{ url: string } | { hostedUrl: string; message: string }>(
        "instagram/connect",
        "POST",
        {},
        ws,
        accountId,
      );
      if ("hostedUrl" in result) {
        setInstagramConnection(result);
        return false;
      }
      window.location.assign(result.url);
    });
  }
  function exportCsv() {
    download(
      postsCsv(visible, timezone),
      "lup-media-pro-publicacoes.csv",
      "text/csv;charset=utf-8",
    );
  }
  const visible = filterPosts(
    selectedPosts,
    {
      status,
      account: accountFilter,
      term,
      from,
      until,
    },
    timezone,
  );
  const visibleMedia = data.media.filter(
    (media) =>
      media.name
        .toLocaleLowerCase("pt-BR")
        .includes(term.trim().toLocaleLowerCase("pt-BR")) &&
      (status === "all" || media.mime.startsWith(status)),
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
              <p className="post-account">
                {data.accounts.find((account) => account.id === p.accountId)
                  ?.username
                  ? `@${data.accounts.find((account) => account.id === p.accountId)!.username}`
                  : "Conta ainda não escolhida"}
              </p>
              {data.accounts.find((account) => account.id === p.accountId)
                ?.planPaused && (
                <p className="info-alert">
                  Conta pausada no plano. O agendamento não será enviado.
                </p>
              )}
              <p>
                {typeNames[p.type]} •{" "}
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
                    type: p.type,
                    caption: p.caption,
                    accountId: p.accountId,
                    mediaIds: p.mediaIds,
                    scheduledAt: null,
                  })
                }
              >
                Duplicar
              </button>
              {subscription.plan === "pro" &&
                editableAccounts.some(
                  (account) => account.id !== p.accountId,
                ) && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSelectedAccount("all");
                      compose(undefined, {
                        type: p.type,
                        caption: p.caption,
                        mediaIds: p.mediaIds,
                        accountId: "",
                        scheduledAt: null,
                      });
                    }}
                  >
                    Copiar para outra conta
                  </button>
                )}
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
                disabled={busy || p.status === "processing" || p.uncertain}
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
  if (!ws)
    return (
      <main className="auth-shell">
        <section className="procard auth-card">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button
                className="gradientbtn fullwidth"
                onClick={() => window.location.reload()}
              >
                Tentar novamente
              </button>
              <button
                className="qsmall"
                onClick={() => void signOut(firebaseClient()!.auth)}
              >
                Sair da conta
              </button>
            </>
          ) : (
            <p role="status">Preparando seu workspace…</p>
          )}
        </section>
      </main>
    );
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const editor = (
    <Composer
      key={`${composerKey}:${selectedAccount}`}
      initial={
        editing ?? (selectedAccount === "all" ? { accountId: "" } : null)
      }
      date={date || today}
      accounts={editableAccounts}
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
          {nav
            .filter(([id]) => id !== "plan-manager" || data.platformAdmin)
            .map(([id, label, Icon]) => (
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
                {screen === "plan-manager"
                  ? "Gerencie clientes, solicitações e preços dos planos."
                  : "Planeje seu conteúdo e organize seu Instagram em um só lugar."}
              </p>
            </div>
          </div>
          {screen !== "plan-manager" && (
            <div className="topbar-right">
              <label className="account-switcher">
                Conta selecionada
                <select
                  className="proselect"
                  aria-label="Conta selecionada"
                  disabled={busy}
                  value={selectedAccount}
                  onChange={(event) => selectAccount(event.target.value)}
                >
                  {subscription.plan === "pro" && (
                    <option value="all">Todas as contas</option>
                  )}
                  {(!data.accounts.length ||
                    data.followers ||
                    data.posts.some((post) => !post.accountId)) && (
                    <option value="legacy">Sem conta / lista anterior</option>
                  )}
                  {data.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      @{account.username}
                      {account.planPaused ? " · Pausada" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                className="gradientbtn"
                onClick={() => compose()}
              >
                <Plus size={16} />
                Novo agendamento
              </button>
            </div>
          )}
        </header>
        {screen !== "plan-manager" && subscription.status === "suspended" && (
          <div className="error-alert" role="alert">
            Sua assinatura está suspensa. Os dados continuam preservados e os
            envios estão pausados. Entre em contato com a administração para
            reativar.
          </div>
        )}
        {screen !== "plan-manager" && selectedInstagram?.planPaused && (
          <div className="info-alert">
            @{selectedInstagram.username} está pausada no plano. Seus dados
            continuam disponíveis para consulta e backup; os agendamentos não
            serão enviados.
          </div>
        )}
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
                        {selectedPosts.filter((p) => p.status === s).length}
                      </strong>
                    </div>
                  </div>
                  <div className="stathelp">Dados do seu workspace</div>
                </div>
              ))}
            </div>
            <div className="dashgrid">
              <Calendar
                posts={selectedPosts}
                accounts={data.accounts}
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
                    {selectedAccount === "all" ? (
                      "Selecione uma conta para ver seus seguidores."
                    ) : (
                      <>
                        Na lista <b>{followers.users.length}</b>
                      </>
                    )}
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
                  onClick={() => go("data")}
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
                  {selectedAccount === "all"
                    ? "Escolha uma conta para revisar"
                    : (followers.users.find(
                        (u) =>
                          !followers.completed.includes(u) &&
                          !followers.protected.includes(u),
                      ) ?? "Nenhum perfil pendente")}
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
                      Baixar backup dos dados
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
                        @{a.username} •{" "}
                        {accountStatusNames[a.status] ?? "Verifique a conexão"}
                      </p>
                    ))
                  ) : (
                    <p className="mutedcopy">
                      Conecte sua conta profissional para publicar.
                    </p>
                  )}
                  <button
                    className="linebutton fullwidth"
                    onClick={() => go("accounts")}
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
              accounts={data.accounts}
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
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                multiple
                hidden
                onChange={(e) => {
                  const f = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (f.length)
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
              {visibleMedia.map((m) => (
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
                        })
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
            {!visibleMedia.length && (
              <div className="empty-state">
                {data.media.length
                  ? "Nenhuma mídia encontrada com esses filtros."
                  : "Sua biblioteca ainda está vazia. Adicione uma imagem ou vídeo."}
              </div>
            )}
          </>
        )}
        {["followers", "quick", "history"].includes(screen) && (
          <>
            {selectedAccount === "all" ? (
              <section className="procard empty-state">
                Escolha uma conta no seletor acima para ver os seguidores e as
                marcações dela.
              </section>
            ) : (
              <FollowerManager
                key={`${screen}:${selectedAccount}`}
                data={followers}
                readOnly={!canEditFollowers}
                timezone={timezone}
                mode={screen}
                onSave={saveFollowers}
                onLoadChanges={(cursor) => request(`followers/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, ws, selectedAccount === "legacy" ? undefined : selectedAccount)}
                onImport={() => go("data")}
              />
            )}
            {screen === "history" && (
              <PublicationHistory
                history={selectedHistory}
                accounts={data.accounts}
                posts={selectedPosts}
                timezone={timezone}
              />
            )}
          </>
        )}
        {screen === "data" && (
          <div className="settings-grid">
            {selectedAccount === "all" || !canEditFollowers ? (
              <section className="settingbox">
                <h3>Selecione uma conta ativa</h3>
                <p>
                  Importações e restaurações pertencem à conta escolhida no
                  seletor acima. O backup de uma conta pausada continua
                  disponível.
                </p>
                <button className="linebutton" onClick={backup}>
                  Baixar backup
                </button>
                {data.followers && selectedAccount === "legacy" && (
                  <div>
                    <p>A qual conta pertence sua lista anterior?</p>
                    {editableAccounts.map((account) => (
                      <button
                        key={account.id}
                        className="linebutton"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Vincular a lista anterior a @${account.username}? Ela não será copiada para outras contas.`,
                            )
                          )
                            void execute(async () => {
                              await request(
                                "followers/claim-legacy",
                                "POST",
                                { accountId: account.id },
                                ws,
                              );
                              setSelectedAccount(account.id);
                            }, "Lista vinculada.");
                        }}
                      >
                        Vincular a @{account.username}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <>
                <section className="settingbox">
                  <h3>Importar seguidores e seguindo</h3>
                  <p className="info-alert">
                    Destino:{" "}
                    {selectedInstagram
                      ? "@" + selectedInstagram.username
                      : "lista anterior, ainda sem conta"}
                  </p>
                  <p>
                    Solicite “Seguidores e seguindo”, “Todo o período”, em JSON
                    ou HTML. Selecione o ZIP completo ou, juntos, following.json/html e todos os arquivos followers_1, followers_2 etc. Marcações atuais são preservadas. Diferenças entre
                    exportações não comprovam unfollows quando o período está
                    limitado.
                  </p>
                  <label className="gradientbtn" htmlFor="zip">
                    Selecionar ZIP ou arquivos JSON/HTML
                  </label>
                  <input
                    id="zip"
                    type="file"
                    accept=".zip,.json,.html"
                    multiple
                    disabled={busy}
                    hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) void importFile(files, "zip");
                      e.target.value = "";
                    }}
                  />
                </section>
                <section className="settingbox">
                  <h3>Backup e restauração</h3>
                  <p>
                    Exporte posts e seguidores. Fotos e vídeos devem ser
                    guardados separadamente. Publicações restauradas viram
                    rascunhos para impedir envios acidentais.
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
              </>
            )}
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
              {selectedAccount === "all" && (
                <div className="account-report-grid">
                  {data.accounts.map((account) => (
                    <article className="metric" key={account.id}>
                      <strong>@{account.username}</strong>
                      <p>
                        {
                          visible.filter(
                            (post) =>
                              post.accountId === account.id &&
                              post.status === "published",
                          ).length
                        }{" "}
                        publicadas ·{" "}
                        {
                          visible.filter(
                            (post) =>
                              post.accountId === account.id &&
                              post.status === "scheduled",
                          ).length
                        }{" "}
                        agendadas
                      </p>
                      {account.planPaused && <p>Pausada no plano</p>}
                    </article>
                  ))}
                </div>
              )}
              <p className="lightnote">
                Alcance, interações e horários recomendados: Dado indisponível.
                Permissões de insights ainda não configuradas.
              </p>
            </section>
            {selectedAccount !== "all" && (
              <section className="procard" style={{ marginTop: 15 }}>
                <h2>Dados da última exportação</h2>
                <p className="mutedcopy">
                  Seguidores:{" "}
                  {followers.source?.followers ?? "Dado indisponível"} •
                  Seguindo: {followers.source?.following ?? "Dado indisponível"}{" "}
                  •{" "}
                  {followers.source
                    ? displayDate(followers.source.updated, timezone)
                    : "Sem exportação"}
                </p>
              </section>
            )}
          </>
        )}
        {screen === "plan-manager" &&
          (data.platformAdmin ? (
            <PlanManager onSelfChange={() => refresh(ws)} />
          ) : (
            <section className="procard empty-state">
              Acesso restrito à administração da plataforma.
            </section>
          ))}
        {screen === "accounts" && (
          <div className="settings-grid">
            <PlanPanel
              subscription={subscription}
              catalog={data.planCatalog}
              accounts={data.accounts}
              owner={data.role === "owner"}
              busy={busy}
              onRequestPro={() =>
                void execute(async () => {
                  await request("subscription/request-pro", "POST", {}, ws);
                }, "Seu plano Pro está ativo. Você já pode adicionar mais contas.")
              }
              onEssential={(accountId) =>
                void execute(async () => {
                  await request(
                    "subscription/essential",
                    "POST",
                    { accountId },
                    ws,
                  );
                }, "Plano Essencial ativado. As demais contas ficam pausadas.")
              }
            />
            <section className="settingbox">
              <h3>Contas do Instagram</h3>
              <p>
                Conecte a conta profissional usando o aplicativo LUP Media Pro
                já existente na Meta.
              </p>
              {instagramConnection && (
                <div className="info-alert" role="status">
                  <p>{instagramConnection.message}</p>
                  <div className="flex">
                    <a className="linebutton" href={instagramConnection.hostedUrl} target="_blank" rel="noopener noreferrer">
                      Abrir versão online
                    </a>
                    <button className="linebutton" disabled={busy} onClick={() => void execute(async () => {}, "Lista de contas atualizada.")}>
                      Já conectei, atualizar contas
                    </button>
                  </div>
                </div>
              )}
              {data.accounts.map((a) => (
                <div className="account-card" key={a.id}>
                  <Instagram />
                  <div className="info">
                    <b>@{a.username}</b>
                    <p>
                      {a.planPaused && a.status !== "disconnected"
                        ? "Pausada no plano"
                        : (accountStatusNames[a.status] ??
                          "Verifique a conexão")}{" "}
                      • Acesso válido até{" "}
                      {new Date(a.expiresAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  {a.planPaused && a.status !== "disconnected" && (
                    <button
                      className="linebutton"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Ativar @${a.username}? Os agendamentos pendentes dessa conta voltarão a ser executados, incluindo horários que já passaram.`,
                          )
                        )
                          void execute(async () => {
                            await request(
                              `accounts/${a.id}/activate`,
                              "POST",
                              {},
                              ws,
                            );
                          }, "Conta ativada.");
                      }}
                    >
                      Ativar no plano
                    </button>
                  )}
                  <button
                    className="linebutton"
                    disabled={busy}
                    onClick={() => void connectInstagram(a.id)}
                  >
                    Reconectar
                  </button>
                  <button
                    disabled={busy || a.status === "disconnected"}
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
                disabled={
                  busy ||
                  !["owner", "admin"].includes(data.role) ||
                  data.accounts.filter((account) => !account.planPaused)
                    .length >= plans[subscription.plan].accountLimit
                }
                onClick={() => void connectInstagram()}
              >
                <Instagram size={16} />
                Adicionar conta do Instagram
              </button>
              {data.accounts.filter((account) => !account.planPaused).length >=
                plans[subscription.plan].accountLimit && (
                <p className="lightnote">
                  {subscription.plan === "pro"
                    ? "As três vagas do Pro estão em uso. Reconecte uma conta existente ou desconecte uma para liberar uma vaga."
                    : "Sua vaga do Essencial está em uso. Reconecte a conta existente ou migre para o Pro para adicionar mais contas."}
                </p>
              )}
            </section>
          </div>
        )}
        {screen === "settings" && (
          <div className="settings-grid">
            <section className="settingbox">
              <h3>Seu espaço de trabalho</h3>
              <SettingsForm
                key={`${data.workspace.name}:${timezone}`}
                busy={busy}
                name={data.workspace.name}
                timezone={timezone}
                onSave={(d) =>
                  execute(async () => {
                    await request("settings", "PUT", d, ws);
                  }, "Configurações salvas.")
                }
              />
            </section>
            <section className="settingbox">
              <h3>Abrir perfis</h3>
              <p>
                Escolha se os perfis abrem no aplicativo do Instagram ou no
                navegador.
              </p>
              <select
                className="proselect"
                aria-label="Modo de abertura"
                disabled={!canEditFollowers || busy}
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
  busy,
  name,
  timezone,
  onSave,
}: {
  busy: boolean;
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
        maxLength={100}
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
      <button disabled={busy} className="linebutton" style={{ marginTop: 10 }}>
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
