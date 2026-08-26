/**
 * Minimal Prometheus client for Deno.
 *
 * Deno's built-in OpenTelemetry integration exports traces, metrics, and logs via
 * OTLP, but it does not expose a Prometheus text endpoint. This module provides a
 * tiny registry + text formatter so RADAR can serve `/metrics` directly without a
 * collector in the hot path.
 *
 * Keep label cardinality low. Never use component names, namespaces, or version
 * strings as labels unless the cardinality is known and bounded.
 */

export interface Labels {
  [key: string]: string;
}

function sortedKeys(labels: Labels): string[] {
  return Object.keys(labels).sort();
}

function labelString(labels: Labels): string {
  const keys = sortedKeys(labels);
  if (keys.length === 0) return "";
  const pairs = keys.map((k) => `${k}=${JSON.stringify(String(labels[k]))}`);
  return "{" + pairs.join(",") + "}";
}

function escapeHelp(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

export abstract class Metric {
  abstract readonly type: "counter" | "gauge" | "histogram";
  protected values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    protected readonly labelNames: string[],
  ) {}

  protected key(labels: Labels): string {
    const missing = this.labelNames.filter((n) => !(n in labels));
    if (missing.length > 0) {
      throw new Error(
        `metric ${this.name} missing labels: ${missing.join(", ")}`,
      );
    }
    const subset: Labels = {};
    for (const n of this.labelNames) subset[n] = labels[n];
    return JSON.stringify(subset);
  }

  reset(): void {
    this.values.clear();
  }

  protected renderLines(): string[] {
    const lines: string[] = [
      `# HELP ${this.name} ${escapeHelp(this.help)}`,
      `# TYPE ${this.name} ${this.type}`,
    ];
    if (this.values.size === 0) return lines;
    for (const [key, value] of this.values.entries()) {
      const labels = JSON.parse(key) as Labels;
      lines.push(`${this.name}${labelString(labels)} ${value}`);
    }
    return lines;
  }

  abstract render(): string;
}

export class Counter extends Metric {
  readonly type = "counter";

  add(delta = 1, labels: Labels = {}): void {
    const k = this.key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + delta);
  }

  render(): string {
    return this.renderLines().join("\n");
  }
}

export class Gauge extends Metric {
  readonly type = "gauge";

  set(value: number, labels: Labels = {}): void {
    this.values.set(this.key(labels), value);
  }

  render(): string {
    return this.renderLines().join("\n");
  }
}

export class Histogram extends Metric {
  readonly type = "histogram";
  private sums = new Map<string, number>();
  private counts = new Map<string, number>();

  constructor(
    name: string,
    help: string,
    labelNames: string[],
    readonly buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ) {
    super(name, help, labelNames);
  }

  protected override key(labels: Labels): string {
    const missing = this.labelNames.filter((n) => !(n in labels));
    if (missing.length > 0) {
      throw new Error(
        `metric ${this.name} missing labels: ${missing.join(", ")}`,
      );
    }
    return JSON.stringify(labels);
  }

  observe(value: number, labels: Labels = {}): void {
    const k = this.key(labels);
    this.sums.set(k, (this.sums.get(k) ?? 0) + value);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    for (const b of this.buckets) {
      const bucketLabels = { ...labels, le: String(b) };
      const bk = this.key(bucketLabels);
      if (value <= b) {
        this.values.set(bk, (this.values.get(bk) ?? 0) + 1);
      } else if (!this.values.has(bk)) {
        this.values.set(bk, 0);
      }
    }
    const infKey = this.key({ ...labels, le: "+Inf" });
    this.values.set(infKey, (this.values.get(infKey) ?? 0) + 1);
  }

  override reset(): void {
    super.reset();
    this.sums.clear();
    this.counts.clear();
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${escapeHelp(this.help)}`,
      `# TYPE ${this.name} histogram`,
    ];
    if (this.counts.size === 0) return lines.join("\n");

    const baseKeys = Array.from(this.counts.keys())
      .map((k) => JSON.parse(k) as Labels)
      .sort((a, b) => labelString(a).localeCompare(labelString(b)));

    for (const base of baseKeys) {
      const baseKey = this.key(base);
      for (const b of [...this.buckets, "+Inf"]) {
        const bucketLabels = { ...base, le: String(b) };
        const bk = this.key(bucketLabels);
        lines.push(
          `${this.name}_bucket${labelString(bucketLabels)} ${this.values.get(bk) ?? 0}`,
        );
      }
      lines.push(`${this.name}_sum${labelString(base)} ${this.sums.get(baseKey) ?? 0}`);
      lines.push(`${this.name}_count${labelString(base)} ${this.counts.get(baseKey) ?? 0}`);
    }
    return lines.join("\n");
  }
}

const registry: Metric[] = [];

export function registerMetric(metric: Metric): void {
  registry.push(metric);
}

export function resetMetrics(): void {
  registry.length = 0;
}

export function getMetrics(): Metric[] {
  return registry;
}

export function createCounter(
  name: string,
  help: string,
  labelNames: string[] = [],
): Counter {
  const c = new Counter(name, help, labelNames);
  registerMetric(c);
  return c;
}

export function createGauge(
  name: string,
  help: string,
  labelNames: string[] = [],
): Gauge {
  const g = new Gauge(name, help, labelNames);
  registerMetric(g);
  return g;
}

export function createHistogram(
  name: string,
  help: string,
  labelNames: string[] = [],
  buckets?: number[],
): Histogram {
  const h = new Histogram(name, help, labelNames, buckets);
  registerMetric(h);
  return h;
}

export function renderMetrics(): string {
  return registry.map((m) => m.render()).join("\n\n") + "\n";
}

export function metricsHandler(): Response {
  return new Response(renderMetrics(), {
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
}
