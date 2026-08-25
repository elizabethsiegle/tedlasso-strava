import { describe, expect, it } from "vitest";
import { renderCatalogue } from "../../src/app/catalogue";
import { MOODS } from "../../src/data/moods";
import { DAY_MS, TUNING } from "../../src/domain/tuning";

const NOW = Date.parse("2026-08-14T19:00:00Z");

describe("renderCatalogue", () => {
  it("emits a complete document", () => {
    const html = renderCatalogue(NOW);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("lists every mood in the catalogue", () => {
    const html = renderCatalogue(NOW);
    for (const mood of MOODS) {
      // Names are escaped on the way out ("Where'd You Go" -> "Where&#39;d ...").
      expect(html).toContain(mood.name.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
      expect(html).toContain(`/?preview=${encodeURIComponent(mood.id)}`);
    }
  });

  it("prints every quote and every gif, not a sample", () => {
    const html = renderCatalogue(NOW);
    const quotes = MOODS.flatMap((m) => m.quotes);
    const gifs = MOODS.flatMap((m) => m.media);

    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      // The renderer escapes, so compare against the escaped form.
      expect(html).toContain(q.text.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
    }
    for (const g of gifs) {
      expect(html).toContain(g.url);
    }
  });

  it("shows each mood's verifiedOn date", () => {
    const html = renderCatalogue(NOW);
    for (const mood of MOODS) {
      expect(html).toContain(mood.verifiedOn);
    }
  });

  // This used to age the clock past the newest catalogue entry and assert the
  // marker appeared. The catalogue has carried no media since the Machiavelli
  // rebrand, so there is no entry left to age and no marker to raise at any
  // clock — asserting one would only be asserting fabricated data. The rule
  // itself (isGifStale) and the marker markup are pinned against synthetic
  // snapshots in test/app/render.test.ts; what is worth pinning HERE is that
  // an all-text catalogue never cries stale, however far the clock runs.
  it("raises no staleness marker for a catalogue that carries no media, at any clock", () => {
    expect(MOODS.flatMap((m) => m.media)).toEqual([]);
    const farFuture = NOW + (TUNING.STALE_VERIFIED_DAYS + 1) * DAY_MS * 10;
    expect(renderCatalogue(farFuture)).not.toContain("stale-marker");
  });

  it("shows no staleness markers while every entry is freshly verified", () => {
    expect(renderCatalogue(NOW)).not.toContain("stale-marker");
  });

  it("links back to the report and credits Strava", () => {
    const html = renderCatalogue(NOW);
    expect(html).toContain('href="/"');
    expect(html).toContain("Powered by Strava");
  });

  it("needs no snapshot — it renders from bundled data alone", () => {
    // Guards the property that makes /catalogue safe to serve before the first
    // refresh: nothing here reads KV or Strava.
    expect(() => renderCatalogue(0)).not.toThrow();
  });
});
