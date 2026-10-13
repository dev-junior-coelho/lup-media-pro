export class MetaError extends Error {
  constructor(
    public code: number,
    public transient: boolean,
    public uncertain: boolean = false,
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
      );
    }
    const data = await r.json();
    if (!r.ok || data.error)
      throw new MetaError(
        data.error?.code ?? r.status,
        Boolean(data.error?.is_transient) || r.status >= 500,
        method === "POST" && path.endsWith("/media_publish") && r.status >= 500,
      );
    return data;
  }
  me() {
    return this.call<{
      id: string;
      user_id?: string;
      username: string;
      account_type: string;
    }>("me", { fields: "user_id,username,account_type" });
  }
  permissions(id: string) {
    return this.call<{ data: { permission: string; status: string }[] }>(
      `${id}/permissions`,
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
  revoke(id: string) {
    return this.call(`${id}/permissions`, {}, "DELETE");
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
    throw new MetaError(d.error?.code ?? r.status, false);
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
  return tokenRequest("https://graph.instagram.com/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: process.env.META_APP_SECRET ?? "",
    access_token: short.access_token,
  });
}
export async function refreshToken(token: string) {
  return tokenRequest("https://graph.instagram.com/refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: token,
  });
}
