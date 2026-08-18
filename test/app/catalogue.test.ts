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
    const gifs = MOODS.flatMap((m) => m.gifs);

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

  it("flags a gif whose verifiedOn has aged past the threshold", () => {
    // Every catalogue entry is fresh, so age the clock rather than fake the
    // data — this asserts the real catalogue against the real rule. Anchor on
    // the newest verifiedOn, not on NOW: entries verified after NOW would still
    // be inside the window if the offset were measured from the fixture clock.
    const newest = Math.max(
      ...MOODS.flatMap((m) => m.gifs).map((g) => Date.parse(g.verifiedOn)),
    );
    const later = newest + (TUNING.STALE_VERIFIED_DAYS + 1) * DAY_MS;
    const html = renderCatalogue(later);
    expect(html).toContain("stale-marker");
    expect(html).toContain(`${TUNING.STALE_VERIFIED_DAYS}+ days`);
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
