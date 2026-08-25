import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage } from "../../src/app/render";
import worker from "../../src/worker";
import { MOODS } from "../../src/data/moods";
import { EMPTY_HEALTH, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

function snapshot(route: Snapshot["route"]): Snapshot {
  return {
    version: 1, refreshedAt: NOW,
    mood: { id: "virtu", name: "Virtù", accent: "#9A700B" },
    quote: { text: "Fortune is the arbiter of one half of our actions.", character: "Machiavelli, The Prince" },
    gif: null, scores: { consistency: 70, charge: 60 }, reasons: [],
    facts: {
      last: {
        name: "Ride", sportType: "Ride", distanceM: 24_300,
        movingTimeS: 3600, elevationM: 210, startedAt: NOW - 3_600_000,
      },
      daysSinceLast: 0.04, countLast7: 3, baselineWeekly: 2, streakDays: 1, totalActivities: 20,
    },
    route,
  };
}

function view(s: Snapshot) {
  return { snapshot: s, health: { ...EMPTY_HEALTH }, nowMs: NOW, showRefreshButton: false, previewNotice: null };
}

const ROUTE = {
  pathD: "M40 960 L500 500 L960 40",
  viewBox: "0 0 1000 1000",
  distanceM: 24_300,
  elevationM: 210,
  sportType: "Ride",
  locationLabel: "San Francisco, CA",
};

describe("route rendering", () => {
  it("emits an inline svg with the path", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain("<svg");
    expect(html).toContain("M40 960 L500 500 L960 40");
    expect(html).toContain('viewBox="0 0 1000 1000"');
  });

  it("strokes the route rather than filling it", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain('fill="none"');
    expect(html).toContain("stroke=");
  });

  it("captions the route with distance, elevation, and sport", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).toContain("24.3");
    expect(html).toContain("210");
    expect(html).toContain("Ride");
  });

  it("includes the location label when present", () => {
    expect(renderPage(view(snapshot(ROUTE)))).toContain("San Francisco, CA");
  });

  it("omits the location line when absent, without leaving an empty element", () => {
    const html = renderPage(view(snapshot({ ...ROUTE, locationLabel: null })));
    expect(html).not.toContain("route-place");
  });

  it("loads no external map resources", () => {
    const html = renderPage(view(snapshot(ROUTE)));
    expect(html).not.toContain("mapbox");
    expect(html).not.toContain("tile");
    expect(html).not.toContain("openstreetmap");
  });

  it("renders a designed fallback for an indoor activity", () => {
    const html = renderPage(view(snapshot(null)));
    expect(html).not.toContain("<svg");
    expect(html).toContain("No route");
    expect(html).toContain("Ride"); // the sport still gets named
  });

  it("escapes a malicious location label", () => {
    const html = renderPage(view(snapshot({ ...ROUTE, locationLabel: '"><script>x</script>' })));
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("preview route", () => {
  function testEnv() {
    return {
      ...(env as object),
      TIMEZONE: "UTC", PRIVACY_TRIM_M: "250",
      REDIRECT_URI: "https://x/auth/callback",
      STRAVA_CLIENT_ID: "cid", STRAVA_CLIENT_SECRET: "sec",
      STRAVA_ATHLETE_ID: "1", SETUP_KEY: "s3cret",
    } as never;
  }
  const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {} }) as unknown as ExecutionContext;

  it("renders the requested mood with a visible notice", async () => {
    const res = await worker.fetch(new Request("https://x/?preview=the-lion"), testEnv(), ctx());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("The Lion");
    expect(html.toLowerCase()).toContain("preview");
  });

  it("ignores an unknown mood id rather than erroring", async () => {
    const res = await worker.fetch(new Request("https://x/?preview=not-a-mood"), testEnv(), ctx());
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).not.toContain("not-a-mood");
  });
});

// Spec §8 requires render coverage of all ten moods, not just the one the
// engine happens to select today.
describe("every mood renders", () => {
  for (const mood of MOODS) {
    it(`renders ${mood.id} with its name, accent, and a quote`, () => {
      const s = snapshot(ROUTE);
      s.mood = { id: mood.id, name: mood.name, accent: mood.accent };
      s.quote = mood.quotes[0]!;
      const html = renderPage(view(s));

      // The raw markup legitimately escapes apostrophes (e.g. "Where'd You
      // Go" is emitted as "Where&#39;d You Go") — a browser renders that
      // identically to the un-escaped form, so asserting a literal substring
      // of the catalogue name against pre-parse markup is the wrong check.
      // Assert against what the renderer actually emits instead; this still
      // fails if a mood's name were rendered wrongly or omitted.
      expect(html).toContain(escapeHtml(mood.name));
      expect(html).toContain(`--ink-accent: ${mood.accent}`);
      expect(html).toContain(mood.quotes[0]!.character);
      expect(html).toContain("Powered by Strava");
      expect(html.toLowerCase()).not.toContain("undefined");
      expect(html.toLowerCase()).not.toContain("[object object]");
    });
  }

  it("renders every failure state without leaking undefined into the markup", () => {
    const states = [
      view(snapshot(ROUTE)),
      { ...view(snapshot(ROUTE)), snapshot: null },
      { ...view(snapshot(ROUTE)), health: { ...EMPTY_HEALTH, needsReauth: true } },
      { ...view(snapshot(ROUTE)), snapshot: snapshot(null) },
      { ...view(snapshot(ROUTE)), previewNotice: "Preview — not your live mood." },
      { ...view(snapshot(ROUTE)), nowMs: NOW + 30 * 3_600_000 },
    ];
    for (const state of states) {
      const html = renderPage(state);
      expect(html.toLowerCase()).not.toContain("undefined");
      expect(html).toContain("</html>");
    }
  });
});
