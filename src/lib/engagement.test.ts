import { describe, it, expect } from "vitest";
import { detectPlatform, OPEN_DEDUPE_MS } from "./engagement";

/*
  WP10 · engagement platform detection. "Detect the platform honestly" — the whole
  measurement is worthless if a phone open is filed as a desktop one, so the mapping
  is pinned here against real User-Agent families.
*/

describe("detectPlatform", () => {
  it("reads an Android phone as mobile", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";
    expect(detectPlatform(ua)).toBe("mobile");
  });

  it("reads an iPhone as mobile", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
    expect(detectPlatform(ua)).toBe("mobile");
  });

  it("reads an iPad as mobile (away-from-desk device)", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15";
    expect(detectPlatform(ua)).toBe("mobile");
  });

  it("reads a Windows desktop as desktop", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
    expect(detectPlatform(ua)).toBe("desktop");
  });

  it("reads a Mac desktop as desktop", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
    expect(detectPlatform(ua)).toBe("desktop");
  });

  it("falls back to desktop on an empty or missing User-Agent", () => {
    expect(detectPlatform("")).toBe("desktop");
    expect(detectPlatform(null)).toBe("desktop");
    expect(detectPlatform(undefined)).toBe("desktop");
  });

  it("keeps a sane dedupe window", () => {
    expect(OPEN_DEDUPE_MS).toBe(60_000);
  });
});
