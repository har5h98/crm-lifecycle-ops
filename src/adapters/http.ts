// Small HTTP helper shared by the adapters: JSON GETs with timeouts, retry on 429/5xx with backoff,
// and a concurrency-limited map for "fetch details for every campaign" loops.

export class ApiError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).pathname}: ${body.slice(0, 200)}`);
  }
}

export type Fetcher = typeof fetch;

export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  opts: { fetcher?: Fetcher; method?: string; body?: unknown } = {},
): Promise<T> {
  const fetcher = opts.fetcher ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const res = await fetcher(url, {
      method: opts.method ?? "GET",
      headers: { accept: "application/json", ...(opts.body ? { "content-type": "application/json" } : {}), ...headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt));
      continue;
    }
    throw new ApiError(res.status, url, await res.text());
  }
}

export async function getText(url: string, headers: Record<string, string>, fetcher: Fetcher = fetch): Promise<string> {
  const res = await fetcher(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new ApiError(res.status, url, await res.text());
  return res.text();
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Loose accessors for API payloads whose exact shape varies by revision. */
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
