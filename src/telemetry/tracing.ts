/**
 * OpenTelemetry tracing helpers.
 *
 * Deno provides built-in OpenTelemetry support when `OTEL_DENO=true` is set. It
 * already auto-instruments `Deno.serve`, `fetch`, and `console.log`. We only need
 * the `@opentelemetry/api` package to create custom spans and to read the active
 * span for log correlation.
 */

import { context, propagation, Span, SpanStatusCode, trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("radar", "0.1.0");

/**
 * Run an async function inside a new span. The span is ended in a `finally`
 * block and any thrown error is recorded before rethrowing.
 */
export function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, unknown>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        if (v !== undefined && v !== null) span.setAttribute(k, String(v));
      }
    }
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      recordError(span, err);
      span.end();
      throw err;
    }
  });
}

function recordError(span: Span, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.recordException(err instanceof Error ? err : new Error(message));
}

/** Read the active span context for log correlation. */
export function activeSpanContext(): { trace_id?: string; span_id?: string } {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  if (!ctx || !ctx.traceId || !ctx.spanId) return {};
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

/** Run code inside the context extracted from incoming HTTP headers. */
export function withExtractedContext<T>(headers: Headers, fn: () => T): T {
  const extracted = propagation.extract(context.active(), headers);
  return context.with(extracted, fn);
}
