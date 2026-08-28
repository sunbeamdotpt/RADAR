import { assertEquals } from "jsr:@std/assert@^1";
import { activeSpanContext, withExtractedContext, withSpan } from "../../src/telemetry/tracing.ts";

Deno.test("withSpan returns the function result", async () => {
  const result = await withSpan("test-span", (span) => {
    span.setAttribute("test", "true");
    return 42;
  });
  assertEquals(result, 42);
});

Deno.test("withSpan records errors and rethrows", async () => {
  let caught: Error | undefined;
  try {
    await withSpan("failing-span", () => {
      throw new Error("boom");
    });
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message, "boom");
});

Deno.test("withSpan records async rejection and rethrows", async () => {
  let caught: Error | undefined;
  try {
    await withSpan("async-failing-span", () => Promise.reject(new Error("async boom")));
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message, "async boom");
});

Deno.test("activeSpanContext is empty when no span is active", () => {
  assertEquals(activeSpanContext(), {});
});

Deno.test("withExtractedContext runs the callback", () => {
  const headers = new Headers();
  let ran = false;
  withExtractedContext(headers, () => {
    ran = true;
  });
  assertEquals(ran, true);
});
