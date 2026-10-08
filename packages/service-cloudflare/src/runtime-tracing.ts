import { waitUntil } from "cloudflare:workers";

export function scheduleTraceFlush(flushing: Promise<void>): void {
  waitUntil(flushing);
}