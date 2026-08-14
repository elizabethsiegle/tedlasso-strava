import { describe, expect, it } from "vitest";
import { deriveFacts } from "../../src/domain/facts";
import { makeActivity } from "../fixtures/activities";

const LA = "America/Los_Angeles";
const NOW = Date.parse("2026-08-14T19:00:00Z");
const D = 86_400_000;

/** n same-sport filler activities, each `movingTimeS` seconds, starting 3 days back. */
function filler(n: number, movingTimeS: number, sportType = "Run", extra: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) =>
    makeActivity({ sportType, movingTimeS, startedAt: NOW - (i + 3) * D, ...extra }),
  );
}

describe("relEffortLast", () => {
  it("is neutral with too few samples", () => {
    const acts = [makeActivity({ startedAt: NOW - D, movingTimeS: 9000 }), ...filler(2, 600)];
    expect(deriveFacts(acts, NOW, LA).relEffortLast).toBe(0.5);
  });

  it("is 1 when the last activity is the hardest of many", () => {
    const acts = [makeActivity({ startedAt: NOW - D, movingTimeS: 9000 }), ...filler(6, 600)];
    expect(deriveFacts(acts, NOW, LA).relEffortLast).toBe(1);
  });

  it("is 0 when the last activity is the easiest of many", () => {
    const acts = [makeActivity({ startedAt: NOW - D, movingTimeS: 60 }), ...filler(6, 600)];
    expect(deriveFacts(acts, NOW, LA).relEffortLast).toBe(0);
  });

  it("prefers sufferScore over duration when present", () => {
    const acts = [
      makeActivity({ startedAt: NOW - D, movingTimeS: 60, sufferScore: 300 }),
      ...filler(6, 9000).map((a) => ({ ...a, sufferScore: 10 })),
    ];
    expect(deriveFacts(acts, NOW, LA).relEffortLast).toBe(1);
  });

  it("compares against the same sport, not all sports", () => {
    // Six easy rides must not make a moderate run look hard.
    const acts = [
      makeActivity({ startedAt: NOW - D, sportType: "Run", movingTimeS: 1800 }),
      ...filler(6, 600, "Run"),
      ...filler(6, 20_000, "Ride"),
    ];
    expect(deriveFacts(acts, NOW, LA).relEffortLast).toBe(1);
  });

  it("falls back to all sports when same-sport samples are too few", () => {
    const acts = [
      makeActivity({ startedAt: NOW - D, sportType: "Swim", movingTimeS: 9000 }),
      ...filler(6, 600, "Run"),
    ];
    expect(deriveFacts(acts, NOW, LA).relEffortLast).toBe(1);
  });
});

describe("isLongest90", () => {
  it("is false for a first-ever activity", () => {
    const f = deriveFacts([makeActivity({ startedAt: NOW - D, distanceM: 99_000 })], NOW, LA);
    expect(f.isLongest90).toBe(false);
  });

  it("is false with fewer than three prior same-sport samples", () => {
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 99_000 }),
      ...filler(2, 600).map((a) => ({ ...a, distanceM: 5000 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isLongest90).toBe(false);
  });

  it("is true when the last activity is the longest of enough samples", () => {
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 42_195 }),
      ...filler(4, 600).map((a) => ({ ...a, distanceM: 5000 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isLongest90).toBe(true);
  });

  it("is false on a tie, since it is not strictly greater", () => {
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 5000 }),
      ...filler(4, 600).map((a) => ({ ...a, distanceM: 5000 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isLongest90).toBe(false);
  });
});

describe("isFastest90", () => {
  it("ignores shorter activities via the distance guard", () => {
    // A fast 1k sprint must not beat 10k runs it was never compared against.
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 1000, averageSpeed: 6.5 }),
      ...filler(4, 600).map((a) => ({ ...a, distanceM: 10_000, averageSpeed: 3.0 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isFastest90).toBe(false);
  });

  it("is true when fastest among comparable distances", () => {
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 10_000, averageSpeed: 4.0 }),
      ...filler(4, 600).map((a) => ({ ...a, distanceM: 10_000, averageSpeed: 3.0 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isFastest90).toBe(true);
  });

  it("ignores far longer activities too — the band is symmetric", () => {
    // A 10k at a good pace must not be judged against 100k ultras it cannot
    // be compared to. Only same-distance efforts count, in both directions.
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 10_000, averageSpeed: 4.0 }),
      ...filler(4, 600).map((a) => ({ ...a, distanceM: 100_000, averageSpeed: 2.0 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isFastest90).toBe(false);
  });

  it("counts activities at the band edges", () => {
    // 0.8x and 1.25x of 10,000 are both inside the band.
    const acts = [
      makeActivity({ startedAt: NOW - D, distanceM: 10_000, averageSpeed: 4.0 }),
      ...filler(3, 600).map((a) => ({ ...a, distanceM: 8_000, averageSpeed: 3.0 })),
      ...filler(1, 600).map((a) => ({ ...a, distanceM: 12_500, averageSpeed: 3.0 })),
    ];
    expect(deriveFacts(acts, NOW, LA).isFastest90).toBe(true);
  });
});
