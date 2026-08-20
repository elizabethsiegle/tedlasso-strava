import { describe, expect, it } from "vitest";
import { renderPage, renderWorkload } from "../../src/app/render";
import { DAY_MS } from "../../src/domain/tuning";
import type { Workload, WorkloadWeek } from "../../src/domain/workload";
import { EMPTY_HEALTH, type Snapshot } from "../../src/types";

const TZ = "UTC";
const NOW = Date.parse("2026-08-20T19:00:00Z");
const WEEK0 = Date.parse("2026-05-29T00:00:00Z");
const HOUR = 3600;

function week(index: number, count: number, hours: number, km = 0): WorkloadWeek {
  return {
    startMs: WEEK0 + index * 7 * DAY_MS,
    count,
    movingTimeS: hours * HOUR,
    distanceM: km * 1000,
  };
}

/** Twelve weeks that peak in the middle, rest once, and taper to this week. */
const HOURS = [2, 3, 4, 5, 6.5, 4, 0, 1.5, 3, 4.5, 3.5, 2];

function workload(overrides: Partial<Workload> = {}): Workload {
  const weeks = HOURS.map((h, i) => week(i, h === 0 ? 0 : 3, h, h * 10));
  return { weeks, medianMovingTimeS: 3.5 * HOUR, ...overrides };
}

function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

