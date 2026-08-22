/** Time helpers for report metadata. */

/** Format like Python's time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()). */
export function formatGeneratedAtUtc(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

/** Parse the report timestamp format back into a Date. */
export function parseGeneratedAtUtc(value: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/);
  if (!m) throw new Error(`invalid generated_at timestamp: ${value}`);
  return new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  );
}
