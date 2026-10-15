"use client";
import { useRef, useState } from "react";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Plus, Sparkles, Send, Eye } from "lucide-react";
import type { Account, Media, Post, PostInput } from "@/lib/shared/schema";
import { typeNames, accountStatusNames } from "@/lib/shared/presentation";
import { MediaView } from "./media";
import { ImageAdjuster } from "./image-adjuster";
import { mediaIssue } from "@/lib/shared/media-format";
export type ComposerInitial = Partial<
  Pick<
    Post,
    | "id"
    | "revision"
    | "scheduledAt"
    | "type"
    | "caption"
    | "accountId"
    | "mediaIds"
  >
>;
export function Composer({
  initial,
  date,
  accounts,
  media,
  timezone,
  onSave,
  onUpload,
  busy,
}: {
  initial: ComposerInitial | null;
  date: string;
  accounts: Account[];
  media: Media[];
  timezone: string;
  onSave: (v: PostInput) => Promise<void>;
  onUpload: (files: File[], onProgress?: (message: string) => void) => Promise<Media[]>;
  busy: boolean;
}) {
  const [type, setType] = useState<PostInput["type"]>(initial?.type ?? "post"),
    [caption, setCaption] = useState(initial?.caption ?? ""),
    [account, setAccount] = useState(
      initial?.accountId ??
        accounts.find((a) => a.status === "connected")?.id ??
        "",
    ),
    [ids, setIds] = useState(initial?.mediaIds ?? []),
    [day, setDay] = useState(
      initial?.scheduledAt
        ? formatInTimeZone(initial.scheduledAt, timezone, "yyyy-MM-dd")
        : date,
    ),
    [time, setTime] = useState(
      initial?.scheduledAt
        ? formatInTimeZone(initial.scheduledAt, timezone, "HH:mm")
        : "19:00",
    ),
    [error, setError] = useState(""),
    [adjusting, setAdjusting] = useState<string | null>(null),
    [uploading, setUploading] = useState(false),
    [uploadStatus, setUploadStatus] = useState(""),
    [saving, setSaving] = useState(false);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIntent, setPreviewIntent] = useState<"now" | "schedule" | null>(null);
  const pending = useRef(false);
  const locked = busy || uploading || saving;
  const selectedMedia = ids.map((id) => media.find((item) => item.id === id)).filter((item): item is Media => Boolean(item));
  const adjustedMedia = media.find((item) => item.id === adjusting);
  async function save(intent: PostInput["intent"], confirmed = false) {
    if (locked || pending.current) return;
    setError("");
    if (intent !== "draft" && !account) {
      setError("Selecione uma conta conectada antes de publicar ou agendar.");
      return;
    }
    if (intent !== "draft") {
      const issue = selectedMedia.map((item) => mediaIssue(item, type)).find(Boolean);
      if (issue) { setError(issue); return; }
    }
    if (intent !== "draft" && !confirmed) {
      setPreviewIntent(intent);
      setPreviewOpen(true);
      previewDialog.current?.showModal();
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        revision: initial?.revision,
        type,
        caption,
        accountId: account,
        mediaIds: ids,
        scheduledAt:
          intent !== "draft" && day && time
            ? fromZonedTime(`${day}T${time}:00`, timezone).toISOString()
            : null,
        intent,
      });
      previewDialog.current?.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function upload(files: File[]) {
    if (!files.length || locked || pending.current) return;
    if (files.length + ids.length > 10) {
      setError("Selecione até 10 mídias por publicação.");
      return;
    }
    pending.current = true;
    setError("");
    setUploadStatus("Preparando mídia…");
    setUploading(true);
    try {
      const items = await onUpload(files, setUploadStatus);
      setIds((current) =>
        [...new Set([...current, ...items.map((m) => m.id)])].slice(0, 10),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setUploading(false);
    }
  }
  async function applyImage(file: File) {
    if (!adjusting || pending.current || locked) throw Error("Aguarde o envio atual antes de ajustar outra imagem.");
    pending.current = true;
    setUploadStatus("Preparando mídia…");
    setUploading(true);
    try {
      const [replacement] = await onUpload([file], setUploadStatus);
      if (!replacement) throw Error("Não foi possível salvar a imagem ajustada.");
      setIds((current) => current.map((id) => id === adjusting ? replacement.id : id));
      setError("");
    } finally {
      pending.current = false;
      setUploading(false);
    }
  }
  function move(i: number, delta: number) {
    const a = [...ids],
      j = i + delta;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setIds(a);
  }
  return (
    <section className="procard" id="composerPanel">
      <div className="protitle">
        <h2>
          <Sparkles size={17} />
          {initial?.id ? "Editar publicação" : "Nova publicação"}
        </h2>
      </div>
      <label className="formlabel" htmlFor="upload">
        Mídia • Fotos ou vídeos
      </label>
      <div className="mediaupload">
        <label className="mediaadd" htmlFor="upload">
          <Plus />
          <span>Adicionar mídia</span>
        </label>
        <input
          hidden
          id="upload"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          multiple
          disabled={locked}
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {ids.map((id, i) => (
          <div className="mediathumb" key={id}>
            <MediaView media={media.find((m) => m.id === id)} />
            <button
              disabled={locked}
              aria-label="Remover mídia"
              onClick={() => setIds(ids.filter((x) => x !== id))}
            >
              ×
            </button>
            <button
              disabled={locked}
              className="move"
              aria-label="Mover antes"
              onClick={() => move(i, -1)}
            >
              ‹
            </button>
            <button
              disabled={locked}
              className="next"
              aria-label="Mover depois"
              onClick={() => move(i, 1)}
            >
              ›
            </button>
          </div>
        ))}
      </div>
      {uploading && (
        <p role="status" className="upload-progress">
          {uploadStatus || "Preparando e enviando mídia…"}
        </p>
      )}
      <p className="lightnote">Fotos JPEG, PNG ou WebP são preparadas automaticamente, sem recortar. Áreas transparentes recebem fundo branco. Vídeos: MP4 ou MOV.</p>
      {selectedMedia.length > 0 && (
        <ul className="media-review" aria-label="Conferência das mídias">
          {selectedMedia.map((item) => {
            const issue = mediaIssue(item, type);
            return <li key={item.id}>
              <div className="media-review-heading">
                <strong>{item.name}</strong>
                {item.mime.startsWith("image/") && type !== "reel" && <button className="linebutton" disabled={locked || !item.url} onClick={() => { setError(""); setAdjusting(item.id); }}>Ajustar imagem</button>}
              </div>
              {issue && <p className="media-issue" role="status">{issue}</p>}
            </li>;
          })}
        </ul>
      )}
      {adjustedMedia && <ImageAdjuster key={adjustedMedia.id} media={adjustedMedia} type={type} onApply={applyImage} onClose={() => setAdjusting(null)} />}
      <label className="formlabel" htmlFor="library-select">
        Reutilizar da biblioteca
      </label>
      <select
        id="library-select"
        className="proselect"
        value=""
        disabled={locked}
        onChange={(e) => {
          if (
            e.target.value &&
            !ids.includes(e.target.value) &&
            ids.length < 10
          )
            setIds([...ids, e.target.value]);
        }}
      >
        <option value="">Selecione uma mídia</option>
        {media.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <label className="formlabel">Tipo</label>
      <div className="togglegroup">
        {(["post", "carousel", "reel", "story"] as const).map((v) => (
          <button
            key={v}
            className={`typechoice ${type === v ? "active" : ""}`}
            disabled={
              v === "story" &&
              accounts.find((a) => a.id === account)?.accountType !== "BUSINESS"
            }
            title={v === "story" ? "Stories exigem conta Business" : ""}
            onClick={() => setType(v)}
          >
            {typeNames[v]}
          </button>
        ))}
      </div>
      <label className="formlabel" htmlFor="caption">
        Legenda e hashtags <small>{caption.length} / 2.200</small>
      </label>
      <textarea
        id="caption"
        className="protextarea"
        maxLength={2200}
        placeholder="Escreva sua legenda…"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
      />

      <label className="formlabel" htmlFor="account">
        Conta do Instagram
      </label>
      <select
        id="account"
        className="proselect"
        value={account}
        onChange={(e) => setAccount(e.target.value)}
      >
        <option value="">Selecione uma conta conectada</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id} disabled={a.status !== "connected"}>
            @{a.username} •{" "}
            {accountStatusNames[a.status] ?? "Verifique a conexão"}
          </option>
        ))}
      </select>
      {account && (
        <p className="info-alert">
          Esta publicação será enviada para{" "}
          <strong>
            @{accounts.find((item) => item.id === account)?.username}
          </strong>
          .
        </p>
      )}
      <div className="formrow">
        <div>
          <label className="formlabel" htmlFor="day">
            Data
          </label>
          <input
            id="day"
            className="proinput"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div>
          <label className="formlabel" htmlFor="time">
            Hora
          </label>
          <input
            id="time"
            className="proinput"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
      <p className="lightnote">
        {timezone} • O servidor executa o agendamento com o navegador fechado,
        quando o scheduler estiver habilitado.
      </p>
      {error && !previewOpen && (
        <div className="error-alert" role="alert">
          {error}
        </div>
      )}
      <dialog
        ref={previewDialog}
        className="publication-preview"
        aria-labelledby="publication-preview-title"
        onCancel={(event) => { if (locked) event.preventDefault(); }}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewIntent(null);
          previewDialog.current?.querySelectorAll("video").forEach((video) => video.pause());
        }}
      >
        <h2 id="publication-preview-title">Pré-visualizar publicação</h2>
        <p><strong>{account ? `@${accounts.find((item) => item.id === account)?.username ?? "Conta selecionada"}` : "Nenhuma conta selecionada"}</strong> • {typeNames[type]}</p>
        <div className={`publication-preview-media ${type === "story" || type === "reel" ? "portrait" : ""}`} aria-label="Mídias na ordem de publicação">
          {selectedMedia.length ? selectedMedia.map((item, index) => (
            <figure key={item.id}>
              <MediaView media={item} />
              {selectedMedia.length > 1 && <figcaption>{index + 1} / {selectedMedia.length}</figcaption>}
            </figure>
          )) : <p className="lightnote">Adicione uma mídia para visualizar a publicação.</p>}
        </div>
        <p className="publication-preview-caption">{caption || "Sem legenda"}</p>
        {previewIntent === "schedule" && <p>Agendamento: {day.split("-").reverse().join("/")} às {time} ({timezone})</p>}
        <p className="lightnote">Prévia aproximada. A apresentação no Instagram pode variar.</p>
        {error && previewOpen && <div className="error-alert" role="alert">{error}</div>}
        <div className="composerbuttons">
          <button type="button" className="linebutton" disabled={locked} onClick={() => previewDialog.current?.close()}>Voltar à edição</button>
          {previewIntent && <button type="button" className="gradientbtn fullwidth" disabled={locked} onClick={() => void save(previewIntent, true)}>
            {saving ? "Enviando…" : previewIntent === "now" ? "Confirmar publicação agora" : "Confirmar agendamento"}
          </button>}
        </div>
      </dialog>
      <div className="composerbuttons">
        <button type="button" className="linebutton button-icon fullwidth" disabled={locked} onClick={() => { setError(""); setPreviewIntent(null); setPreviewOpen(true); previewDialog.current?.showModal(); }}>
          <Eye size={16} /> Pré-visualizar publicação
        </button>
        <button
          className="gradientbtn fullwidth"
          disabled={locked}
          onClick={() => void save("schedule")}
        >
          Agendar publicação
        </button>
        <div className="formrow">
          <button
            className="linebutton"
            disabled={locked}
            onClick={() => void save("draft")}
          >
            Salvar rascunho
          </button>
          <button
            className="linebutton button-icon"
            disabled={locked}
            onClick={() => void save("now")}
          >
            <Send size={14} />
            Publicar agora
          </button>
        </div>
      </div>
    </section>
  );
}
