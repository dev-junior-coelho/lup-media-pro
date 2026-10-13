"use client";
import { useState } from "react";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Plus, Sparkles, Send } from "lucide-react";
import type { Account, Media, Post, PostInput } from "@/lib/shared/schema";
import { MediaView } from "./media";
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
  initial: Post | null;
  date: string;
  accounts: Account[];
  media: Media[];
  timezone: string;
  onSave: (v: PostInput) => Promise<void>;
  onUpload: (files: FileList) => Promise<Media[]>;
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
    [uploading, setUploading] = useState(false);
  async function save(intent: PostInput["intent"]) {
    setError("");
    try {
      if (
        intent === "now" &&
        !confirm(
          "Publicar este conteúdo agora no Instagram? Esta operação envia a publicação real.",
        )
      )
        return;
      await onSave({
        id: initial?.id,
        revision: initial?.revision,
        type,
        caption,
        accountId: account,
        mediaIds: ids,
        scheduledAt:
          day && time
            ? fromZonedTime(`${day}T${time}:00`, timezone).toISOString()
            : null,
        intent,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    try {
      const items = await onUpload(files);
      setIds([...ids, ...items.map((m) => m.id)].slice(0, 10));
    } catch (e) {
      setError((e as Error).message);
    } finally {
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
          {initial ? "Editar publicação" : "Nova publicação"}
        </h2>
      </div>
      <label className="formlabel" htmlFor="upload">
        Mídia • JPEG, MP4 ou MOV
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
          accept="image/jpeg,video/mp4,video/quicktime"
          multiple
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        {ids.map((id, i) => (
          <div className="mediathumb" key={id}>
            <MediaView media={media.find((m) => m.id === id)} />
            <button
              aria-label="Remover mídia"
              onClick={() => setIds(ids.filter((x) => x !== id))}
            >
              ×
            </button>
            <button
              className="move"
              aria-label="Mover antes"
              onClick={() => move(i, -1)}
            >
              ‹
            </button>
            <button
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
          Enviando para a biblioteca…
        </p>
      )}
      <label className="formlabel" htmlFor="library-select">
        Reutilizar da biblioteca
      </label>
      <select
        id="library-select"
        className="proselect"
        value=""
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
            {
              {
                post: "Post",
                carousel: "Carrossel",
                reel: "Reel",
                story: "Story",
              }[v]
            }
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
      <p className="lightnote">
        IA não configurada. Legendas e hashtags podem ser escritas diretamente.
      </p>
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
            @{a.username} • {a.status}
          </option>
        ))}
      </select>
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
      {error && (
        <div className="error-alert" role="alert">
          {error}
        </div>
      )}
      <div className={`composerbuttons ${busy || uploading ? "busy" : ""}`}>
        <button
          className="gradientbtn fullwidth"
          onClick={() => void save("schedule")}
        >
          Agendar publicação
        </button>
        <div className="formrow">
          <button className="linebutton" onClick={() => void save("draft")}>
            Salvar rascunho
          </button>
          <button
            className="linebutton button-icon"
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
