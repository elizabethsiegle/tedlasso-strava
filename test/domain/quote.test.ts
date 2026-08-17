import { describe, expect, it } from "vitest";
import type { Mood } from "../../src/data/moods";
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

// Six of the ten moods in the real catalogue now ship one or more GIFs (see
// src/data/moods.ts), so `pickQuote`'s gif-present branch is exercised by
// catalogue data too — the "works for every mood in the catalogue" test
// above already covers that. This synthetic fixture still earns its keep by
// pinning the branch's behaviour independently of whatever the catalogue
// happens to contain right now, so it does not silently stop testing
// anything if a future edit removes every GIF from every mood. Nothing here
// is invented into src/data/moods.ts — the fabricated URL lives only in this
// test file.
describe("pickQuote gif selection", () => {
  const syntheticGifs = [
    {
      url: "https://example.test/fixture-one.gif",
      alt: "Synthetic fixture gif used only to pin pickQuote's gif branch",
      source: "test fixture",
      verifiedOn: "2026-08-14",
    },
    {
      url: "https://example.test/fixture-two.gif",
      alt: "Second synthetic fixture gif for the same branch-logic test",
      source: "test fixture",
      verifiedOn: "2026-08-14",
    },
  ];

  const syntheticMood: Mood = {
    id: "fixture-mood",
    name: "Fixture Mood",
    accent: "#123456",
    verifiedOn: "2026-08-14",
    quotes: [{ text: "Fixture quote text.", character: "Fixture Character" }],
    gifs: syntheticGifs,
  };

  it("returns one of the mood's own gifs, deterministically, when gifs are present", () => {
    const first = pickQuote(syntheticMood, 777);
    const second = pickQuote(syntheticMood, 777);

    expect(first.gif).not.toBeNull();
    expect(syntheticMood.gifs).toContainEqual(first.gif);
    expect(second.gif).toEqual(first.gif);
  });

  it("returns a null gif for the complementary case: a mood with no gifs", () => {
    const noGifMood: Mood = { ...syntheticMood, gifs: [] };
    expect(pickQuote(noGifMood, 777).gif).toBeNull();
  });
});
