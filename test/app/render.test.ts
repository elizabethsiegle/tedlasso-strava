import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage } from "../../src/app/render";
import { EMPTY_HEALTH, type Health, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    refreshedAt: NOW - 3_600_000,
    mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
    quote: { text: "Believe.", character: "AFC Richmond locker room" },
    gif: { url: "https://example.test/believe.gif", alt: "The Believe sign above the office door." },
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
    expect(html).toContain("https://example.test/believe.gif");
    expect(html).toContain("The Believe sign above the office door.");
  });

  it("omits the image element entirely when there is no gif", () => {
    const html = renderPage(view({ snapshot: snapshot({ gif: null }) }));
    expect(html).not.toContain("<img");
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
    expect(html).toContain("Preseason");
    expect(html).toContain("hasn't run yet");
    expect(html).not.toContain("Loading");
  });

  it("shows a reconnect link when reauthorization is needed", () => {
    const html = renderPage(view({ health: { ...EMPTY_HEALTH, needsReauth: true } }));
    expect(html).toContain("/auth/login");
    expect(html).toContain("Reconnect");
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

  it("says yesterday for an activity one day back", () => {
    const html = renderPage(
      view({ snapshot: snapshot({ facts: { ...snapshot().facts, daysSinceLast: 1.2 } }) }),
    );
    expect(html).toContain("yesterday");
  });

  it("says N days ago for an activity further back", () => {
    const html = renderPage(
      view({ snapshot: snapshot({ facts: { ...snapshot().facts, daysSinceLast: 4.7 } }) }),
    );
    expect(html).toContain("4 days ago");
  });

  it("formats a duration under an hour as minutes only", () => {
    const s = snapshot();
    s.facts.last!.movingTimeS = 35 * 60;
    const html = renderPage(view({ snapshot: s }));
    expect(html).toContain("35m");
  });
});
