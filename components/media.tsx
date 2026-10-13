"use client";
import type { Media } from "@/lib/shared/schema";
export function MediaView({ media }: { media?: Media }) {
  if (!media?.url)
    return (
      <div className="medialabel">{media?.name ?? "Prévia indisponível"}</div>
    );
  return media.mime.startsWith("video/") ? (
    <video src={media.url} muted controls preload="metadata" />
  ) : (
    <img src={media.url} alt={media.name} />
  );
}
