import type { Component } from "../schema/component.ts";

/**
 * Static source: no upstream check. `latest` is whatever the registry already
 * carries (seed/previous run), or "unknown"; link is the raw link_template.
 */
export function fetchStatic(component: Component): void {
  component.latest = component.latest || "unknown";
  component.latest_link = component.link_template;
}

/** Fallback for sources without a fetcher (e.g. "custom"). */
export function fetchUnknown(component: Component): void {
  component.latest = "unknown";
  component.latest_link = component.link_template;
}
