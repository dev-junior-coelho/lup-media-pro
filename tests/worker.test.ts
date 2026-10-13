import { describe, it, expect, vi } from "vitest";
import {
  processJob,
  type JobStore,
  type PublishingClient,
} from "../lib/server/worker";
import { MetaError } from "../lib/server/meta";
import {
  type Post,
  type Account,
  type Media,
  validatePublication,
} from "../lib/shared/schema";
const now = Date.now();
const account: Account & { token: string } = {
  id: "ig",
  username: "test",
  accountType: "BUSINESS",
  expiresAt: new Date(now + 100000).toISOString(),
  permissions: ["instagram_business_content_publish"],
  status: "connected",
  token: "test",
};
const media: Media & { url: string } = {
  id: "media",
  name: "test.jpg",
  mime: "image/jpeg",
  size: 1000,
  path: "w/m",
  width: 1080,
  height: 1080,
  duration: 0,
  createdAt: new Date(now).toISOString(),
  url: "https://storage.example/image",
};
const post: Post = {
  id: "p",
  accountId: "ig",
  type: "post",
  caption: "Teste",
  mediaIds: ["media"],
  scheduledAt: new Date(now - 1000).toISOString(),
  status: "scheduled",
  revision: 1,
  createdAt: new Date(now - 1000).toISOString(),
  updatedAt: new Date(now).toISOString(),
};
function setup(p: Partial<Post> = {}) {
  let current = { ...post, ...p };
  let claimed = false;
  const patches: Partial<Post>[] = [];
  const store: JobStore = {
    claim: async () => {
      if (
        claimed ||
        ["published", "failed", "cancelled", "draft"].includes(current.status)
      )
        return null;
      claimed = true;
      return current;
    },
    save: async (patch) => {
      patches.push(patch);
      current = { ...current, ...patch };
    },
    account: async () => account,
    media: async () => [media],
  };
  const client: PublishingClient = {
    create: vi.fn(async () => ({ id: "container" })),
    status: vi.fn(async () => ({ status_code: "FINISHED" })),
    publish: vi.fn(async () => ({ id: "published" })),
    media: vi.fn(async () => ({
      id: "published",
      permalink: "https://instagram.com/p/test",
    })),
    limit: vi.fn(async () => ({
      data: [{ quota_usage: 0, config: { quota_total: 100 } }],
    })),
  };
  return {
    store,
    client,
    patches,
    get: () => current,
    release: () => {
      claimed = false;
    },
  };
}
describe("scheduler oficial com Meta simulada", () => {
  it("cria contêiner, espera processamento e publica somente uma vez", async () => {
    const x = setup();
    await processJob(x.store, () => x.client, now);
    expect(x.get().containerId).toBe("container");
    expect(x.client.publish).not.toHaveBeenCalled();
    x.release();
    await processJob(x.store, () => x.client, now + 60000);
    expect(x.get().status).toBe("published");
    expect(x.get().instagramId).toBe("published");
    x.release();
    await processJob(x.store, () => x.client, now + 120000);
    expect(x.client.publish).toHaveBeenCalledTimes(1);
  });
  it("impede execução concorrente", async () => {
    const x = setup({ containerId: "c" });
    await Promise.all([
      processJob(x.store, () => x.client),
      processJob(x.store, () => x.client),
    ]);
    expect(x.client.publish).toHaveBeenCalledTimes(1);
  });
  it("reconcilia timeout sem repetir publicação", async () => {
    const x = setup({ containerId: "c" });
    vi.mocked(x.client.publish).mockRejectedValue(new MetaError(0, true, true));
    await processJob(x.store, () => x.client, now);
    expect(x.get().uncertain).toBe(true);
    x.release();
    vi.mocked(x.client.status).mockResolvedValue({ status_code: "PUBLISHED" });
    await processJob(x.store, () => x.client, now + 120000);
    expect(x.get().status).toBe("published");
    expect(x.client.publish).toHaveBeenCalledTimes(1);
  });
  it("bloqueia resultado incerto ainda não reconciliado", async () => {
    const x = setup({ containerId: "c", phase: "publishing", uncertain: true });
    await processJob(x.store, () => x.client, now);
    expect(x.get().status).toBe("failed");
    expect(x.get().uncertain).toBe(true);
    expect(x.client.publish).not.toHaveBeenCalled();
  });
  it("trata token expirado e falha permanente", async () => {
    const x = setup();
    x.store.account = async () => ({
      ...account,
      expiresAt: new Date(now - 1).toISOString(),
    });
    await processJob(x.store, () => x.client, now);
    expect(x.get().status).toBe("failed");
    expect(x.get().error).toContain("expirado");
    expect(x.client.create).not.toHaveBeenCalled();
  });
  it("usa backoff para falha transitória antes de publicar", async () => {
    const x = setup();
    vi.mocked(x.client.create).mockRejectedValue(new MetaError(4, true));
    await processJob(x.store, () => x.client, now);
    expect(x.get().status).toBe("scheduled");
    expect(Date.parse(x.get().nextAttemptAt!)).toBeGreaterThan(now);
  });
  it("não executa cancelamento ou rascunho", async () => {
    for (const status of ["cancelled", "draft"] as const) {
      const x = setup({ status });
      await processJob(x.store, () => x.client, now);
      expect(x.client.create).not.toHaveBeenCalled();
    }
  });
  it("espera contêiner em processamento", async () => {
    const x = setup({ containerId: "c" });
    vi.mocked(x.client.status).mockResolvedValue({
      status_code: "IN_PROGRESS",
    });
    await processJob(x.store, () => x.client, now);
    expect(x.get().status).toBe("processing");
    expect(x.client.publish).not.toHaveBeenCalled();
  });
  it("registra erro quando Meta rejeita o contêiner", async () => {
    const x = setup({ containerId: "c" });
    vi.mocked(x.client.status).mockResolvedValue({ status_code: "ERROR" });
    await processJob(x.store, () => x.client, now);
    expect(x.get().status).toBe("failed");
  });
  it("valida formatos, contagem, proporções e datas", () => {
    expect(() =>
      validatePublication(
        { ...post, intent: "schedule" },
        [media],
        account,
        now,
      ),
    ).toThrow("futuro");
    expect(() =>
      validatePublication(
        { ...post, intent: "now" },
        [{ ...media, mime: "image/png" }],
        account,
        now,
      ),
    ).toThrow("JPEG");
    expect(() =>
      validatePublication(
        { ...post, type: "carousel", intent: "now" },
        [media],
        account,
        now,
      ),
    ).toThrow("2 a 10");
    expect(() =>
      validatePublication(
        { ...post, type: "story", intent: "now" },
        [media],
        { ...account, accountType: "MEDIA_CREATOR" },
        now,
      ),
    ).toThrow("Business");
  });
});
