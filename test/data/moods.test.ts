import { describe, expect, it } from "vitest";
import { MOODS, getMood } from "../../src/data/moods";

const REQUIRED_IDS = [
  "preseason", "whered-you-go", "believe", "roy-kent", "comeback-szn",
  "football-is-life", "gaffer-mode", "hopeful", "biscuits",
];

describe("mood catalogue", () => {
  it("contains exactly the nine moods the engine can select", () => {
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

  // Temporary assertion: GIF sourcing is a separate follow-up pass (see
  // src/data/moods.ts), so every mood currently ships with an empty `gifs`
  // array. This makes that gap a deliberate, visible fact in the suite
  // rather than something the vacuously-passing loops above would hide.
  // The GIF-sourcing pass should invert this test once it populates arrays.
  it("has zero verified GIFs per mood for now, pending the GIF-sourcing follow-up", () => {
    for (const m of MOODS) expect(m.gifs.length).toBe(0);
  });
});
