import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@^1";
import {
  createCounter,
  createGauge,
  createHistogram,
  renderMetrics,
  resetMetrics,
} from "../../src/telemetry/prometheus.ts";

Deno.test("counter renders Prometheus text", () => {
  resetMetrics();
  const counter = createCounter("test_total", "A test counter", ["color"]);
  counter.add(2, { color: "red" });
  counter.add(1, { color: "blue" });

  const text = renderMetrics();
  assertStringIncludes(text, "# HELP test_total A test counter");
  assertStringIncludes(text, "# TYPE test_total counter");
  assertStringIncludes(text, 'test_total{color="red"} 2');
  assertStringIncludes(text, 'test_total{color="blue"} 1');
});

Deno.test("gauge renders current value", () => {
  resetMetrics();
  const gauge = createGauge("test_gauge", "A test gauge");
  gauge.set(42);

  const text = renderMetrics();
  assertStringIncludes(text, "# TYPE test_gauge gauge");
  assertStringIncludes(text, "test_gauge 42");
});

Deno.test("histogram renders buckets, sum, and count", () => {
  resetMetrics();
  const histogram = createHistogram(
    "test_duration_seconds",
    "A test histogram",
    [],
    [0.1, 0.5, 1],
  );
  histogram.observe(0.05);
  histogram.observe(0.3);
  histogram.observe(1.5);

  const text = renderMetrics();
  assertStringIncludes(text, "# TYPE test_duration_seconds histogram");
  assertStringIncludes(text, 'test_duration_seconds_bucket{le="0.1"} 1');
  assertStringIncludes(text, 'test_duration_seconds_bucket{le="0.5"} 2');
  assertStringIncludes(text, 'test_duration_seconds_bucket{le="+Inf"} 3');
  assertStringIncludes(text, "test_duration_seconds_sum 1.85");
  assertStringIncludes(text, "test_duration_seconds_count 3");
});

Deno.test("missing labels throw", () => {
  resetMetrics();
  const counter = createCounter("labeled_total", "needs labels", ["a"]);
  assertThrows(() => counter.add(1), Error, "missing labels");
});

Deno.test("reset clears all metrics", () => {
  resetMetrics();
  const counter = createCounter("reset_total", "A counter");
  counter.add(5);
  resetMetrics();
  assertEquals(renderMetrics(), "\n");
});
