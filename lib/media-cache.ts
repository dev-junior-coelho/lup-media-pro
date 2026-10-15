type Load = (id: string, workspace: string) => Promise<string>;

/** Deduplicates downloads and limits parallel transfers; object URLs belong to this cache. */
export class MediaCache {
  private urls = new Map<string, string>();
  private pending = new Map<string, Promise<string | undefined>>();
  private lanes: Promise<unknown>[] = Array.from({ length: 3 }, () =>
    Promise.resolve(),
  );
  private cursor = 0;
  private generation = 0;
  private retained: Set<string> | null = null;
  constructor(private download: Load) {}
  get(id: string) {
    return this.urls.get(id);
  }
  set(id: string, url: string) {
    const previous = this.urls.get(id);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    this.urls.set(id, url);
  }
  retain(ids: Set<string>) {
    this.retained = ids;
    for (const [id, url] of this.urls) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        this.urls.delete(id);
      }
    }
  }
  clear() {
    this.generation++;
    this.retain(new Set());
    this.retained = null;
    this.pending.clear();
    this.lanes = Array.from({ length: 3 }, () => Promise.resolve());
    this.cursor = 0;
  }
  load(id: string, workspace: string): Promise<string | undefined> {
    if (this.urls.has(id)) return Promise.resolve(this.urls.get(id));
    const key = `${workspace}/${id}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const lane = this.cursor++ % this.lanes.length;
    const task = this.lanes[lane]
      .then(async () => {
        if (
          generation !== this.generation ||
          (this.retained && !this.retained.has(id))
        )
          return undefined;
        const url = await this.download(id, workspace);
        if (
          generation !== this.generation ||
          (this.retained && !this.retained.has(id))
        ) {
          URL.revokeObjectURL(url);
          return undefined;
        }
        // A local upload may have populated the cache while this download ran.
        const current = this.urls.get(id);
        if (current) {
          URL.revokeObjectURL(url);
          return current;
        }
        this.set(id, url);
        return url;
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key);
      });
    this.pending.set(key, task);
    this.lanes[lane] = task;
    return task;
  }
}
