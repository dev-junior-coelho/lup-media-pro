export class MetaError extends Error {
  constructor(
    public code: number,
    public transient: boolean,
    public uncertain: boolean = false,
    public operation?: string,
  ) {
    super(`Meta recusou a operação (código ${code}).`);
  }
}
export class MetaClient {
  constructor(
    private token: string,
    private version = process.env.META_API_VERSION ?? "v24.0",
  ) {}
  async call<T>(
    path: string,
    params: Record<string, string> = {},
    method: "GET" | "POST" | "DELETE" = "GET",
  ): Promise<T> {
    const url = new URL(`https://graph.instagram.com/${this.version}/${path}`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    let body: URLSearchParams | undefined;
    if (method === "GET")
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    else {
      body = new URLSearchParams(params);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    let r: Response;
    try {
      r = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new MetaError(
        0,
        true,
        method === "POST" && path.endsWith("/media_publish"),
        path === "me" ? "profile" : path.endsWith("/permissions") ? "permissions" : "graph",
      );
    }
    const data = await r.json();
    if (!r.ok || data.error)
      throw new MetaError(
        data.error?.code ?? r.status,
        Boolean(data.error?.is_transient) ||
          [4, 17, 32, 613].includes(data.error?.code) ||
          r.status >= 500,
        method === "POST" && path.endsWith("/media_publish") && r.status >= 500,
        path === "me" ? "profile" : path.endsWith("/permissions") ? "permissions" : "graph",
      );
    return data;
  }
  async me() {
    const profile = await this.call<{
      id: string;
      user_id?: string;
      username: string;
    }>("me", { fields: "id,user_id,username" });
    let accountType = "UNKNOWN";
    try {
      const detail = await this.call<{ account_type?: string }>("me", { fields: "account_type" });
      if (typeof detail.account_type === "string")
        accountType = detail.account_type.toUpperCase();
    } catch (e) {
      // Some API versions do not expose this optional field. Keep Stories
      // disabled unless the API explicitly confirms a Business account.
      if (!(e instanceof MetaError) || e.code !== 100) throw e;
    }
    return { ...profile, account_type: accountType };
  }
  permissions() {
    return this.call<{ data: { permission: string; status: string }[] }>(
      "me/permissions",
    );
  }
  create(id: string, p: Record<string, string>) {
    return this.call<{ id: string }>(`${id}/media`, p, "POST");
  }
  status(id: string) {
    return this.call<{ status_code: string; id: string }>(id, {
      fields: "status_code",
    });
  }
  publish(id: string, container: string) {
    return this.call<{ id: string }>(
      `${id}/media_publish`,
      { creation_id: container },
      "POST",
    );
  }
  media(id: string) {
    return this.call<{ id: string; permalink?: string }>(id, {
      fields: "id,permalink",
    });
  }
  revoke() {
    return this.call("me/permissions", {}, "DELETE");
  }
  limit(id: string) {
    return this.call<{
      data: { quota_usage: number; config: { quota_total: number } }[];
    }>(`${id}/content_publishing_limit`, { fields: "quota_usage,config" });
  }
}
async function tokenRequest(
  url: string,
  params: Record<string, string>,
  method = "GET",
) {
  const u = new URL(url);
  if (method === "GET")
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, {
    method,
    body: method === "POST" ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const d = await r.json();
  if (!r.ok || d.error || d.error_message)
    throw new MetaError(d.error?.code ?? r.status, false, false,
      method === "POST" ? "short_token" : "long_token");
  return d;
}
export async function exchangeCode(code: string, redirect: string) {
  const short = await tokenRequest(
    "https://api.instagram.com/oauth/access_token",
    {
      client_id: process.env.META_APP_ID ?? "",
      client_secret: process.env.META_APP_SECRET ?? "",
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code,
    },
    "POST",
  );
  const credential = Array.isArray(short.data) ? short.data[0] : short;
  if (typeof credential?.access_token !== "string" || !credential.access_token)
    throw new MetaError(0, false, false, "short_token_response");
  const long = await tokenRequest("https://graph.instagram.com/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: process.env.META_APP_SECRET ?? "",
    access_token: credential.access_token,
  });
  if (typeof long.access_token !== "string" || !long.access_token ||
      !Number.isFinite(long.expires_in) || long.expires_in <= 0)
    throw new MetaError(0, false, false, "long_token_response");
  const permissions = typeof credential.permissions === "string"
    ? credential.permissions.split(",").map((p: string) => p.trim()).filter(Boolean)
    : Array.isArray(credential.permissions) && credential.permissions.every((p: unknown) => typeof p === "string")
      ? credential.permissions
      : undefined;
  return { ...long, permissions };
}
export async function refreshToken(token: string) {
  return tokenRequest("https://graph.instagram.com/refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: token,
  });
}
