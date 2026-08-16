import { describe, expect, it } from "vitest";
import { MOODS, getMood } from "../../src/data/moods";
import { fnv1a, pickQuote } from "../../src/domain/quote";

describe("fnv1a", () => {
  it("is deterministic", () => {
    expect(fnv1a("believe")).toBe(fnv1a("believe"));
  });

  it("differs for different inputs", () => {
    expect(fnv1a("believe")).not.toBe(fnv1a("biscuits"));
  });

  it("returns a non-negative 32-bit integer", () => {
    for (const s of ["", "a", "1755200000000believe"]) {
      const h = fnv1a(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe("pickQuote", () => {
  const mood = getMood("believe")!;

  it("returns the same quote for the same seed", () => {
    expect(pickQuote(mood, 1_755_200_000_000).quote).toEqual(
      pickQuote(mood, 1_755_200_000_000).quote,
    );
  });

  it("returns a quote that belongs to the mood", () => {
    expect(mood.quotes).toContainEqual(pickQuote(mood, 42).quote);
  });

  it("varies across seeds, so a manual refresh visibly changes the page", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickQuote(mood, 1_755_200_000_000 + i * 1000).quote.text);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns a null gif when a mood has none verified", () => {
    const empty = { ...mood, gifs: [] };
    expect(pickQuote(empty, 1).gif).toBeNull();
  });

  it("works for every mood in the catalogue", () => {
    for (const m of MOODS) {
      const picked = pickQuote(m, 12_345);
      expect(m.quotes).toContainEqual(picked.quote);
    }
  });
});