describe("renderWorkload", () => {
  it("draws nothing when there is no workload on the snapshot", () => {
    expect(renderWorkload(null, TZ)).toBe("");
    expect(renderWorkload(undefined, TZ)).toBe("");
  });

  it("draws nothing for an empty week list", () => {
    expect(renderWorkload({ weeks: [], medianMovingTimeS: 0 }, TZ)).toBe("");
  });

  it("draws nothing when every charted week is empty", () => {
    // Twelve zero-height columns say less than the notice already up the page.
    const flat = { weeks: HOURS.map((_, i) => week(i, 0, 0)), medianMovingTimeS: 0 };
    expect(renderWorkload(flat, TZ)).toBe("");
  });

  it("draws one column per week", () => {
    const html = renderWorkload(workload(), TZ);
    expect(count(html, /class="form-bar"/g)).toBe(HOURS.length);
  });

  it("scales the columns against the peak week", () => {
    const html = renderWorkload(workload(), TZ);
    // 6.5h is the tallest, so it fills the plot: top of the frame, full height.
    expect(html).toContain('y="28" width="56" height="168"');
  });

  it("prints a rest week as a stub on the rule, not as a missing column", () => {
    const html = renderWorkload(workload(), TZ);
    expect(html).toContain('height="3" fill="var(--rule)"');
  });

  it("rules the median week across the plot and names it", () => {
    const html = renderWorkload(workload(), TZ);
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("usual 3.5 h");
  });

  it("keeps the median label clear of this week's value", () => {
    const html = renderWorkload(workload(), TZ);
    // It used to be right-anchored at the frame edge, where it printed straight
    // through the value label sitting above the newest column.
    expect(html).toContain('class="form-usual" x="5"');
    expect(html).not.toContain(`x="${1000 - 4}"`);
    // The rule paints behind the columns and the label in front of them, so a
    // tall week neither gets sliced by the rule nor covers its name.
    expect(html.indexOf("stroke-dasharray")).toBeLessThan(html.indexOf('class="form-bar"'));
    expect(html.lastIndexOf('class="form-bar"')).toBeLessThan(html.indexOf('class="form-usual"'));
  });

  it("omits the median rule when the median is zero", () => {
    const html = renderWorkload(workload({ medianMovingTimeS: 0 }), TZ);
    expect(html).not.toContain("stroke-dasharray");
    // The rule's own label, not the word: "usual" also appears in the summary.
    expect(html).not.toContain("form-usual");
  });

  it("labels this week's total and ticks every third week", () => {
    const html = renderWorkload(workload(), TZ);
    expect(html).toContain("this week");
    expect(html).toContain("2.0 h");
    expect(html).toContain("29 May");
    expect(html).toContain("19 Jun");
    // Every third, then the newest: not a tick under all twelve.
    expect(count(html, /class="form-tick/g)).toBe(5);
  });

  it("gives every column a hover title carrying the week's real numbers", () => {
    const html = renderWorkload(workload(), TZ);
    expect(count(html, /<title>/g)).toBe(HOURS.length);
    expect(html).toContain("29 May to 4 Jun · 3 sessions · 2.0 h · 20.0 km");
  });

  it("says 'session' for a single session", () => {
    const one = { weeks: [week(0, 1, 1, 5)], medianMovingTimeS: HOUR };
    expect(renderWorkload(one, TZ)).toContain("1 session ·");
  });

  it("repeats the numbers as a table for anyone who cannot use the picture", () => {
    const html = renderWorkload(workload(), TZ);
    expect(html).toContain('class="visually-hidden"');
    expect(count(html, /<tr><th scope="row">/g)).toBe(HOURS.length);
  });

  it("summarises the figure in its accessible name", () => {
    const html = renderWorkload(workload(), TZ);
    expect(html).toContain("Peak 6.5 hours, usual 3.5 hours, 33 sessions in total.");
  });

  it("survives a hand-edited snapshot without printing NaN into a coordinate", () => {
    // The snapshot is JSON out of KV, which is the trust boundary.
    const hostile = {
      weeks: [
        null,
        { startMs: "yesterday", count: -3, movingTimeS: Number.NaN, distanceM: Infinity },
        { startMs: WEEK0, count: 2, movingTimeS: 2 * HOUR, distanceM: 8000 },
      ],
      medianMovingTimeS: Number.NaN,
    } as unknown as Workload;

    const html = renderWorkload(hostile, TZ);
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    // The NaN median cannot draw a rule, and a negative count reads as zero.
    expect(html).not.toContain("stroke-dasharray");
    expect(html).toContain("0 sessions ·");
  });

  it("lays out from the stored week count, not the current tuning", () => {
    // A snapshot written under a different WORKLOAD_WEEKS still has to fit the frame.
    const six = { weeks: HOURS.slice(0, 6).map((h, i) => week(i, 2, h)), medianMovingTimeS: 3 * HOUR };
    const html = renderWorkload(six, TZ);
    expect(count(html, /class="form-bar"/g)).toBe(6);
    expect(html).not.toContain("NaN");
  });
});

describe("the form guide on the page", () => {
  function snapshot(workloadValue: Snapshot["workload"]): Snapshot {
    return {
      version: 1,
      refreshedAt: NOW,
      mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
      quote: { text: "Believe.", character: "AFC Richmond locker room" },
      gif: null,
      scores: { consistency: 70, charge: 60 },
      reasons: [],
      facts: {
        last: {
          name: "Long Run", sportType: "Run", distanceM: 21_097,
          movingTimeS: 7200, elevationM: 180, startedAt: NOW - 7_200_000,
        },
        daysSinceLast: 0.08, countLast7: 3, baselineWeekly: 2, streakDays: 1, totalActivities: 33,
      },
      route: null,
      workload: workloadValue,
    };
  }

  function view(s: Snapshot) {
    return {
      snapshot: s, health: { ...EMPTY_HEALTH }, nowMs: NOW,
      showRefreshButton: false, previewNotice: null, tz: TZ,
    };
  }

  it("prints between the route and the receipts", () => {
    const html = renderPage(view(snapshot(workload())));
    expect(html).toContain('<h2 class="form-title">Form guide</h2>');
    expect(html.indexOf('class="form"')).toBeGreaterThan(html.indexOf('class="route"'));
    expect(html.indexOf('class="form"')).toBeLessThan(html.indexOf('class="receipts"'));
  });

  it("is absent from a snapshot written before the chart existed", () => {
    const legacy = snapshot(null);
    delete (legacy as { workload?: unknown }).workload;
    const html = renderPage(view(legacy));
    expect(html).not.toContain('class="form-title"');
    // The rest of the sheet still prints.
    expect(html).toContain('class="receipts"');
  });
});
