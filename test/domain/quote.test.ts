import { describe, expect, it } from "vitest";
import type { Mood } from "../../src/data/moods";
import { MOODS, getMood } from "../../src/data/moods";
import { fnv1a, pickQuote } from "../../src/domain/quote";

describe("fnv1a", () => {
  it("is deterministic", () => {
    expect(fnv1a("virtu")).toBe(fnv1a("virtu"));
  });

  it("differs for different inputs", () => {
    expect(fnv1a("virtu")).not.toBe(fnv1a("fortuna"));
  });

  it("returns a non-negative 32-bit integer", () => {
    for (const s of ["", "a", "1755200000000virtu"]) {
      const h = fnv1a(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe("pickQuote", () => {
  const mood = getMood("virtu")!;

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

  it("returns null media when a mood has none verified", () => {
    const empty = { ...mood, media: [] };
    expect(pickQuote(empty, 1).media).toBeNull();
  });

  it("works for every mood in the catalogue", () => {
    for (const m of MOODS) {
      const picked = pickQuote(m, 12_345);
      expect(m.quotes).toContainEqual(picked.quote);
    }
  });
});

// The real catalogue ships no media at all since the Machiavelli rebrand (see
// src/data/moods.ts), so this synthetic fixture is now the ONLY thing keeping
// `pickQuote`'s media-present branch covered — exactly the case the comment
// that used to sit here anticipated. Nothing below is invented into
// src/data/moods.ts; the fabricated URLs live only in this test file.
describe("pickQuote gif selection", () => {
  const syntheticGifs = [
    {
      kind: "gif" as const,
      url: "https://example.test/fixture-one.gif",
      alt: "Synthetic fixture gif used only to pin pickQuote's gif branch",
      source: "test fixture",
      verifiedOn: "2026-08-14",
    },
    {
      kind: "gif" as const,
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
    media: syntheticGifs,
  };

  it("returns one of the mood's own media, deterministically, when media are present", () => {
    const first = pickQuote(syntheticMood, 777);
    const second = pickQuote(syntheticMood, 777);

    expect(first.media).not.toBeNull();
    expect(syntheticMood.media).toContainEqual(first.media);
    expect(second.media).toEqual(first.media);
  });

  it("returns null media for the complementary case: a mood with none", () => {
    const noMediaMood: Mood = { ...syntheticMood, media: [] };
    expect(pickQuote(noMediaMood, 777).media).toBeNull();
  });
});
