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
export function followerRelations(data: Followers) {
  const following = clean(data.following), followers = clean(data.followers);
  // Counts recorded during import distinguish an empty list from a missing list.
  const available = (following.length > 0 && followers.length > 0) ||
    (data.source?.following === following.length && data.source?.followers === followers.length);
  const comparison = compare(following, followers);
  const groups = {
    all: clean([...following, ...followers, ...data.users]),
    following,
    followers,
    notFollowingBack: available ? comparison.notFollowingBack : [],
    fans: available ? comparison.fans : [],
    mutual: available ? comparison.mutual : [],
  };
  return { available, groups };
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
): {
  users: string[];
  timestamps: Record<string, number>;
  displayNames?: Record<string, string>;
} {
  const users: string[] = [],
    timestamps: Record<string, number> = {},
    displayNames: Record<string, string> = {};
  const add = (v: unknown, t = 0) => {
    if (typeof v !== "string") return;
    const n = normalize(v);
    if (/^[a-z0-9._]{1,30}$/.test(n)) {
      users.push(n);
      if (t) timestamps[n] = t;
    }
  };
  if (path.endsWith(".json")) {
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const items = Array.isArray(data)
      ? data
      : (data?.relationships_following ??
        data?.relationships_followers ??
        data?.followers ??
        data?.following);
    if (!Array.isArray(items)) throw Error("Formato JSON desconhecido.");
    for (const item of items) {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") {
        const entries =
          Array.isArray(item.string_list_data) && item.string_list_data.length
            ? item.string_list_data
            : [{ value: item.title ?? item.username }];
        for (const entry of entries) {
          if (!entry || typeof entry !== "object") continue;
          let handle = entry.value || item.title || item.username;
          if (!handle && typeof entry.href === "string") {
            const match = entry.href.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([a-z0-9._]{1,30})\/?(?:[?#].*)?$/i);
            handle = match?.[1];
          }
          const timestamp = Number(entry.timestamp ?? 0) * 1000;
          add(handle, Number.isFinite(timestamp) ? timestamp : 0);
          const name = item.full_name ?? item.display_name;
          if (
            typeof name === "string" &&
            name.trim() &&
            typeof handle === "string"
          )
            displayNames[normalize(handle)] = name.trim().slice(0, 100);
        }
      }
    }
    if (items.length && !users.length) throw Error(`Nenhum perfil reconhecido em ${path}. Confira o formato da exportação.`);
  } else {
    const re =
      /href\s*=\s*["']https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([a-z0-9._]{1,30})(?:[\/\?#][^"']*)?["']/gi;
    for (const m of text.matchAll(re)) add(m[1]);
  }
  return {
    users: clean(users),
    timestamps,
    ...(Object.keys(displayNames).length ? { displayNames } : {}),
  };
}
export async function importZip(
  file: Blob,
  current: Followers,
): Promise<Followers> {
  if (file.size > 100 * 1024 * 1024) throw Error("ZIP excede 100 MB.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const selected = Object.values(zip.files).filter((f) =>
    /(?:^|\/)(followers(?:_\d+)?|following(?:_\d+)?)\.(json|html)$/i.test(f.name),
  );
  if (selected.length > 100) throw Error("Exportação com arquivos demais.");
  return importFollowerEntries(selected.map((file) => ({
    name: file.name,
    declaredSize: (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
    read: () => file.async("string"),
  })), current);
}

export async function importFollowerFiles(files: File[], current: Followers): Promise<Followers> {
  if (!files.length) throw Error("Selecione os arquivos de seguidores e seguindo.");
  if (files.some((file) => /\.zip$/i.test(file.name))) {
    if (files.length !== 1) throw Error("Selecione um único ZIP ou os arquivos JSON/HTML extraídos.");
    return importZip(files[0], current);
  }
  const pattern = /(?:^|\/)(followers(?:_\d+)?|following(?:_\d+)?)\.(json|html)$/i;
  if (files.some((file) => !pattern.test(file.name)))
    throw Error("Selecione following.json/html e todos os arquivos followers_1.json/html, followers_2 etc., ou o ZIP original.");
  return importFollowerEntries(files.map((file) => ({ name: file.name, declaredSize: file.size, read: () => file.text() })), current);
}

async function importFollowerEntries(entries: { name: string; declaredSize: number; read: () => Promise<string> }[], current: Followers): Promise<Followers> {
  if (entries.length > 100) throw Error("Exportação com arquivos demais.");
  const following: string[] = [], followers: string[] = [],
    timestamps: Record<string, number> = {}, displayNames = { ...current.displayNames };
  let hasFollowing = false, hasFollowers = false, total = 0;
  for (const f of entries) {
    if (f.declaredSize > 10 * 1024 * 1024 || total + f.declaredSize > 30 * 1024 * 1024)
      throw Error("Arquivos expandidos excedem o limite de 30 MB (10 MB por arquivo).");
    const t = await f.read();
    total += t.length;
    if (t.length > 10 * 1024 * 1024 || total > 30 * 1024 * 1024)
      throw Error("Arquivos expandidos excedem o limite de 30 MB (10 MB por arquivo).");
    const p = parseExport(f.name.toLowerCase(), t);
    for (const [user, name] of Object.entries(p.displayNames ?? {}))
      if (!displayNames[user]) displayNames[user] = name;
    if (/(?:^|\/)following(?:_\d+)?\./i.test(f.name)) {
      following.push(...p.users);
      Object.assign(timestamps, p.timestamps);
      hasFollowing = true;
    } else {
      followers.push(...p.users);
      hasFollowers = true;
    }
  }
  if (!hasFollowing || !hasFollowers)
    throw Error("A importação precisa conter seguidores e seguindo. Selecione following e todos os arquivos followers juntos, ou o ZIP completo.");
  if (!following.length && !followers.length)
    throw Error("Nenhum perfil reconhecido nos arquivos. Confira se a exportação contém Seguidores e seguindo em JSON ou HTML.");
  const a = clean(following),
    b = clean(followers);
  return followerSchema.parse({
    ...current,
    users: compare(a, b).notFollowingBack,
    following: a,
    followers: b,
    timestamps,
    displayNames,
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
  const normalized = { ...(candidate as Record<string, unknown>) };
  for (const key of [
    "users",
    "completed",
    "protected",
    "followers",
    "following",
  ]) {
    if (Array.isArray(normalized[key]))
      normalized[key] = clean(
        (normalized[key] as unknown[]).filter(
          (v): v is string => typeof v === "string",
        ),
      );
  }
  const parsed = followerSchema.parse({
    ...emptyFollowers,
    ...current,
    ...normalized,
  });
  const protectedUsers = clean([...current.protected, ...parsed.protected]);
  return {
    ...parsed,
    users: clean(parsed.users),
    completed: clean([...current.completed, ...parsed.completed]).filter(
      (u) => !protectedUsers.includes(u),
    ),
    protected: protectedUsers,
    followers: clean(parsed.followers),
    following: clean(parsed.following),
    displayNames: { ...parsed.displayNames, ...current.displayNames },
    history: [
      ...new Map(
        [...current.history, ...parsed.history].map((event) => [
          `${event.at}:${event.user}:${event.action}`,
          event,
        ]),
      ).values(),
    ].slice(-10000),
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
