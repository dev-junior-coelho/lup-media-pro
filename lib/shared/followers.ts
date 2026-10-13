import JSZip from "jszip";
import { emptyFollowers, followerSchema, type Followers } from "./schema";
export const legacyKeys = [
  "ig_unfollow_manager_20261013_v2",
  "ig_unfollow_review_20261013_v1",
  "ig_manager_pro_posts_v1",
];
export const normalize = (v: string) =>
  v.trim().replace(/^@/, "").toLowerCase();
const clean = (a: string[]) => [
  ...new Set(a.map(normalize).filter((x) => /^[a-z0-9._]{1,30}$/.test(x))),
];
export function compare(following: string[], followers: string[]) {
  const a = new Set(clean(following)),
    b = new Set(clean(followers));
  return {
    notFollowingBack: [...a].filter((x) => !b.has(x)),
    fans: [...b].filter((x) => !a.has(x)),
    mutual: [...a].filter((x) => b.has(x)),
  };
}
export function differences(before: string[], after: string[]) {
  const a = new Set(before),
    b = new Set(after);
  return {
    added: after.filter((x) => !a.has(x)),
    removed: before.filter((x) => !b.has(x)),
  };
}
export function parseExport(
  path: string,
  text: string,
): { users: string[]; timestamps: Record<string, number> } {
  const users: string[] = [],
    timestamps: Record<string, number> = {};
  const add = (v: unknown, t = 0) => {
    if (typeof v !== "string") return;
    const n = normalize(v);
    if (/^[a-z0-9._]{1,30}$/.test(n)) {
      users.push(n);
      if (t) timestamps[n] = t;
    }
  };
  if (path.endsWith(".json")) {
    const data = JSON.parse(text);
    const items = Array.isArray(data)
      ? data
      : (data.relationships_following ??
        data.relationships_followers ??
        data.followers ??
        data.following);
    if (!Array.isArray(items)) throw Error("Formato JSON desconhecido.");
    for (const item of items) {
      if (typeof item === "string") add(item);
      else
        for (const s of item.string_list_data ?? [
          { value: item.title ?? item.username },
        ])
          add(s.value, Number(s.timestamp ?? 0) * 1000);
    }
  } else {
    const re =
      /href\s*=\s*["']https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([a-z0-9._]{1,30})(?:[\/\?#][^"']*)?["']/gi;
    for (const m of text.matchAll(re)) add(m[1]);
  }
  return { users: clean(users), timestamps };
}
export async function importZip(
  file: Blob,
  current: Followers,
): Promise<Followers> {
  if (file.size > 100 * 1024 * 1024) throw Error("ZIP excede 100 MB.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const selected = Object.values(zip.files).filter((f) =>
    /(?:^|\/)(followers(?:_\d+)?|following)\.(json|html)$/i.test(f.name),
  );
  if (selected.length > 100) throw Error("Exportação com arquivos demais.");
  const following: string[] = [],
    followers: string[] = [],
    timestamps: Record<string, number> = {};
  let hasFollowing = false,
    hasFollowers = false,
    total = 0;
  for (const f of selected) {
    const declared =
      (f as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    if (declared > 10 * 1024 * 1024 || total + declared > 30 * 1024 * 1024)
      throw Error("ZIP expandido excede limite.");
    const t = await f.async("string");
    total += t.length;
    if (t.length > 10 * 1024 * 1024 || total > 30 * 1024 * 1024)
      throw Error("ZIP expandido excede limite.");
    const p = parseExport(f.name.toLowerCase(), t);
    if (/(?:^|\/)following\./i.test(f.name)) {
      following.push(...p.users);
      Object.assign(timestamps, p.timestamps);
      hasFollowing = true;
    } else {
      followers.push(...p.users);
      hasFollowers = true;
    }
  }
  if (!hasFollowing || !hasFollowers)
    throw Error("O ZIP precisa conter seguidores e seguindo.");
  const a = clean(following),
    b = clean(followers);
  return followerSchema.parse({
    ...current,
    users: compare(a, b).notFollowingBack,
    following: a,
    followers: b,
    timestamps,
    source: {
      name: "Exportação Instagram",
      updated: new Date().toISOString(),
      following: a.length,
      followers: b.length,
      partial: a.length >= 100 && b.length < Math.max(20, a.length * 0.1),
    },
  });
}
export function restoreFollowers(raw: unknown, current: Followers): Followers {
  const obj = raw as Record<string, unknown>;
  const candidate = Array.isArray(raw)
    ? { ...current, completed: raw }
    : obj?.followers &&
        typeof obj.followers === "object" &&
        !Array.isArray(obj.followers)
      ? obj.followers
      : raw;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    (!Array.isArray((candidate as Record<string, unknown>).users) &&
      !Array.isArray((candidate as Record<string, unknown>).completed))
  )
    throw Error("Backup inválido.");
  const parsed = followerSchema.parse({
    ...emptyFollowers,
    ...current,
    ...(candidate as object),
  });
  const protectedUsers = clean([...current.protected, ...parsed.protected]);
  return {
    ...parsed,
    users: clean(parsed.users),
    completed: clean([...current.completed, ...parsed.completed]).filter(
      (u) => !protectedUsers.includes(u),
    ),
    protected: protectedUsers,
    history: [...current.history, ...parsed.history]
      .filter(
        (v, i, a) =>
          a.findIndex(
            (x) => x.at === v.at && x.user === v.user && x.action === v.action,
          ) === i,
      )
      .slice(-10000),
  };
}
export function profileLink(user: string, mode: string, android: boolean) {
  const n = normalize(user);
  if (!/^[a-z0-9._]{1,30}$/.test(n)) throw Error("Usuário inválido");
  const web = `https://www.instagram.com/${n}/`;
  return mode === "app" && android
    ? `intent://instagram.com/_u/${n}/#Intent;scheme=https;package=com.instagram.android;S.browser_fallback_url=${encodeURIComponent(web)};end`
    : web;
}
