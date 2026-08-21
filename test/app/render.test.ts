import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage } from "../../src/app/render";
import { getMood } from "../../src/data/moods";
import { DAY_MS, TUNING } from "../../src/domain/tuning";
import { EMPTY_HEALTH, type Health, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    refreshedAt: NOW - 3_600_000,
    mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
    quote: { text: "Believe.", character: "AFC Richmond locker room" },
    gif: {
      url: "/media/believe/0",
      alt: "The Believe sign above the office door.",
      verifiedOn: "2026-08-14",
    },
    scores: { consistency: 72, charge: 64 },
    reasons: ["Your longest run in 90 days, and it was today"],
    facts: {
      last: {
        name: "Long Run", sportType: "Run", distanceM: 21_097,
        movingTimeS: 7200, elevationM: 180, startedAt: NOW - 7_200_000,
      },
      daysSinceLast: 0.08,
      countLast7: 4,
      baselineWeekly: 2.5,
      streakDays: 3,
      totalActivities: 34,
    },
    route: null,
    ...overrides,
  };
}

function view(overrides: Partial<Parameters<typeof renderPage>[0]> = {}) {
  return {
    snapshot: snapshot(),
    health: { ...EMPTY_HEALTH, lastSuccessAt: NOW - 3_600_000 } as Health,
    nowMs: NOW,
    showRefreshButton: false,
    previewNotice: null,
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("escapes the characters that break markup", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });
});

