import { describe, expect, it } from "vitest";
import { MACHIAVELLI_MOODS, getMachiavelliMood } from "../../src/data/machiavelli";
import { MOODS, getMood } from "../../src/data/moods";

// The same two `--stock` values styles.ts paints the page with. Duplicated from
// moods.test.ts on purpose rather than shared: a second voice must not be able
// to ship an accent that fails contrast just because someone edited a helper,
// and these are the two real page backgrounds an accent renders against.
const STOCK_LIGHT = "#F4F1E8";
const STOCK_DARK = "#14140F";

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Sources this catalogue is allowed to cite. A quote attributed to anything
 * else is either a fabrication or an uncited paraphrase, and this project's
 * rule is that every passage can be pointed at in a real text.
 */
const CITABLE = ["The Prince", "Discourses", "The Art of War", "Letter to"];

describe("machiavelli catalogue", () => {
  /**
   * The engine picks an id from Strava data; each catalogue answers for that id
   * in its own voice. If one catalogue lacks an id the other has, a real mood
   * silently falls back to the wrong voice, so this is the load-bearing check.
   */
  it("answers for exactly the same mood ids as the Ted Lasso catalogue", () => {
    expect(MACHIAVELLI_MOODS.map((m) => m.id).sort()).toEqual(MOODS.map((m) => m.id).sort());
  });

  it("resolves every id the other catalogue resolves", () => {
    for (const mood of MOODS) {
      expect(getMachiavelliMood(mood.id), mood.id).toBeDefined();
    }
  });

  it("has unique ids", () => {
    expect(new Set(MACHIAVELLI_MOODS.map((m) => m.id)).size).toBe(MACHIAVELLI_MOODS.length);
  });

  it("rejects an unknown id rather than falling back to something", () => {
    expect(getMachiavelliMood("not-a-mood")).toBeUndefined();
    expect(getMachiavelliMood("")).toBeUndefined();
  });

  it("gives every mood at least three quotes and one piece of media", () => {
    for (const m of MACHIAVELLI_MOODS) {
      expect(m.quotes.length, m.id).toBeGreaterThanOrEqual(3);
      expect(m.media.length, m.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("cites a real work and a locator for every quote", () => {
    for (const m of MACHIAVELLI_MOODS) {
      for (const q of m.quotes) {
        expect(q.text.trim().length).toBeGreaterThan(0);
        expect(CITABLE.some((work) => q.character.includes(work)), `${m.id}: ${q.character}`).toBe(true);
        // A work on its own is not a citation you can check; there has to be a
        // chapter, book, or date to look up.
        expect(q.character, `${m.id}: ${q.character}`).toMatch(/ch\.|book|[0-9]/i);
      }
    }
  });

  /**
   * Machiavelli is one of the most misquoted authors alive or dead. The most
   * famous line attributed to him is not in the text at all, and a catalogue
   * that shipped it would undermine every other entry.
   */
  it("contains none of the popular fabrications", () => {
    const all = MACHIAVELLI_MOODS.flatMap((m) => m.quotes.map((q) => q.text))
      .join(" ")
      .toLowerCase();
    for (const fake of [
      "ends justify the means",
      "end justifies the means",
      "it is better to be feared than loved", // the real passage is conditional
    ]) {
      expect(all, fake).not.toContain(fake);
    }
  });

  it("never uses forbidden record language", () => {
    const all = MACHIAVELLI_MOODS.flatMap((m) => m.quotes.map((q) => q.text)).join(" ").toLowerCase();
    expect(all).not.toContain("personal record");
  });

  it("uses a valid hex accent for every mood", () => {
    for (const m of MACHIAVELLI_MOODS) expect(m.accent, m.id).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("clears WCAG large-text contrast (3:1) against both newsprint backgrounds", () => {
    for (const m of MACHIAVELLI_MOODS) {
      expect(contrastRatio(m.accent, STOCK_LIGHT), `${m.id} on light`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(m.accent, STOCK_DARK), `${m.id} on dark`).toBeGreaterThanOrEqual(3);
    }
  });

  it("dates every mood and every media entry with an ISO day", () => {
    for (const m of MACHIAVELLI_MOODS) {
      expect(m.verifiedOn, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const g of m.media) expect(g.verifiedOn, `${m.id} media`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("declares a known kind, an https url, and real alt text for every media entry", () => {
    for (const m of MACHIAVELLI_MOODS) {
      for (const g of m.media) {
        expect(["gif", "image", "video"]).toContain(g.kind);
        expect(g.url.startsWith("https://"), `${m.id}: ${g.url}`).toBe(true);
        expect(g.alt.trim().split(/\s+/).length, `${m.id} alt`).toBeGreaterThanOrEqual(4);
        expect(g.source.trim().length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The point of a second voice is that it sounds different. If a name or a
   * passage were shared, the two pages would be the same page with extra steps.
   */
  it("shares no mood name or quote with the Ted Lasso catalogue", () => {
    const tedNames = new Set(MOODS.map((m) => m.name));
    const tedQuotes = new Set(MOODS.flatMap((m) => m.quotes.map((q) => q.text)));
    for (const m of MACHIAVELLI_MOODS) {
      expect(tedNames.has(m.name), m.name).toBe(false);
      for (const q of m.quotes) expect(tedQuotes.has(q.text), q.text.slice(0, 40)).toBe(false);
    }
  });

  it("keeps the two catalogues independent objects, so editing one cannot mutate the other", () => {
    for (const mood of MACHIAVELLI_MOODS) {
      expect(getMood(mood.id)).not.toBe(mood);
    }
  });
});
