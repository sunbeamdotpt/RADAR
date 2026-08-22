/** Shared helpers for source fetchers. */

/** Python str.strip(chars): strip any leading/trailing chars contained in `chars`. */
export function stripChars(s: string, chars: string): string {
  const set = new Set(chars);
  let start = 0;
  let end = s.length;
  while (start < end && set.has(s[start])) start++;
  while (end > start && set.has(s[end - 1])) end--;
  return s.slice(start, end);
}

/**
 * Minimal str.format stand-in: replaces {key} for every provided key.
 * Placeholders without a provided value are left intact (the Python script only
 * ever formats templates with exactly the keys they declare).
 */
export function formatTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

/** Read a string property, falling back when missing or not a string. */
export function stringField(obj: unknown, key: string, fallback: string): string {
  if (typeof obj !== "object" || obj === null) return fallback;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" ? value : fallback;
}
