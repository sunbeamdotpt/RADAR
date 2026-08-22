import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1";
import { FetchHttpClient } from "../../src/sources/http.ts";
import { formatGeneratedAtUtc, parseGeneratedAtUtc } from "../../src/domain/time.ts";
import { scanBaseManifests } from "../../src/scan/manifests.ts";
import { join } from "jsr:@std/path@^1";

// --- FetchHttpClient against a real local server ---

async function withServer(
  handler: (req: Request) => Response,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, handler);
  try {
    await fn(`http://127.0.0.1:${server.addr.port}`);
  } finally {
    await server.shutdown();
  }
}

Deno.test("FetchHttpClient.json parses bodies and forwards tokens to github.com only", async () => {
  const seen: Record<string, string | null> = {};
  await withServer(
    (req) => {
      seen[req.url] = req.headers.get("authorization");
      return Response.json({ tag_name: "v1.0.0" });
    },
    async (base) => {
      const http = new FetchHttpClient();
      const data = await http.json(`${base}/github.com/api`, "secret-token") as Record<
        string,
        unknown
      >;
      assertEquals(data.tag_name, "v1.0.0");
      await http.json(`${base}/other.example/api`, "secret-token");
      assertEquals(seen[`${base}/github.com/api`], "Bearer secret-token");
      assertEquals(seen[`${base}/other.example/api`], null);
    },
  );
});

Deno.test("FetchHttpClient.text returns raw bodies", async () => {
  await withServer(
    () => new Response("entries: {}\n"),
    async (base) => {
      const http = new FetchHttpClient();
      assertEquals(await http.text(`${base}/index.yaml`), "entries: {}\n");
    },
  );
});

Deno.test("FetchHttpClient throws on HTTP errors", async () => {
  await withServer(
    () => new Response("nope", { status: 503 }),
    async (base) => {
      const http = new FetchHttpClient();
      await assertRejects(() => http.json(`${base}/x`), Error, "HTTP 503");
      await assertRejects(() => http.text(`${base}/x`), Error, "HTTP 503");
    },
  );
});

// --- time helpers ---

Deno.test("parseGeneratedAtUtc round-trips the report timestamp", () => {
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assertEquals(parseGeneratedAtUtc(formatGeneratedAtUtc(date)).getTime(), date.getTime());
  assertThrows(() => parseGeneratedAtUtc("2026-08-21T12:00:00Z"), Error, "invalid generated_at");
});

// --- scanner edge cases ---

Deno.test("scanBaseManifests returns empty when base/ is missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-scan-empty-" });
  try {
    assertEquals(await scanBaseManifests(dir, "sunbeam.pt"), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("scanBaseManifests skips invalid kustomizations and incomplete entries", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-scan-edge-" });
  try {
    const ns = join(dir, "base", "edge");
    await Deno.mkdir(ns, { recursive: true });
    await Deno.writeTextFile(
      join(ns, "kustomization.yaml"),
      `kind: Kustomization
# no namespace key → falls back to the directory name
helmCharts:
  - name: incomplete-chart        # missing repo+version → skipped
  - name: good-chart
    repo: https://charts.example.io/
    version: "1.0.0"
images:
  - name: ""                      # empty → skipped
  - newName: oci.DOMAIN_SUFFIX/studio/press
resources:
  - 42                            # non-string → skipped
  - missing-file.yaml             # not a file → skipped
`,
    );
    const scanned = await scanBaseManifests(dir, "example.com");
    assertEquals(scanned.length, 2);
    assertEquals(scanned[0].namespace, "edge");
    const chart = scanned.find((s) => s.source === "helm_chart")!;
    assertEquals(chart.upstream, "https://charts.example.io::good-chart");
    const image = scanned.find((s) => s.source === "static")!;
    assertEquals(image.upstream, "oci.example.com/studio/press");
    assertEquals(image.current, "latest");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("scanBaseManifests tolerates unparsable kustomization.yaml", async () => {
  const dir = await Deno.makeTempDir({ prefix: "radar-scan-bad-" });
  try {
    const ns = join(dir, "base", "bad");
    await Deno.mkdir(ns, { recursive: true });
    await Deno.writeTextFile(join(ns, "kustomization.yaml"), "{not: valid: [yaml");
    assertEquals(await scanBaseManifests(dir, "sunbeam.pt"), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
