import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { mapNamespaceToBase, slugifyComponentName } from "../../src/dryrun/mapper.ts";

Deno.test("slugifyComponentName normalizes names to base-directory slugs", () => {
  assertEquals(slugifyComponentName("Cert-manager"), "cert-manager");
  assertEquals(slugifyComponentName("Gateway API CRDs"), "gateway-api-crds");
  assertEquals(slugifyComponentName("Longhorn"), "longhorn");
  assertEquals(slugifyComponentName("  spaced  -- name "), "spaced-name");
});

Deno.test("mapNamespaceToBase uses base/<namespace>", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "base", "monitoring"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "monitoring", "kustomization.yaml"),
      "kind: Kustomization",
    );

    const mapped = await mapNamespaceToBase(
      "monitoring",
      { basePath: base, hints: new Map() },
    );
    assertEquals(mapped?.path, join(base, "base", "monitoring"));
    assertEquals(mapped?.source, "slug_heuristic");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapNamespaceToBase prefers seed hints", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "custom", "vso"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "custom", "vso", "kustomization.yaml"),
      "kind: Kustomization",
    );

    const mapped = await mapNamespaceToBase(
      "vault-secrets-operator",
      { basePath: base, hints: new Map([["vault-secrets-operator", "custom/vso"]]) },
    );
    assertEquals(mapped?.path, join(base, "custom", "vso"));
    assertEquals(mapped?.source, "seed_hint");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapNamespaceToBase falls back to shorter slug variants", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "base", "longhorn"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "longhorn", "kustomization.yaml"),
      "kind: Kustomization",
    );

    const mapped = await mapNamespaceToBase(
      "longhorn-system",
      { basePath: base, hints: new Map() },
    );
    assertEquals(mapped?.path, join(base, "base", "longhorn"));
    assertEquals(mapped?.source, "slug_heuristic");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapNamespaceToBase returns null when no kustomization exists", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    const mapped = await mapNamespaceToBase(
      "missing",
      { basePath: base, hints: new Map() },
    );
    assertEquals(mapped, null);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapNamespaceToBase accepts kustomization.yml", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "base", "monitoring"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "monitoring", "kustomization.yml"),
      "kind: Kustomization",
    );

    const mapped = await mapNamespaceToBase(
      "monitoring",
      { basePath: base, hints: new Map() },
    );
    assertEquals(mapped?.path, join(base, "base", "monitoring"));
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
