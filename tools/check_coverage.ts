/**
 * Coverage gate: parse coverage/lcov.info and fail when line coverage of
 * production code (src/, excluding tests and fixtures) is below the threshold.
 *
 * Usage: deno run --allow-read tools/check_coverage.ts [threshold]
 */

const threshold = Number(Deno.args[0] ?? "95");
const lcov = await Deno.readTextFile("coverage/lcov.info");

let totalFound = 0;
let totalHit = 0;
const weakFiles: { file: string; hit: number; found: number; pct: number }[] = [];

for (const record of lcov.split("end_of_record")) {
  const file = record.match(/SF:(.*)/)?.[1]?.trim();
  if (!file) continue;
  if (file.includes("/tests/") || file.includes("/fixtures/") || file.includes("/tools/")) {
    continue;
  }
  const found = Number(record.match(/LF:(\d+)/)?.[1] ?? "0");
  const hit = Number(record.match(/LH:(\d+)/)?.[1] ?? "0");
  if (found === 0) continue;
  totalFound += found;
  totalHit += hit;
  const pct = (hit / found) * 100;
  if (pct < threshold) {
    weakFiles.push({ file: file.replace(/^file:\/\//, ""), hit, found, pct });
  }
}

const totalPct = totalFound === 0 ? 0 : (totalHit / totalFound) * 100;
console.log(
  `line coverage: ${totalHit}/${totalFound} = ${totalPct.toFixed(2)}% (gate: ${threshold}%)`,
);

if (weakFiles.length > 0) {
  console.log("files below threshold:");
  for (const f of weakFiles.sort((a, b) => a.pct - b.pct)) {
    console.log(`  ${f.pct.toFixed(1)}%  ${f.hit}/${f.found}  ${f.file}`);
  }
}

if (totalPct < threshold) {
  console.error(`coverage gate failed: ${totalPct.toFixed(2)}% < ${threshold}%`);
  Deno.exit(1);
}
