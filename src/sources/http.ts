/**
 * HTTP abstraction for upstream sources. Fetchers depend on this interface so
 * tests (and RADAR_OFFLINE) can inject controlled behavior.
 */

export interface HttpClient {
  /** GET a URL and parse the body as JSON. Throws on transport or HTTP errors. */
  json(url: string, token?: string): Promise<unknown>;
  /** GET a URL and return the body as text. Throws on transport or HTTP errors. */
  text(url: string): Promise<string>;
}

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Thrown when an HTTP response says "don't bother retrying" (4xx, except 429). */
class NonRetryableFetchError extends Error {}

/** Real client backed by fetch() with timeout and retry. */
export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly timeoutMs = envInt("RADAR_FETCH_TIMEOUT_MS", 20_000),
    private readonly retries = envInt("RADAR_FETCH_RETRIES", 1),
  ) {}

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          ...init,
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return res;
        // 5xx and 429 are retryable; other 4xx are client errors.
        if (res.status < 500 && res.status !== 429) {
          throw new NonRetryableFetchError(
            `fetch failed: ${url} (HTTP ${res.status})`,
          );
        }
        lastErr = new Error(`fetch failed: ${url} (HTTP ${res.status})`);
      } catch (err) {
        if (err instanceof NonRetryableFetchError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          lastErr = new Error(`fetch timed out: ${url} (>${this.timeoutMs}ms)`);
        } else {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }
      if (attempt < this.retries) {
        // Short backoff: 250ms, 500ms, …
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async json(url: string, token?: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    // Only forward the token to github.com URLs.
    if (token && url.includes("github.com")) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await this.fetchWithRetry(url, { headers });
    return await res.json();
  }

  async text(url: string): Promise<string> {
    const res = await this.fetchWithRetry(url, {});
    return await res.text();
  }
}

/** Client that fails every request — used by RADAR_OFFLINE and tests. */
export class OfflineHttpClient implements HttpClient {
  constructor(private readonly message = "offline mode (RADAR_OFFLINE=1)") {}
  json(url: string): Promise<never> {
    return Promise.reject(new Error(`fetch failed: ${url} (${this.message})`));
  }
  text(url: string): Promise<never> {
    return Promise.reject(new Error(`fetch failed: ${url} (${this.message})`));
  }
}
