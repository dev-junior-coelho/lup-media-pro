"use client";
import { useEffect, useRef, useState } from "react";
import type { Media, PostInput } from "@/lib/shared/schema";
import { imageFrames, suggestedFrame, type ImageFrame } from "@/lib/shared/media-format";
import { canvasJpeg, drawAdjustment, jpegName, loadImage } from "@/lib/client-images";
export function ImageAdjuster({ media, type, onApply, onClose }: {
  media: Media; type: PostInput["type"]; onApply: (file: File) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<ImageFrame>(() => suggestedFrame(media.width, media.height, type));
  const [mode, setMode] = useState<"contain" | "cover">("contain");
  const [background, setBackground] = useState("#ffffff");
  const [x, setX] = useState(50), [y, setY] = useState(50);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(""), [working, setWorking] = useState(false);
  const applying = useRef(false);
  const target = imageFrames[frame];
  const enlarges = (mode === "cover" ? Math.max : Math.min)(target.width / media.width, target.height / media.height) > 1;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (media.url) void loadImage(media.url).then((value) => {
      if (!cancelled) setImage(value);
    }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [media.url]);
  useEffect(() => {
    if (image && canvas.current) drawAdjustment(canvas.current, image, { frame, mode, background, x, y });
  }, [image, frame, mode, background, x, y]);
  async function apply() {
    if (!image || !canvas.current || applying.current) return;
    applying.current = true;
    setWorking(true);
    setError("");
    try {
      drawAdjustment(canvas.current, image, { frame, mode, background, x, y });
      const file = await canvasJpeg(canvas.current, jpegName(media.name, true));
      await onApply(file);
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      applying.current = false;
      setWorking(false);
    }
  }
  return (
    <dialog ref={dialog} className="image-adjuster" aria-labelledby="image-adjust-title" onCancel={(event) => {
      event.preventDefault();
      if (!applying.current) onClose();
    }}>
      <div className="image-adjust-heading">
        <h2 id="image-adjust-title">Ajustar imagem</h2>
        <button className="qsmall" aria-label="Fechar ajuste" disabled={working} onClick={onClose}>×</button>
      </div>
      <p className="mutedcopy">Confira como a imagem ficará. A versão original continua na biblioteca.</p>
      <div className="image-adjust-layout">
        <div className="image-adjust-preview">
          {!image && !error && <p role="status">Carregando prévia…</p>}
          <canvas ref={canvas} aria-label="Prévia da imagem ajustada" hidden={!image} />
        </div>
        <div className="image-adjust-controls">
          <label htmlFor="image-frame" className="formlabel">Formato da publicação</label>
          <select id="image-frame" className="proselect" value={frame} disabled={working} onChange={(event) => setFrame(event.target.value as ImageFrame)}>
            {Object.entries(imageFrames).filter(([key]) => type === "story" || key !== "story").map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
          <fieldset disabled={working}>
            <legend>Como encaixar a imagem</legend>
            <label><input type="radio" name="image-fit" checked={mode === "contain"} onChange={() => setMode("contain")} /> Manter tudo com bordas</label>
            <label><input type="radio" name="image-fit" checked={mode === "cover"} onChange={() => setMode("cover")} /> Recortar para preencher</label>
          </fieldset>
          {mode === "contain" ? (
            <>
              <label className="formlabel" htmlFor="image-background">Cor das bordas</label>
              <select id="image-background" className="proselect" value={background} disabled={working} onChange={(event) => setBackground(event.target.value)}>
                <option value="#ffffff">Branco</option><option value="#000000">Preto</option>
              </select>
              <p className="lightnote">Toda a imagem será preservada. As bordas completam o espaço que falta.</p>
            </>
          ) : (
            <>
              <label htmlFor="image-position-x" className="formlabel">Posição horizontal</label>
              <input id="image-position-x" type="range" min="0" max="100" value={x} disabled={working} onChange={(event) => setX(Number(event.target.value))} />
              <label htmlFor="image-position-y" className="formlabel">Posição vertical</label>
              <input id="image-position-y" type="range" min="0" max="100" value={y} disabled={working} onChange={(event) => setY(Number(event.target.value))} />
              <p className="lightnote">Partes fora do enquadramento serão cortadas. Reposicione para preservar o que importa.</p>
            </>
          )}
          {enlarges && <p className="info-alert">A imagem original é pequena. A ampliação pode reduzir a nitidez.</p>}
        </div>
      </div>
      {error && <p className="error-alert" role="alert">{error}</p>}
      <div className="image-adjust-actions">
        <button className="linebutton" disabled={working} onClick={onClose}>Cancelar</button>
        <button className="gradientbtn" disabled={working || !image} onClick={() => void apply()}>{working ? "Preparando imagem…" : "Usar imagem ajustada"}</button>
      </div>
    </dialog>
  );
}
