import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/app/render";
import { EMPTY_HEALTH, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

const SNAPSHOT: Snapshot = {
  version: 1, refreshedAt: NOW,
  mood: { id: "virtu", name: "Virtù", accent: "#9A700B" },
  quote: { text: "Fortune is the arbiter of one half of our actions.", character: "Machiavelli, The Prince" },
  gif: null, scores: { consistency: 70, charge: 60 }, reasons: [],
  facts: {
    last: null, daysSinceLast: null, countLast7: 0,
    baselineWeekly: 0, streakDays: 0, totalActivities: 0,
  },
  route: null,
};

function view(showRefreshButton: boolean) {
  return { snapshot: SNAPSHOT, health: { ...EMPTY_HEALTH }, nowMs: NOW, showRefreshButton, previewNotice: null };
}

describe("refresh ui", () => {
  it("wraps the button in a form that posts, so it works without javascript", () => {
    const html = renderPage(view(true));
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/refresh');
  });

  it("carries the setup key through the form action", () => {
    const html = renderPage({ ...view(true), setupKey: "abc123" });
    expect(html).toContain("/api/refresh?key=abc123");
  });

  it("url-encodes a setup key that needs encoding", () => {
    const html = renderPage({ ...view(true), setupKey: "a b&c" });
    expect(html).toContain(`key=${encodeURIComponent("a b&c")}`);
    expect(html).not.toContain("key=a b&c");
  });

  it("includes the script only when the button is shown", () => {
    expect(renderPage(view(true))).toContain("<script>");
    expect(renderPage(view(false))).not.toContain("<script>");
  });

  it("holds the animation for the tuned minimum duration", () => {
    expect(renderPage(view(true))).toContain("1200");
  });

  it("ships no external script sources", () => {
    expect(renderPage(view(true))).not.toContain("<script src");
  });
});
