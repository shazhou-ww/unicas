import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => { };
}

afterEach(() => {
  if (typeof document !== "undefined") {
    cleanup();
    document.head.querySelector('meta[name="x-csrf-token"]')?.remove();
  }
  vi.unstubAllGlobals();
});
