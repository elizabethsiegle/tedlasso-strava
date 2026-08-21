import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker";
import { KvStore } from "../../src/infrastructure/store/kv";
import { getMachiavelliMood } from "../../src/data/machiavelli";
import { getMood } from "../../src/data/moods";
import { pickQuote } from "../../src/domain/quote";
import type { Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-21T19:00:00Z");
const REFRESHED = NOW - 3_600_000;

const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

function ctx(): ExecutionContext {
  return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function testEnv() {
  return {
    ...(env as object),
    TIMEZONE: "America/Los_Angeles",
    PRIVACY_TRIM_M: "250",
    REDIRECT_URI: "https://example.test/auth/callback",
    STRAVA_CLIENT_ID: "cid",
    STRAVA_CLIENT_SECRET: "sec",
    STRAVA_ATHLETE_ID: "4242",
    SETUP_KEY: "s3cret",
  } as never;
}

/** A snapshot as `refresh.ts` writes one: the Ted Lasso pick already baked in. */
function snapshot(): Snapshot {
  const mood = getMood("gaffer-mode")!;
  const { quote, media } = pickQuote(mood, REFRESHED);
  return {
    version: 1,
    refreshedAt: REFRESHED,
    mood: { id: mood.id, name: mood.name, accent: mood.accent },
    quote,
    gif: media ? { url: media.url, alt: media.alt, verifiedOn: media.verifiedOn, kind: media.kind } : null,
    scores: { consistency: 72, charge: 64 },
    reasons: ["8 workouts this week, against your usual 6"],
    facts: {
      last: {
        name: "Afternoon Walk", sportType: "Walk", distanceM: 2100,
        movingTimeS: 1500, elevationM: 3, startedAt: REFRESHED - 86_400_000,
      },
      daysSinceLast: 1.2,
      countLast7: 8,
      baselineWeekly: 6,
      streakDays: 3,
      totalActivities: 66,
    },
    route: null,
  };
}

async function get(path: string): Promise<string> {
  const res = await worker.fetch(new Request(`https://example.test${path}`), testEnv(), ctx());
  expect(res.status, path).toBe(200);
  return res.text();
}

const quoteOf = (html: string): string =>
  /<blockquote class="quote">([\s\S]*?)<\/blockquote>/.exec(html)?.[1]?.trim() ?? "";
const moodOf = (html: string): string =>
  /<h1 class="mood-name">([^<]*)</.exec(html)?.[1]?.trim() ?? "";
const citationOf = (html: string): string =>
  /<p class="attribution">([^<]*)</.exec(html)?.[1]?.trim() ?? "";
const receiptsOf = (html: string): string[] =>
  [...html.matchAll(/<th scope="row">([^<]+)<\/th><td>([^<]*)<\/td>/g)].map((m) => `${m[1]}=${m[2]}`);

describe("the two voices", () => {
  beforeEach(async () => {
    await new KvStore(kv()).putSnapshot(snapshot());
  });

  it("serves the Ted Lasso voice at / and the Machiavelli voice at /machiavelli", async () => {
    expect(citationOf(await get("/"))).toBe("Ted Lasso");
    expect(citationOf(await get("/machiavelli"))).toMatch(/The Prince|Discourses|The Art of War|Letter to/);
  });

  it("names the same mood in each catalogue's own words", async () => {
    const ted = getMood("gaffer-mode")!;
    const mach = getMachiavelliMood("gaffer-mode")!;
    expect(moodOf(await get("/"))).toBe(ted.name);
    expect(moodOf(await get("/machiavelli"))).toBe(mach.name);
    expect(mach.name).not.toBe(ted.name);
  });

  it("does not leak the stored Ted Lasso quote onto the Machiavelli page", async () => {
    const html = await get("/machiavelli");
    expect(html).not.toContain(snapshot().quote.text);
    expect(quoteOf(html).length).toBeGreaterThan(0);
  });

  /**
   * The heart of the feature: one snapshot, one set of numbers, two vocabularies.
   * If any figure moved between the pages, the voice would be editing the data.
   */
  it("reports byte-identical training numbers in both voices", async () => {
    const ted = receiptsOf(await get("/"));
    const mach = receiptsOf(await get("/machiavelli"));
    expect(ted.length).toBeGreaterThan(0);
    expect(mach).toEqual(ted);
  });

  /**
   * Seeded from the snapshot's refresh time, not the clock, so the Machiavelli
   * page holds still between refreshes exactly as the stored pick does. A reload
   * that reshuffled the quote would make the page feel broken.
   */
  it("holds the same quote across reloads until the next refresh", async () => {
    const first = quoteOf(await get("/machiavelli"));
    const second = quoteOf(await get("/machiavelli"));
    expect(second).toBe(first);

    // A different refresh time is allowed to land on a different passage.
    const moved = snapshot();
    moved.refreshedAt = REFRESHED - 5 * 86_400_000;
    await new KvStore(kv()).putSnapshot(moved);
    const quotes = getMachiavelliMood("gaffer-mode")!.quotes.map((q) => q.text);
    expect(quotes).toContain(quoteOf(await get("/machiavelli")));
  });

  it("keeps every section of the design on both pages", async () => {
    const ted = await get("/");
    const mach = await get("/machiavelli");
    for (const marker of ['class="sheet"', 'class="masthead"', 'class="quote"', 'class="receipts"', 'class="footer"']) {
      expect(ted, marker).toContain(marker);
      expect(mach, marker).toContain(marker);
    }
  });

  it("links each voice to the other from the footer, so neither is a secret url", async () => {
    expect(await get("/")).toContain('href="/machiavelli"');
    const mach = await get("/machiavelli");
    expect(mach).toContain("Read it as Ted Lasso");
    expect(mach).toContain('href="/"');
  });

  it("points each page at its own catalogue", async () => {
    expect(await get("/")).toContain('href="/catalogue"');
    expect(await get("/machiavelli")).toContain('href="/catalogue/machiavelli"');
  });

  it("previews a mood in the voice of the page it was asked for", async () => {
    const html = await get("/machiavelli?preview=believe");
    expect(moodOf(html)).toBe(getMachiavelliMood("believe")!.name);
    expect(html.toLowerCase()).toContain("preview");
    // The same id on the default page stays Ted Lasso.
    expect(moodOf(await get("/?preview=believe"))).toBe(getMood("believe")!.name);
  });

  it("ignores an unknown preview id on either page", async () => {
    for (const path of ["/?preview=nope", "/machiavelli?preview=nope"]) {
      const html = await get(path);
      expect(html).not.toContain("nope");
      expect(html.toLowerCase()).not.toContain("undefined");
    }
  });

  it("serves a catalogue per voice, each pointing previews at its own board", async () => {
    const ted = await get("/catalogue");
    const mach = await get("/catalogue/machiavelli");
    expect(ted).toContain("<h1 class=\"mood-name\">Catalogue</h1>");
    expect(mach).toContain("Catalogue: Machiavelli");
    expect(mach).toContain("src/data/machiavelli.ts");
    expect(mach).toContain('href="/machiavelli?preview=');
    expect(ted).toContain('href="/?preview=');
  });

  it("renders both voices with no snapshot at all, each in its own words", async () => {
    await kv().delete("snapshot/current");
    const ted = await get("/");
    const mach = await get("/machiavelli");
    expect(moodOf(ted)).toBe(getMood("preseason")!.name);
    expect(moodOf(mach)).toBe(getMachiavelliMood("preseason")!.name);
    for (const html of [ted, mach]) {
      expect(html.toLowerCase()).not.toContain("undefined");
      expect(html).toContain("</html>");
    }
  });

  it("still 404s anything that is not a route", async () => {
    const res = await worker.fetch(new Request("https://example.test/machiavelli/extra"), testEnv(), ctx());
    expect(res.status).toBe(404);
  });
});
