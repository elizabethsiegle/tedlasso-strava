import { describe, expect, it } from "vitest";
import { MOODS, getMood } from "../../src/data/moods";

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
      for (const g of m.gifs) expect(g.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("gives every gif an https url and alt text that reads as a sentence", () => {
    for (const m of MOODS) {
      for (const g of m.gifs) {
        expect(g.url.startsWith("https://")).toBe(true);
        expect(g.alt.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("never uses forbidden record language", () => {
    const all = MOODS.flatMap((m) => m.quotes.map((q) => q.text)).join(" ").toLowerCase();
    expect(all).not.toContain("personal record");
  });

  it("resolves a known id and rejects an unknown one", () => {
    expect(getMood("believe")?.name).toBe("Believe");
    expect(getMood("nope")).toBeUndefined();
  });

  // GIF sourcing pass: 6 of the 10 moods (preseason, believe, roy-kent,
  // comeback-szn, diamond-dogs, football-is-life) now carry one or more
  // hand-verified GIF URLs. The remaining 4 (whered-you-go, gaffer-mode,
  // hopeful, biscuits) legitimately ship with an empty `gifs` array — no
  // candidate found during the sourcing pass returned a verified 2xx
  // image response, and an honest empty state (the page's designed
  // no-GIF hero layout) is preferred over a fabricated or unverified URL.
  it("gives every populated mood well-formed GIF entries, and allows some moods to have none", () => {
    const withGifs = MOODS.filter((m) => m.gifs.length > 0);
    expect(withGifs.length).toBeGreaterThan(0);
    expect(withGifs.length).toBeLessThan(MOODS.length);
    for (const m of MOODS) {
      for (const g of m.gifs) {
        expect(g.url.startsWith("https://")).toBe(true);
        expect(g.alt.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
        expect(g.source.trim().length).toBeGreaterThan(0);
        expect(g.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
