import { describe, expect, it } from "vitest";
import { MOODS, getMood } from "../../src/data/moods";

// The two `--stock` background values from src/app/styles.ts: the newsprint
// light theme and the dark theme. Kept as literal values here (not imported)
// so this test does not silently stop checking anything if styles.ts's
// selector structure changes -- these are the two actual page backgrounds an
// accent renders against.
const STOCK_LIGHT = "#F4F1E8";
const STOCK_DARK = "#14140F";

/** WCAG relative luminance: proper sRGB gamma expansion, not a naive average. */
function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, order-independent. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const REQUIRED_IDS = [
  "preseason", "whered-you-go", "believe", "roy-kent", "comeback-szn",
  "diamond-dogs", "football-is-life", "gaffer-mode", "hopeful", "biscuits",
];

describe("mood catalogue", () => {
  it("contains exactly the ten moods the engine can select", () => {
    expect(MOODS.map((m) => m.id).sort()).toEqual([...REQUIRED_IDS].sort());
  });

  it("has unique ids", () => {
    expect(new Set(MOODS.map((m) => m.id)).size).toBe(MOODS.length);
  });

  it("gives every mood at least three quotes", () => {
    for (const m of MOODS) expect(m.quotes.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every quote non-empty text and a named character", () => {
    for (const m of MOODS) {
      for (const q of m.quotes) {
        expect(q.text.trim().length).toBeGreaterThan(0);
        expect(q.character.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("uses a valid hex accent for every mood", () => {
    for (const m of MOODS) expect(m.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("dates every mood and every gif with an ISO day", () => {
    for (const m of MOODS) {
      expect(m.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const g of m.media) expect(g.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("declares a known kind for every media entry", () => {
    for (const m of MOODS) {
      for (const g of m.media) {
        expect(["gif", "image", "video"]).toContain(g.kind);
      }
    }
  });

  it("gives every gif an https url and alt text that reads as a sentence", () => {
    for (const m of MOODS) {
      for (const g of m.media) {
        expect(g.url.startsWith("https://")).toBe(true);
        expect(g.alt.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("never uses forbidden record language", () => {
    const all = MOODS.flatMap((m) => m.quotes.map((q) => q.text)).join(" ").toLowerCase();
    expect(all).not.toContain("personal record");
  });

  it("clears WCAG large-text contrast (3:1) against both newsprint backgrounds for every accent", () => {
    for (const m of MOODS) {
      const light = contrastRatio(m.accent, STOCK_LIGHT);
      const dark = contrastRatio(m.accent, STOCK_DARK);
      expect(light, `${m.id} (${m.accent}) against light stock`).toBeGreaterThanOrEqual(3);
      expect(dark, `${m.id} (${m.accent}) against dark stock`).toBeGreaterThanOrEqual(3);
    }
  });

  it("resolves a known id and rejects an unknown one", () => {
    expect(getMood("believe")?.name).toBe("Occasione");
    expect(getMood("nope")).toBeUndefined();
  });

  // A mood with an empty `gifs` array is a legitimate, honest state (the
  // page's designed no-GIF hero layout) — not every mood is required to have
  // one. This test only pins the shape of whatever GIFs a mood DOES carry; it
  // must not also pin how many moods currently have none, or it becomes a
  // regression the day someone sources the rest.
  it("gives every populated mood well-formed GIF entries, and allows some moods to have none", () => {
    const withGifs = MOODS.filter((m) => m.media.length > 0);
    expect(withGifs.length).toBeGreaterThan(0);
    for (const m of MOODS) {
      for (const g of m.media) {
        expect(g.url.startsWith("https://")).toBe(true);
        expect(g.alt.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
        expect(g.source.trim().length).toBeGreaterThan(0);
        expect(g.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
