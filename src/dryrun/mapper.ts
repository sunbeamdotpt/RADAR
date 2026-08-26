import { join } from "jsr:@std/path@^1";

export interface MapperDeps {
  basePath: string;
  hints: Map<string, string>;
}

/**
 * Convert a component name into a filesystem slug matching the base/ layout.
 * Examples: "Cert-manager" → "cert-manager", "Gateway API CRDs" → "gateway-api".
 */
export function slugifyComponentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Possible result of mapping a namespace to its kustomization directory. */
export interface MappedPath {
  /** Absolute path to the directory containing kustomization.yaml. */
  path: string;
  /** Human-readable description of how the path was resolved. */
  source: string;
}

/** Find the kustomization directory for a namespace, or null if none exists. */
export async function mapNamespaceToBase(
  namespace: string,
  deps: MapperDeps,
): Promise<MappedPath | null> {
  const hinted = deps.hints.get(namespace);
  if (hinted) {
    const hintedPath = join(deps.basePath, hinted);
    if (await hasKustomization(hintedPath)) {
      return { path: hintedPath, source: "seed_hint" };
    }
  }

  const nsSlug = slugifyComponentName(namespace);
  const candidates = [
    join(deps.basePath, "base", nsSlug),
    join(deps.basePath, nsSlug),
    ...shorterSlugVariants(nsSlug).map((s) => join(deps.basePath, "base", s)),
  ];
  for (const candidate of candidates) {
    if (await hasKustomization(candidate)) {
      return { path: candidate, source: "slug_heuristic" };
    }
  }
  return null;
}

/** Drop trailing slug segments to handle names like "longhorn-system" → longhorn. */
function shorterSlugVariants(slug: string): string[] {
  const parts = slug.split("-");
  const variants: string[] = [];
  while (parts.length > 1) {
    parts.pop();
    variants.push(parts.join("-"));
  }
  return variants;
}

async function hasKustomization(dir: string): Promise<boolean> {
  for (const name of ["kustomization.yaml", "kustomization.yml"]) {
    try {
      const info = await Deno.stat(join(dir, name));
      if (info.isFile) return true;
    } catch {
      // ignore
    }
  }
  return false;
}
