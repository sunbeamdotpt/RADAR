/**
 * DOMAIN_SUFFIX placeholder resolution.
 *
 * The sbbb manifests use the literal string DOMAIN_SUFFIX anywhere a concrete
 * domain is needed; it is substituted at deploy/inventory time.
 */

export const DEFAULT_DOMAIN_SUFFIX = "sunbeam.pt";

/** Replace every DOMAIN_SUFFIX placeholder occurrence with the concrete suffix. */
export function normalizeDomainSuffix(value: string, suffix: string): string {
  return value.replaceAll("DOMAIN_SUFFIX", suffix);
}
