import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "jsr:@std/path@^1";
import { mapComponentToKustomization, slugifyComponentName } from "../../src/dryrun/mapper.ts";

Deno.test("slugifyComponentName normalizes names to base-directory slugs", () => {
  assertEquals(slugifyComponentName("Cert-manager"), "cert-manager");
  assertEquals(slugifyComponentName("Gateway API CRDs"), "gateway-api-crds");
  assertEquals(slugifyComponentName("Longhorn"), "longhorn");
  assertEquals(slugifyComponentName("  spaced  -- name "), "spaced-name");
});

Deno.test("mapComponentToKustomization uses shorter slug variants", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "base", "gateway-api"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "gateway-api", "kustomization.yaml"),
      "kind: Kustomization",
    );

    const mapped = await mapComponentToKustomization("Gateway API CRDs", {
      basePath: base,
      hints: new Map(),
    });
    assertEquals(mapped?.path, join(base, "base", "gateway-api"));
    assertEquals(mapped?.source, "slug_heuristic");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapComponentToKustomization prefers seed hints", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "custom", "longhorn"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "custom", "longhorn", "kustomization.yaml"),
      "kind: Kustomization",
    );

    const mapped = await mapComponentToKustomization("Longhorn", {
      basePath: base,
      hints: new Map([["Longhorn", "custom/longhorn"]]),
    });
    assertEquals(mapped?.path, join(base, "custom", "longhorn"));
    assertEquals(mapped?.source, "seed_hint");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapComponentToKustomization falls back to base/<slug>", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "base", "cert-manager"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "cert-manager", "kustomization.yaml"),
      "kind: Kustomization",
    );

    const mapped = await mapComponentToKustomization("Cert-manager", {
      basePath: base,
      hints: new Map(),
    });
    assertEquals(mapped?.path, join(base, "base", "cert-manager"));
    assertEquals(mapped?.source, "slug_heuristic");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapComponentToKustomization returns null when no kustomization exists", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    const mapped = await mapComponentToKustomization("Missing", {
      basePath: base,
      hints: new Map(),
    });
    assertEquals(mapped, null);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("mapComponentToKustomization accepts kustomization.yml", async () => {
  const base = await Deno.makeTempDir({ prefix: "radar-dryrun-mapper-" });
  try {
    await Deno.mkdir(join(base, "base", "gateway-api"), { recursive: true });
    await Deno.writeTextFile(
      join(base, "base", "gateway-api", "kustomization.yml"),
      "kind: Kustomization",
    );

    const mapped = await mapComponentToKustomization("Gateway API CRDs", {
      basePath: base,
      hints: new Map(),
    });
    assertEquals(mapped?.path, join(base, "base", "gateway-api"));
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
