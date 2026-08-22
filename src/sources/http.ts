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

/** Real client backed by fetch(); mirrors the Python curl behavior (20s timeout). */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly timeoutMs = 20_000) {}

  async json(url: string, token?: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    // The Python script only forwards the token to github.com URLs.
    if (token && url.includes("github.com")) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`fetch failed: ${url} (HTTP ${res.status})`);
    return await res.json();
  }

  async text(url: string): Promise<string> {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`fetch failed: ${url} (HTTP ${res.status})`);
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
