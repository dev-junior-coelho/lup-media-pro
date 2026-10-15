import { imageFrames, type ImageFrame } from "./shared/media-format";
export const imageUploadTypes = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 8 * 1024 * 1024;

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = image.onerror = null;
      image.src = "";
      reject(Error("A imagem demorou para abrir. Tente adicioná-la novamente."));
    }, 20000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(Error("Não foi possível abrir esta imagem. Tente outro arquivo JPEG, PNG ou WebP."));
    };
    image.src = url;
  });
}
export function jpegName(name: string, adjusted = false) {
  const base = name.replace(/\.[^.]+$/, "").slice(0, adjusted ? 136 : 146);
  return `${base || "imagem"}${adjusted ? "-ajustada" : ""}.jpg`;
}
export async function canvasJpeg(canvas: HTMLCanvasElement, name: string): Promise<File> {
  for (const quality of [0.94, 0.86, 0.76, 0.64]) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(Error("Não foi possível preparar a imagem. Tente novamente.")), "image/jpeg", quality);
    });
    if (blob.size <= maxBytes) return new File([blob], name, { type: "image/jpeg" });
  }
  throw Error("Esta imagem ainda está muito pesada. Escolha um enquadramento menor e tente novamente.");
}
/** Safe preparation: keep the entire composition, flatten transparency onto white, resize/compress only. */
export async function prepareImage(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, 1440 / image.naturalWidth, 4096 / image.naturalHeight);
    // Flatten camera orientation before storing dimensions; browsers apply EXIF while decoding.
    const exif = file.type === "image/jpeg" && new TextDecoder("latin1")
      .decode(await file.slice(0, 262144).arrayBuffer()).includes("Exif\0\0");
    if (file.type === "image/jpeg" && !exif && file.size <= maxBytes && scale === 1)
      return file.name.length <= 150 ? file : new File([file], jpegName(file.name), { type: "image/jpeg" });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Seu navegador não conseguiu preparar a imagem.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasJpeg(canvas, jpegName(file.name));
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function drawAdjustment(canvas: HTMLCanvasElement, image: HTMLImageElement, options: {
  frame: ImageFrame; mode: "contain" | "cover"; background: string; x: number; y: number;
}) {
  const frame = imageFrames[options.frame];
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Seu navegador não conseguiu abrir a prévia.");
  const scale = (options.mode === "contain" ? Math.min : Math.max)(
    frame.width / image.naturalWidth, frame.height / image.naturalHeight,
  );
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.drawImage(image, (frame.width - width) * (options.mode === "contain" ? 0.5 : options.x / 100),
    (frame.height - height) * (options.mode === "contain" ? 0.5 : options.y / 100), width, height);
}
