import type { Media, PostInput } from "./schema";

/** Used in the editor and on the server so the same file gets the same advice. */
export function mediaIssue(media: Media, type: PostInput["type"]): string | null {
  const name = `“${media.name}”`;
  const image = media.mime.startsWith("image/");
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0)
    return `${name}: não foi possível identificar o tamanho da mídia. Adicione o arquivo novamente.`;
  if (type === "reel" && image)
    return `${name}: Reels precisam de vídeo. Escolha Post ou Story para usar esta imagem.`;
  if (type === "post" || type === "carousel") {
    if (!image) return `${name}: este arquivo é um vídeo. Escolha Reel ou Story para publicá-lo.`;
    if (media.mime !== "image/jpeg") return `${name}: converta a imagem para JPEG antes de publicar.`;
    if (media.size > 8 * 1024 * 1024) return `${name}: a imagem ultrapassa 8 MB. Use Ajustar imagem para reduzir o arquivo.`;
    const ratio = media.width / media.height;
    if (ratio < 0.8) return `${name}: a imagem está alta demais para o feed. Ajuste com bordas para preservar tudo ou escolha um recorte.`;
    if (ratio > 1.91) return `${name}: a imagem está larga demais para o feed. Ajuste com bordas para preservar tudo ou escolha um recorte.`;
    if (media.width < 320) return `${name}: a imagem é pequena demais. Você pode ampliá-la em Ajustar imagem, mas ela poderá perder nitidez.`;
    if (media.width > 1440) return `${name}: a imagem precisa ser reduzida. Use Ajustar imagem para prepará-la sem cortar.`;
  } else if (image) {
    if (media.mime !== "image/jpeg") return `${name}: Stories com imagem precisam de JPEG.`;
    if (media.size > 8 * 1024 * 1024) return `${name}: a imagem ultrapassa 8 MB. Use Ajustar imagem para reduzir o arquivo.`;
  } else {
    if (!["video/mp4", "video/quicktime"].includes(media.mime)) return `${name}: use um vídeo MP4 ou MOV.`;
    if (media.size > 300 * 1024 * 1024) return `${name}: o vídeo ultrapassa 300 MB. Exporte uma versão mais leve.`;
    if (!Number.isFinite(media.duration) || media.duration < 3) return `${name}: o vídeo precisa ter pelo menos 3 segundos.`;
    if (media.duration > (type === "story" ? 60 : 900)) return `${name}: o vídeo é longo demais para ${type === "story" ? "Story (até 1 minuto)" : "Reel (até 15 minutos)"}.`;
    const ratio = media.width / media.height;
    if (ratio < 0.5 || ratio > 1.91) return `${name}: o enquadramento do vídeo não é aceito. Exporte uma versão vertical ou quadrada.`;
  }
  return null;
}

export const imageFrames = {
  portrait: { label: "Vertical para o feed", width: 1080, height: 1350 },
  square: { label: "Quadrado", width: 1080, height: 1080 },
  landscape: { label: "Horizontal para o feed", width: 1080, height: 566 },
  story: { label: "Tela inteira para Story", width: 1080, height: 1920 },
} as const;
export type ImageFrame = keyof typeof imageFrames;
export function suggestedFrame(width: number, height: number, type: PostInput["type"]): ImageFrame {
  if (type === "story") return "story";
  const ratio = width / height;
  return ratio < 1 ? "portrait" : ratio > 1.4 ? "landscape" : "square";
}