describe("renderPage", () => {
  it("emits a complete document", () => {
    const html = renderPage(view());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });

  it("shows the mood, quote, and character", () => {
    const html = renderPage(view());
    expect(html).toContain("Believe");
    expect(html).toContain("AFC Richmond locker room");
  });

  it("uses the mood accent as a css custom property", () => {
    expect(renderPage(view())).toContain("--ink-accent: #F2C14E");
  });

  it("shows the gif with its alt text", () => {
    const html = renderPage(view());
    expect(html).toContain("/media/believe/0");
    expect(html).toContain("The Believe sign above the office door.");
  });

  it("omits the image element entirely when there is no gif", () => {
    const html = renderPage(view({ snapshot: snapshot({ gif: null }) }));
    expect(html).not.toContain("<img");
  });

  it("collapses the hero to a single column when there is no gif", () => {
    const html = renderPage(view({ snapshot: snapshot({ gif: null }) }));
    // Match the <section> tag itself, not a bare substring — the inlined
    // stylesheet's own ".hero--with-gif" selector would otherwise make a
    // plain toContain() check on the whole document pass regardless of the
    // actual markup emitted.
    const heroTag = html.match(/<section class="([^"]*)">/);
    expect(heroTag?.[1]).toBe("hero");
    // No reserved second track: the gif column container is not emitted at all.
    expect(html).not.toContain(`<div class="hero-gif">`);
  });

  it("uses the two-column hero treatment when a gif exists", () => {
    const html = renderPage(view());
    const heroTag = html.match(/<section class="([^"]*)">/);
    expect(heroTag?.[1]).toBe("hero hero--with-gif");
    expect(html).toContain(`<div class="hero-gif">`);
  });

  it("shows the receipts", () => {
    const html = renderPage(view());
    expect(html).toContain("Long Run");
    expect(html).toContain("21.1");   // km, one decimal
    expect(html).toContain("2.5");    // the baseline
  });

  it("credits Strava with a link back", () => {
    const html = renderPage(view());
    expect(html).toContain("Powered by Strava");
    expect(html).toContain("https://www.strava.com");
  });

  it("escapes an activity name containing markup", () => {
    const s = snapshot();
    s.facts.last!.name = `<img src=x onerror="alert(1)">`;
    const html = renderPage(view({ snapshot: s }));
    // Escaping leaves the literal text `onerror=&quot;...&quot;` in the document,
    // which is inert. Assert the EXECUTABLE form is gone, not the substring.
    expect(html).not.toContain(`onerror="alert(1)"`);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("never uses record language", () => {
    expect(renderPage(view()).toLowerCase()).not.toContain("personal record");
  });

  it("renders the preseason state when there is no snapshot", () => {
    const html = renderPage(view({ snapshot: null }));
    expect(html).toContain(getMood("preseason")!.name);
    expect(html).toContain("hasn't run yet");
    expect(html).not.toContain("Loading");
  });

  it("shows a working reconnect link, with the key, when reauthorization is needed and a key is available", () => {
    const html = renderPage(
      view({
        health: { ...EMPTY_HEALTH, needsReauth: true, lastSuccessAt: NOW - 3_600_000 },
        setupKey: "s3cret",
      }),
    );
    expect(html).toContain("/auth/login?key=s3cret");
    expect(html).toContain("Reconnect");
  });

  it("does not offer a link that will 404 when reauthorization is needed but no key is available", () => {
    const html = renderPage(
      view({ health: { ...EMPTY_HEALTH, needsReauth: true, lastSuccessAt: NOW - 3_600_000 } }),
    );
    expect(html).not.toContain("/auth/login");
    expect(html).toContain("visit the setup URL");
  });

  it("URL-encodes the setup key in the reconnect link", () => {
    const html = renderPage(
      view({
        health: { ...EMPTY_HEALTH, needsReauth: true, lastSuccessAt: NOW - 3_600_000 },
        setupKey: "a b&c",
      }),
    );
    expect(html).toContain(`/auth/login?key=${encodeURIComponent("a b&c")}`);
  });

  it("tells a new owner to connect Strava for the first time, not that access has lapsed, on a never-connected site", () => {
    const html = renderPage(
      view({
        snapshot: null,
        health: { ...EMPTY_HEALTH, needsReauth: true, lastSuccessAt: null },
        setupKey: "s3cret",
      }),
    );
    expect(html.toLowerCase()).not.toContain("lapsed");
    expect(html.toLowerCase()).not.toContain("last one we recorded");
    expect(html).toContain("hasn't been connected yet");
    expect(html).toContain("/auth/login?key=s3cret");
  });

  it("keeps the genuine lapse copy when a snapshot or prior success exists", () => {
    const html = renderPage(
      view({
        health: { ...EMPTY_HEALTH, needsReauth: true, lastSuccessAt: NOW - 3_600_000 },
        setupKey: "s3cret",
      }),
    );
    expect(html).toContain("Strava access has lapsed");
    expect(html).toContain("the last one we recorded");
    expect(html.toLowerCase()).not.toContain("hasn't been connected yet");
  });

  it("does not also show the generic \"first fetch hasn't run\" notice alongside the never-connected copy", () => {
    const html = renderPage(
      view({
        snapshot: null,
        health: { ...EMPTY_HEALTH, needsReauth: true, lastSuccessAt: null },
        setupKey: "s3cret",
      }),
    );
    expect(html).not.toContain("The first fetch hasn't run yet");
  });

  it("shows a stale marker when the snapshot is older than the threshold", () => {
    const html = renderPage(view({ snapshot: snapshot({ refreshedAt: NOW - 20 * 3_600_000 }) }));
    expect(html).toContain("last updated");
  });

  it("does not show the stale marker for a fresh snapshot", () => {
    expect(renderPage(view())).not.toContain("last updated");
  });

  it("hides the refresh button by default", () => {
    expect(renderPage(view())).not.toContain("id=\"refresh\"");
  });

  it("shows the refresh button when asked", () => {
    expect(renderPage(view({ showRefreshButton: true }))).toContain("id=\"refresh\"");
  });

  it("shows a preview notice when previewing", () => {
    const html = renderPage(view({ previewNotice: "Preview — not your live mood" }));
    expect(html).toContain("Preview — not your live mood");
  });

  it("inlines the stylesheet rather than linking one", () => {
    const html = renderPage(view());
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link rel=\"stylesheet\"");
  });

  it("shows kind copy, not scolding, when there have been no activities in 90 days", () => {
    const s = snapshot({
      facts: {
        last: null,
        daysSinceLast: null,
        countLast7: 0,
        baselineWeekly: 0,
        streakDays: 0,
        totalActivities: 0,
      },
    });
    const html = renderPage(view({ snapshot: s }));
    expect(html.toLowerCase()).not.toContain("you failed");
    expect(html.toLowerCase()).not.toContain("you haven't");
    expect(html).toContain("Nothing yet");
  });

  it("still renders receipts and footer when route is null", () => {
    const html = renderPage(view({ snapshot: snapshot({ route: null }) }));
    expect(html).toContain("Powered by Strava");
    expect(html).toContain("Long Run");
  });

  /**
   * The "When" row is calendar wording, so it is driven by the activity's real
   * start time in the athlete's timezone, never by the elapsed-days number the
   * mood engine thresholds on.
   */
  function whenRow(startedAtIso: string, nowIso: string, tz = "America/Los_Angeles"): string {
    const startedAt = Date.parse(startedAtIso);
    const nowMs = Date.parse(nowIso);
    const base = snapshot();
    const html = renderPage(
      view({
        nowMs,
        tz,
        snapshot: snapshot({
          facts: { ...base.facts, last: { ...base.facts.last!, startedAt } },
        }),
      }),
    );
    return /<th scope="row">When<\/th><td>([^<]*)<\/td>/.exec(html)?.[1] ?? "";
  }

  it("says yesterday for an activity one calendar day back", () => {
    expect(whenRow("2026-08-13T18:00:00Z", "2026-08-14T19:00:00Z")).toBe("yesterday");
  });

  it("says N days ago for an activity further back", () => {
    expect(whenRow("2026-08-10T18:00:00Z", "2026-08-14T19:00:00Z")).toBe("4 days ago");
  });

  it("says today for an activity earlier the same local day", () => {
    // 02:00 PDT and 18:00 PDT on 2026-08-14: sixteen hours apart, one day.
    expect(whenRow("2026-08-14T09:00:00Z", "2026-08-15T01:00:00Z")).toBe("today");
  });

  /**
   * The bug this replaces: a 21:44 PDT ride is 04:44 UTC the NEXT day, so it
   * read as "today" all the following morning. Elapsed time says 0.57 days and
   * a UTC calendar says the same date, and both are wrong for the athlete
   * looking at the page over breakfast.
   */
  it("calls last night's ride yesterday once the local day has rolled over", () => {
    expect(whenRow("2026-08-20T04:44:00Z", "2026-08-20T18:32:00Z")).toBe("yesterday");
  });

  it("still says today for a ride a few hours ago that has not crossed midnight", () => {
    // 08:00 PDT, read at 14:00 PDT the same day: further apart in hours than
    // the night ride above, yet correctly still today.
    expect(whenRow("2026-08-20T15:00:00Z", "2026-08-20T21:00:00Z")).toBe("today");
  });

  it("counts the athlete's midnight, not UTC's", () => {
    // 23:30 PDT on the 19th, read at 00:30 PDT on the 20th: one hour apart and
    // one calendar day. In UTC both instants fall on the 20th.
    expect(whenRow("2026-08-20T06:30:00Z", "2026-08-20T07:30:00Z")).toBe("yesterday");
    // The same two instants in UTC are the same day, which is what a
    // timezone-blind implementation would report.
    expect(whenRow("2026-08-20T06:30:00Z", "2026-08-20T07:30:00Z", "UTC")).toBe("today");
  });

  it("shows an em dash when there is no last activity to date", () => {
    const html = renderPage(
      view({ snapshot: snapshot({ facts: { ...snapshot().facts, last: null, daysSinceLast: null } }) }),
    );
    expect(html).toContain(`<th scope="row">When</th><td>\u2014</td>`);
  });

  it("formats a duration under an hour as minutes only", () => {
    const s = snapshot();
    s.facts.last!.movingTimeS = 35 * 60;
    const html = renderPage(view({ snapshot: s }));
    expect(html).toContain("35m");
  });

  describe("results table", () => {
    const withRows = snapshot({
      facts: {
        ...snapshot().facts,
        recent: [
          { id: 111, sportType: "Ride", distanceM: 24_100, movingTimeS: 3734, day: "2026-08-13" },
          { id: 222, sportType: "Run", distanceM: 8_000, movingTimeS: 2499, day: "2026-08-12" },
        ],
      },
    });

    it("renders a row per activity, linking each to Strava", () => {
      const html = renderPage(view({ snapshot: withRows }));
      expect(html).toContain('class="results"');
      expect(html).toContain("https://www.strava.com/activities/111");
      expect(html).toContain("https://www.strava.com/activities/222");
      expect(html).toContain("Results — last 2");
    });

    it("formats the local day and the distance as the sheet sets numbers", () => {
      const html = renderPage(view({ snapshot: withRows }));
      expect(html).toContain("Thu 13 Aug");
      expect(html).toContain("24.1 km");
    });

    it("gives every link an accessible name rather than a bare arrow", () => {
      const html = renderPage(view({ snapshot: withRows }));
      expect(html).toContain('aria-label="View this Ride on Strava"');
    });

    it("draws a trace for a row with a glyph and a dash for one without", () => {
      const mixed = snapshot({
        facts: {
          ...snapshot().facts,
          recent: [
            {
              id: 1, sportType: "Ride", distanceM: 1000, movingTimeS: 600, day: "2026-08-13",
              glyph: { pathD: "M0 0 L10 10", viewBox: "0 0 1000 1000" },
            },
            { id: 2, sportType: "Workout", distanceM: 0, movingTimeS: 1800, day: "2026-08-12" },
          ],
        },
      });
      const html = renderPage(view({ snapshot: mixed }));
      expect(html).toContain('class="results-trace"');
      expect(html).toContain("M0 0 L10 10");
      expect(html).toContain('class="results-indoor"');
    });

    it("marks the trace as presentational so it is not announced twice", () => {
      const withGlyph = snapshot({
        facts: {
          ...snapshot().facts,
          recent: [{
            id: 1, sportType: "Ride", distanceM: 1000, movingTimeS: 600, day: "2026-08-13",
            glyph: { pathD: "M0 0 L10 10", viewBox: "0 0 1000 1000" },
          }],
        },
      });
      expect(renderPage(view({ snapshot: withGlyph }))).toContain('role="presentation"');
    });

    it("omits the section for a snapshot written before the table existed", () => {
      // Live KV still holds these until the next refresh overwrites them.
      const legacy = snapshot();
      delete (legacy.facts as { recent?: unknown }).recent;
      const html = renderPage(view({ snapshot: legacy }));
      expect(html).not.toContain('class="results"');
      expect(html).toContain("Powered by Strava");
    });
  });

  describe("media kinds", () => {
    it("refuses to auto-load media from another origin", () => {
      // A snapshot written before the media proxy existed carries an upstream
      // URL. Rendering it would put the image host in every visitor's read
      // path, so the picture is dropped until the next refresh instead.
      const s = snapshot({
        gif: { url: "https://upload.wikimedia.org/x.jpg", alt: "An off-origin still.", verifiedOn: "2026-08-14", kind: "image" },
      });
      const html = renderPage(view({ snapshot: s }));
      expect(html).not.toContain("upload.wikimedia.org");
      expect(html).not.toContain('<img class="gif"');
      // And the second hero column must not open up around nothing. Matched on
      // the markup, not the bare class name: STYLES is inlined into the page,
      // so the selector is always present in the stylesheet.
      expect(html).not.toContain('class="hero hero--with-gif"');
    });

    it("still offers an off-origin video as a link, because following it is a choice", () => {
      const s = snapshot({
        gif: { url: "https://example.test/clip.mp4", alt: "A clip.", verifiedOn: "2026-08-14", kind: "video" },
      });
      const html = renderPage(view({ snapshot: s }));
      expect(html).toContain('class="hero-video" href="https://example.test/clip.mp4"');
      expect(html).toContain('class="hero hero--with-gif"');
    });

    it("renders a still image inline, exactly as it renders a gif", () => {
      const still = snapshot({
        gif: { url: "/media/believe/0", alt: "An engraved portrait still.", verifiedOn: "2026-08-14", kind: "image" },
      });
      const html = renderPage(view({ snapshot: still }));
      expect(html).toContain('<img class="gif" src="/media/believe/0"');
      // Substring, not class match: the inlined stylesheet defines .hero-video
      // regardless of what is rendered, so assert on the attribute.
      expect(html).not.toContain('class="hero-video"');
    });

    it("offers a video as a link and never as an embedded player", () => {
      const clip = snapshot({
        gif: { url: "https://www.youtube.com/watch?v=abc123", alt: "Ted explains the offside rule.", verifiedOn: "2026-08-14", kind: "video" },
      });
      const html = renderPage(view({ snapshot: clip }));
      expect(html).toContain('class="hero-video"');
      expect(html).toContain("https://www.youtube.com/watch?v=abc123");
      expect(html).toContain("Ted explains the offside rule.");
      // The whole point of the link treatment: no third party in the read path.
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("<video");
      expect(html).not.toContain('<img class="gif"');
    });

    it("treats a snapshot with no kind as a gif, not as a broken entry", () => {
      const legacy = snapshot({
        gif: { url: "/media/believe/0", alt: "A gif stored before kinds existed.", verifiedOn: "2026-08-14" },
      });
      const html = renderPage(view({ snapshot: legacy }));
      expect(html).toContain('<img class="gif" src="/media/believe/0"');
      expect(html).not.toContain('class="hero-video"');
    });
  });

  describe("colophon", () => {
    it("pins the Entire credit line on every page, snapshot or not", () => {
      for (const html of [renderPage(view()), renderPage(view({ snapshot: null }))]) {
        expect(html).toContain('class="colophon"');
        expect(html).toContain("made w/ &lt;3 in sf");
        expect(html).toContain("https://entire.io/gh/elizabethsiegle/tedlasso-strava");
      }
    });

    it("escapes the angle brackets in the credit copy rather than emitting markup", () => {
      const html = renderPage(view());
      expect(html).not.toContain("made w/ <3");
      expect(html).toContain("=&gt;");
    });
  });

  describe("footer", () => {
    it("shows the refresh timestamp and the next scheduled cron run", () => {
      const html = renderPage(view());
      // NOW is 2026-08-14T19:00:00Z; the snapshot was refreshed an hour
      // earlier (18:00), and the next 4-hourly boundary after 19:00 is 20:00.
      expect(html).toContain("Refreshed 2026-08-14 18:00 UTC");
      expect(html).toContain("Next run 2026-08-14 20:00 UTC");
    });

    it("shows the next scheduled run even before the first snapshot exists", () => {
      const html = renderPage(view({ snapshot: null }));
      expect(html).toContain("Next run 2026-08-14 20:00 UTC");
      expect(html).toContain("Not yet refreshed");
    });

    it("shows no staleness marker for a freshly verified GIF", () => {
      const html = renderPage(view());
      expect(html).not.toContain("stale-marker");
      expect(html).not.toContain("unverified");
    });

    it("shows a staleness marker for a GIF verified 200 days ago", () => {
      const verifiedOn = new Date(NOW - 200 * DAY_MS).toISOString().slice(0, 10);
      const s = snapshot({ gif: { url: "/media/believe/0", alt: "An old GIF.", verifiedOn } });
      const html = renderPage(view({ snapshot: s }));
      expect(html).toContain("stale-marker");
      expect(html).toContain(`${TUNING.STALE_VERIFIED_DAYS}+`);
    });

    it("does not show a staleness marker at exactly the threshold", () => {
      // Full ISO (with time-of-day), not a date-only string, so the diff
      // against NOW is exactly STALE_VERIFIED_DAYS*DAY_MS -- a date-only
      // string would truncate to midnight and drift past the boundary.
      const verifiedOn = new Date(NOW - TUNING.STALE_VERIFIED_DAYS * DAY_MS).toISOString();
      const s = snapshot({ gif: { url: "/media/believe/0", alt: "An edge-case GIF.", verifiedOn } });
      const html = renderPage(view({ snapshot: s }));
      expect(html).not.toContain("stale-marker");
    });

    it("does not blow up when there is no gif at all", () => {
      const html = renderPage(view({ snapshot: snapshot({ gif: null }) }));
      expect(html).not.toContain("stale-marker");
    });

    it("treats an unparseable verifiedOn as not-stale rather than throwing", () => {
      const s = snapshot({ gif: { url: "/media/believe/0", alt: "A GIF.", verifiedOn: "not-a-date" } });
      expect(() => renderPage(view({ snapshot: s }))).not.toThrow();
      expect(renderPage(view({ snapshot: s }))).not.toContain("stale-marker");
    });
  });
});
