# tedlasso-strava Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cloudflare Worker that reads one athlete's Strava activity every 4 hours, derives a mood from it, and serves a single page with a matching Ted Lasso quote, GIF, and hand-drawn SVG route map.

**Architecture:** Hexagonal. A cron-triggered write path fetches Strava, runs pure domain code, and stores one JSON snapshot in KV. A read path renders HTML from that snapshot and never calls Strava. All numeric and geometric logic is pure, clock-injected, and fixture-tested.

**Tech Stack:** TypeScript, Cloudflare Workers, Workers KV, Wrangler, Vitest 4.1+ with `@cloudflare/vitest-pool-workers`. No runtime dependencies, no UI framework, no CSS framework.

**Spec:** `docs/superpowers/specs/2026-08-14-tedlasso-strava-design.md` — read it alongside this plan. Where they disagree, the spec wins.

## Global Constraints

Every task's requirements implicitly include this section.

- `src/domain/**` imports nothing from `src/infrastructure/**` or `src/app/**`, uses no Workers types, and makes no network calls.
- No `Date.now()` or argless `new Date()` in `src/domain/**`. `now` is always a parameter. Constructing `new Date(explicitEpochMs)` is allowed and expected — that reads an argument, not the clock.
- No `Math.random()` in `src/domain/**`. Randomness is seeded from `refreshedAt`.
- No runtime npm dependencies. Dev dependencies only.
- Strava `after` parameter is **epoch seconds**, not milliseconds.
- `per_page=200` is Strava's maximum; fetch at most 2 pages (hard cap 400 activities).
- Required scope is exactly `activity:read_all`.
- Route polylines are privacy-trimmed in the **write path**. Only finished `pathD` strings are persisted. Never persist raw coordinates.
- Never emit the strings "personal record" or "PR" in user-facing copy. Use "longest ride in 90 days" phrasing.
- Every page showing Strava data must include a "Powered by Strava" link back to `https://www.strava.com`.
- A failed refresh must never write or clear `snapshot/current`. It writes `health` only.
- Cron triggers go under `"triggers": { "crons": [...] }` in `wrangler.jsonc`. `crons` is not a top-level key.
- Vitest must be `^4.1.0` or later — `@cloudflare/vitest-pool-workers` requires it.
- UI rules in `CLAUDE.md` are binding: no gradients, no emoji-as-icons, no glassmorphism, no uniform-everything layouts, no shadowed cards.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/activity.ts` | `Activity`, `LastActivity`, `Facts` types |
| `src/domain/tuning.ts` | Every numeric constant, one module |
| `src/domain/time.ts` | Timezone-aware day boundaries, fractional day math |
| `src/domain/facts.ts` | `deriveFacts` — counts, baseline, streak, effort, records |
| `src/domain/axes.ts` | `scoreConsistency`, `scoreCharge` |
| `src/domain/mood.ts` | `selectMood` — overrides then grid, plus reason strings |
| `src/domain/quote.ts` | `fnv1a`, `pickQuote` |
| `src/domain/route.ts` | Polyline decode, privacy trim, simplify, project, path |
| `src/data/moods.ts` | The nine-mood catalogue as versioned data |
| `src/types.ts` | `Snapshot`, `Health`, `PageView` — shared across layers |
| `src/infrastructure/store/kv.ts` | `KvStore` — all KV reads and writes |
| `src/infrastructure/strava/client.ts` | `StravaClient` — token and activity HTTP |
| `src/infrastructure/strava/map.ts` | Strava JSON → domain `Activity` |
| `src/app/refresh.ts` | `runRefresh` — the shared write-path orchestration |
| `src/app/auth.ts` | `/auth/login` and `/auth/callback` |
| `src/app/render.ts` | `renderPage` — `PageView` → HTML string |
| `src/app/styles.ts` | The stylesheet as a template string |
| `src/worker.ts` | `fetch` and `scheduled` entrypoints, routing |

---

## Phase 1 — Foundation

### Task 1: Project scaffold and a working test harness

Proves the toolchain runs before any logic depends on it. If this task's test does not pass, nothing later in the plan is trustworthy.

**Files:**
- Create: `package.json`, `tsconfig.json`, `test/tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `.gitignore`
- Create: `src/worker.ts`
- Test: `test/worker.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `default export` Worker object with `fetch` and `scheduled` handlers; an `Env` interface in `src/worker.ts` that later tasks extend.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tedlasso-strava",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --test-scheduled",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.9.0",
    "@cloudflare/workers-types": "^4.20250109.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

`noUncheckedIndexedAccess` is deliberate. This codebase indexes into arrays constantly (polyline points, weekly buckets) and the compiler catching a possible `undefined` there is worth the extra guards.

- [ ] **Step 3: Create `test/tsconfig.json`**

```jsonc
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "types": ["@cloudflare/vitest-pool-workers/types"]
  },
  "include": ["./**/*.ts", "../src/**/*.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/domain/**", "src/data/**"],
      thresholds: { branches: 95, functions: 95, lines: 95, statements: 95 },
    },
  },
});
```

Coverage is scoped to `src/domain` and `src/data` on purpose. Those are the fixture-tested pure modules the spec requires near-100% branch coverage on; holding infrastructure to the same bar would reward testing HTTP plumbing over logic.

- [ ] **Step 5: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tedlasso-strava",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-14",
  "observability": { "enabled": true },
  "triggers": {
    "crons": ["0 */4 * * *"]
  },
  "kv_namespaces": [
    { "binding": "STORE", "id": "PLACEHOLDER_REPLACED_AT_DEPLOY" }
  ],
  "vars": {
    "TIMEZONE": "America/Los_Angeles",
    "PRIVACY_TRIM_M": "250",
    "REDIRECT_URI": "http://localhost:8787/auth/callback"
  }
}
```

The KV `id` is the one value a human must fill in; Task 18 documents creating the namespace. Tests do not use it — the Vitest pool provisions an in-memory KV for the `STORE` binding automatically.

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
.wrangler/
coverage/
.dev.vars
```

`.dev.vars` holds local secrets and must never be committed.

- [ ] **Step 7: Create `src/worker.ts` with the minimum that can be tested**

```ts
export interface Env {
  STORE: KVNamespace;
  TIMEZONE: string;
  PRIVACY_TRIM_M: string;
  REDIRECT_URI: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_ATHLETE_ID: string;
  SETUP_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("tedlasso-strava", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Task 14 wires this to runRefresh.
  },
};
```

- [ ] **Step 8: Write the harness test**

```ts
// test/worker.test.ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/worker";

describe("worker harness", () => {
  it("responds to a request", async () => {
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const res = await worker.fetch(new Request("http://localhost/"), env as never, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("tedlasso-strava");
  });

  it("exposes a KV binding to tests", async () => {
    await (env as never as { STORE: KVNamespace }).STORE.put("probe", "ok");
    expect(await (env as never as { STORE: KVNamespace }).STORE.get("probe")).toBe("ok");
  });
});
```

- [ ] **Step 9: Install and run**

Run: `npm install && npm test`
Expected: both tests PASS. If the KV test fails, the `kv_namespaces` binding name in `wrangler.jsonc` does not match `STORE` — fix that before continuing.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json test/tsconfig.json vitest.config.ts wrangler.jsonc .gitignore src/worker.ts test/worker.test.ts
git commit -m "chore: scaffold worker, wrangler config, and vitest harness"
```

---

## Phase 2 — Domain (pure logic, no I/O)

### Task 2: Types, tuning constants, and timezone-aware time helpers

Everything downstream depends on correct day boundaries. DST is the trap: `America/Los_Angeles` has a 23-hour day and a 25-hour day each year, so day math done with fixed 86400000ms arithmetic silently breaks streaks twice a year.

**Files:**
- Create: `src/domain/activity.ts`, `src/domain/tuning.ts`, `src/domain/time.ts`
- Test: `test/domain/time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Activity`, `interface LastActivity`, `interface Facts` from `activity.ts`
  - `TUNING` const object from `tuning.ts`
  - `dayKey(epochMs: number, tz: string): string` → `"YYYY-MM-DD"`
  - `startOfDayMs(epochMs: number, tz: string): number`
  - `daysBetween(fromMs: number, toMs: number): number` → fractional, positive when `toMs` is later
  - `addDaysMs(epochMs: number, days: number, tz: string): number` → DST-safe, lands on the same local wall-clock time

- [ ] **Step 1: Write `src/domain/activity.ts`**

```ts
export interface Activity {
  id: number;
  name: string;
  sportType: string;
  distanceM: number;
  movingTimeS: number;
  elevationM: number;
  averageSpeed: number;          // metres per second
  sufferScore: number | null;
  startedAt: number;             // epoch ms
  summaryPolyline: string | null;
  locationLabel: string | null;
}

export interface LastActivity {
  name: string;
  sportType: string;
  distanceM: number;
  movingTimeS: number;
  elevationM: number;
  startedAt: number;
}

export interface Facts {
  totalActivities: number;
  last: LastActivity | null;
  daysSinceLast: number | null;
  countLast7: number;
  countLast14: number;
  countLast28: number;
  baselineWeekly: number;
  streakDays: number;
  relEffortLast: number;
  isLongest90: boolean;
  isFastest90: boolean;
  previousGapDays: number | null;
}
```

- [ ] **Step 2: Write `src/domain/tuning.ts`**

```ts
export const TUNING = {
  // Fetch window
  WINDOW_DAYS: 90,
  MAX_PAGES: 2,
  PER_PAGE: 200,

  // Baseline
  BASELINE_WEEKS: 12,
  MIN_WEEKS_FOR_BASELINE: 4,

  // relEffortLast
  MIN_EFFORT_SAMPLES: 5,
  NEUTRAL_EFFORT: 0.5,

  // Record detection
  MIN_RECORD_SAMPLES: 3,
  FASTEST_DISTANCE_GUARD: 0.8,

  // Consistency
  VOLUME_RATIO_CAP: 1.5,
  FLOOR28_TARGET: 12,
  STREAK_TARGET: 5,
  W_VOLUME: 0.55,
  W_FLOOR28: 0.30,
  W_STREAK: 0.15,
  RECENCY_GRACE_DAYS: 3,
  RECENCY_SPAN_DAYS: 11,
  RECENCY_FLOOR: 0.15,

  // Charge
  CHARGE_HALF_LIFE_DAYS: 3,

  // Mood selection
  DORMANT_DAYS: 10,
  RECENT_DAYS: 2,
  STREAK_MOOD_DAYS: 5,
  COMEBACK_GAP_DAYS: 7,
  GRID_HIGH: 60,
  GRID_LOW: 35,

  // Route
  DEFAULT_PRIVACY_TRIM_M: 250,
  MAX_ROUTE_POINTS: 300,
  ROUTE_VIEWBOX: 1000,
  ROUTE_PADDING: 40,

  // Presentation
  STALE_SNAPSHOT_HOURS: 12,
  STALE_VERIFIED_DAYS: 180,
  MANUAL_REFRESH_COOLDOWN_MS: 60_000,
  OAUTH_STATE_TTL_S: 600,
  REFRESH_ANIMATION_MS: 1200,
} as const;

export const DAY_MS = 86_400_000;
```

- [ ] **Step 3: Write the failing time tests**

```ts
// test/domain/time.test.ts
import { describe, expect, it } from "vitest";
import { addDaysMs, dayKey, daysBetween, startOfDayMs } from "../../src/domain/time";

const LA = "America/Los_Angeles";

describe("dayKey", () => {
  it("uses the given timezone, not UTC", () => {
    // 2026-03-10T03:00:00Z is still 2026-03-09 in Los Angeles.
    expect(dayKey(Date.parse("2026-03-10T03:00:00Z"), LA)).toBe("2026-03-09");
    expect(dayKey(Date.parse("2026-03-10T03:00:00Z"), "UTC")).toBe("2026-03-10");
  });

  it("zero-pads months and days", () => {
    expect(dayKey(Date.parse("2026-01-05T20:00:00Z"), LA)).toBe("2026-01-05");
  });
});

describe("startOfDayMs", () => {
  it("returns local midnight", () => {
    const noon = Date.parse("2026-08-14T19:00:00Z"); // 12:00 PDT
    expect(dayKey(startOfDayMs(noon, LA), LA)).toBe("2026-08-14");
    expect(new Date(startOfDayMs(noon, LA)).toISOString()).toBe("2026-08-14T07:00:00.000Z");
  });

  it("is idempotent", () => {
    const t = Date.parse("2026-08-14T19:00:00Z");
    expect(startOfDayMs(startOfDayMs(t, LA), LA)).toBe(startOfDayMs(t, LA));
  });
});

describe("addDaysMs across DST", () => {
  it("crossing spring-forward keeps the same wall-clock hour", () => {
    // US DST begins 2026-03-08. Local midnight before and after must stay midnight.
    const before = startOfDayMs(Date.parse("2026-03-07T20:00:00Z"), LA);
    const after = addDaysMs(before, 1, LA);
    expect(dayKey(after, LA)).toBe("2026-03-08");
    expect(after - before).toBe(23 * 60 * 60 * 1000); // the short day
  });

  it("crossing fall-back keeps the same wall-clock hour", () => {
    const before = startOfDayMs(Date.parse("2026-10-31T20:00:00Z"), LA);
    const after = addDaysMs(before, 1, LA);
    expect(dayKey(after, LA)).toBe("2026-11-01");
    expect(after - before).toBe(25 * 60 * 60 * 1000); // the long day
  });

  it("subtracts as well as adds", () => {
    const t = startOfDayMs(Date.parse("2026-08-14T19:00:00Z"), LA);
    expect(dayKey(addDaysMs(t, -3, LA), LA)).toBe("2026-08-11");
  });
});

describe("daysBetween", () => {
  it("returns fractional days", () => {
    const a = Date.parse("2026-08-14T00:00:00Z");
    const b = Date.parse("2026-08-15T12:00:00Z");
    expect(daysBetween(a, b)).toBeCloseTo(1.5, 6);
  });

  it("is negative when the second argument is earlier", () => {
    const a = Date.parse("2026-08-15T00:00:00Z");
    const b = Date.parse("2026-08-14T00:00:00Z");
    expect(daysBetween(a, b)).toBeCloseTo(-1, 6);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run test/domain/time.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/time`.

- [ ] **Step 5: Implement `src/domain/time.ts`**

```ts
import { DAY_MS } from "./tuning";

/**
 * Offset in ms between the given timezone's wall clock and UTC at that instant.
 * Uses Intl rather than a fixed table so DST is handled by the runtime.
 * `new Date(epochMs)` here reads an argument, not the system clock.
 */
function tzOffsetMs(epochMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`missing ${type} for timezone ${tz}`);
    return Number(found.value);
  };
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - epochMs;
}

export function dayKey(epochMs: number, tz: string): string {
  const local = new Date(epochMs + tzOffsetMs(epochMs, tz));
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDayMs(epochMs: number, tz: string): number {
  const offset = tzOffsetMs(epochMs, tz);
  const local = epochMs + offset;
  const localMidnight = local - (local % DAY_MS + DAY_MS) % DAY_MS;
  // Re-resolve the offset at the candidate instant: the offset at local noon and
  // at local midnight can differ on a DST transition day.
  const candidate = localMidnight - offset;
  const corrected = localMidnight - tzOffsetMs(candidate, tz);
  return corrected;
}

export function addDaysMs(epochMs: number, days: number, tz: string): number {
  const naive = epochMs + days * DAY_MS;
  // Preserve wall-clock time by correcting for any offset change across the span.
  return naive + (tzOffsetMs(epochMs, tz) - tzOffsetMs(naive, tz));
}

export function daysBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / DAY_MS;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run test/domain/time.test.ts`
Expected: all PASS. If a DST test fails, the bug is almost certainly in `startOfDayMs` re-resolving the offset — that second `tzOffsetMs` call is what makes transition days correct.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/activity.ts src/domain/tuning.ts src/domain/time.ts test/domain/time.test.ts
git commit -m "feat(domain): types, tuning constants, and DST-safe time helpers"
```

---

### Task 3: deriveFacts — counts, baseline, streak, gaps

**Files:**
- Create: `src/domain/facts.ts`
- Test: `test/domain/facts.test.ts`, `test/fixtures/activities.ts`

**Interfaces:**
- Consumes: `Activity`, `Facts` (Task 2); `dayKey`, `startOfDayMs`, `addDaysMs`, `daysBetween` (Task 2); `TUNING`, `DAY_MS` (Task 2).
- Produces: `deriveFacts(activities: Activity[], nowMs: number, tz: string): Facts`. Task 4 extends the same function; Tasks 5 and 7 consume its output.
- Also produces the test helper `makeActivity(overrides: Partial<Activity>): Activity` in `test/fixtures/activities.ts`, used by Tasks 4, 5, 7, 9.

**Week bucketing, stated exactly so it is not re-derived:** the current partial week is the 7 days ending now, i.e. `countLast7`. The baseline covers the 12 full 7-day windows *preceding* that. With `todayStart = startOfDayMs(now, tz)`, define `baselineEnd = addDaysMs(todayStart, -6, tz)`. Window `k` (for `k = 0..11`) is `[addDaysMs(baselineEnd, -7*(k+1), tz), addDaysMs(baselineEnd, -7*k, tz))`. Twelve windows plus the six-day offset reach exactly 90 days back, which is why the fetch window is 90 days.

- [ ] **Step 1: Write the fixture helper**

```ts
// test/fixtures/activities.ts
import type { Activity } from "../../src/domain/activity";

let nextId = 1;

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: nextId++,
    name: "Morning Run",
    sportType: "Run",
    distanceM: 5000,
    movingTimeS: 1800,
    elevationM: 40,
    averageSpeed: 5000 / 1800,
    sufferScore: null,
    startedAt: Date.parse("2026-08-14T15:00:00Z"),
    summaryPolyline: null,
    locationLabel: null,
    ...overrides,
  };
}

/** Activities at the given whole-day offsets before `nowMs`, most recent first. */
export function daysAgo(nowMs: number, offsets: number[], overrides: Partial<Activity> = {}): Activity[] {
  return offsets.map((d) =>
    makeActivity({ startedAt: nowMs - d * 86_400_000, ...overrides }),
  );
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/domain/facts.test.ts
import { describe, expect, it } from "vitest";
import { deriveFacts } from "../../src/domain/facts";
import { daysAgo, makeActivity } from "../fixtures/activities";

const LA = "America/Los_Angeles";
const NOW = Date.parse("2026-08-14T19:00:00Z"); // Friday noon PDT

describe("deriveFacts with no activities", () => {
  const f = deriveFacts([], NOW, LA);

  it("reports zero totals and null last", () => {
    expect(f.totalActivities).toBe(0);
    expect(f.last).toBeNull();
    expect(f.daysSinceLast).toBeNull();
    expect(f.previousGapDays).toBeNull();
  });

  it("reports zero counts, baseline, and streak", () => {
    expect(f.countLast7).toBe(0);
    expect(f.countLast28).toBe(0);
    expect(f.baselineWeekly).toBe(0);
    expect(f.streakDays).toBe(0);
  });
});

describe("counts", () => {
  it("bucket activities by age", () => {
    const f = deriveFacts(daysAgo(NOW, [0, 2, 6, 9, 20, 40]), NOW, LA);
    expect(f.totalActivities).toBe(6);
    expect(f.countLast7).toBe(3);   // 0, 2, 6
    expect(f.countLast14).toBe(4);  // + 9
    expect(f.countLast28).toBe(5);  // + 20
  });

  it("excludes activities outside the 90-day window", () => {
    const f = deriveFacts(daysAgo(NOW, [1, 200]), NOW, LA);
    expect(f.totalActivities).toBe(1);
  });
});

describe("last activity and gaps", () => {
  it("picks the most recent regardless of input order", () => {
    const acts = [
      makeActivity({ name: "Older", startedAt: NOW - 5 * 86_400_000 }),
      makeActivity({ name: "Newest", startedAt: NOW - 1 * 86_400_000 }),
      makeActivity({ name: "Middle", startedAt: NOW - 3 * 86_400_000 }),
    ];
    const f = deriveFacts(acts, NOW, LA);
    expect(f.last?.name).toBe("Newest");
    expect(f.daysSinceLast).toBeCloseTo(1, 6);
    expect(f.previousGapDays).toBeCloseTo(2, 6); // newest minus middle
  });

  it("returns a null gap when there is only one activity", () => {
    const f = deriveFacts(daysAgo(NOW, [1]), NOW, LA);
    expect(f.previousGapDays).toBeNull();
  });
});

describe("streakDays", () => {
  it("counts consecutive days ending today", () => {
    const f = deriveFacts(daysAgo(NOW, [0, 1, 2, 3]), NOW, LA);
    expect(f.streakDays).toBe(4);
  });

  it("still counts when the streak ended yesterday", () => {
    const f = deriveFacts(daysAgo(NOW, [1, 2, 3]), NOW, LA);
    expect(f.streakDays).toBe(3);
  });

  it("is zero when neither today nor yesterday has an activity", () => {
    const f = deriveFacts(daysAgo(NOW, [2, 3, 4]), NOW, LA);
    expect(f.streakDays).toBe(0);
  });

  it("counts two activities on the same day once", () => {
    const acts = [
      makeActivity({ startedAt: NOW - 3_600_000 }),
      makeActivity({ startedAt: NOW - 7_200_000 }),
      makeActivity({ startedAt: NOW - 86_400_000 }),
    ];
    expect(deriveFacts(acts, NOW, LA).streakDays).toBe(2);
  });

  it("survives a DST transition inside the streak", () => {
    // 2026-11-01 is the fall-back day in Los Angeles.
    const now = Date.parse("2026-11-02T20:00:00Z");
    const acts = [
      makeActivity({ startedAt: Date.parse("2026-11-02T18:00:00Z") }), // Nov 2 local
      makeActivity({ startedAt: Date.parse("2026-11-01T18:00:00Z") }), // Nov 1 local
      makeActivity({ startedAt: Date.parse("2026-10-31T18:00:00Z") }), // Oct 31 local
    ];
    expect(deriveFacts(acts, now, LA).streakDays).toBe(3);
  });
});

describe("baselineWeekly", () => {
  it("falls back to countLast28/4 with under four weeks of history", () => {
    const f = deriveFacts(daysAgo(NOW, [1, 3, 8, 15, 20]), NOW, LA);
    expect(f.baselineWeekly).toBeCloseTo(5 / 4, 6);
  });

  it("takes the median of the twelve preceding full weeks", () => {
    // Two activities in each of the twelve baseline weeks, none in the last 7 days.
    const offsets: number[] = [];
    for (let week = 0; week < 12; week++) {
      const base = 7 + week * 7;
      offsets.push(base + 1, base + 3);
    }
    const f = deriveFacts(daysAgo(NOW, offsets), NOW, LA);
    expect(f.baselineWeekly).toBe(2);
  });

  it("ignores the current partial week when computing the median", () => {
    const offsets: number[] = [0, 1, 2, 3, 4, 5]; // a big current week
    for (let week = 0; week < 12; week++) offsets.push(7 + week * 7 + 1);
    const f = deriveFacts(daysAgo(NOW, offsets), NOW, LA);
    expect(f.baselineWeekly).toBe(1); // the burst in the current week does not inflate it
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/domain/facts.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/facts`.

- [ ] **Step 4: Implement `src/domain/facts.ts`**

```ts
import type { Activity, Facts, LastActivity } from "./activity";
import { addDaysMs, dayKey, daysBetween, startOfDayMs } from "./time";
import { DAY_MS, TUNING } from "./tuning";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function toLastActivity(a: Activity): LastActivity {
  return {
    name: a.name,
    sportType: a.sportType,
    distanceM: a.distanceM,
    movingTimeS: a.movingTimeS,
    elevationM: a.elevationM,
    startedAt: a.startedAt,
  };
}

function computeStreak(activities: Activity[], nowMs: number, tz: string): number {
  if (activities.length === 0) return 0;
  const days = new Set(activities.map((a) => dayKey(a.startedAt, tz)));
  const todayStart = startOfDayMs(nowMs, tz);

  let cursor = todayStart;
  if (!days.has(dayKey(cursor, tz))) {
    cursor = addDaysMs(cursor, -1, tz);
    if (!days.has(dayKey(cursor, tz))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor, tz))) {
    streak++;
    cursor = addDaysMs(cursor, -1, tz);
  }
  return streak;
}

function computeBaseline(activities: Activity[], nowMs: number, tz: string, countLast28: number): number {
  if (activities.length === 0) return 0;

  const todayStart = startOfDayMs(nowMs, tz);
  const oldest = activities[activities.length - 1] as Activity;
  const historyDays = daysBetween(oldest.startedAt, nowMs);
  if (historyDays < TUNING.MIN_WEEKS_FOR_BASELINE * 7) {
    return countLast28 / 4;
  }

  const baselineEnd = addDaysMs(todayStart, -6, tz);
  const counts: number[] = [];
  for (let k = 0; k < TUNING.BASELINE_WEEKS; k++) {
    const end = addDaysMs(baselineEnd, -7 * k, tz);
    const start = addDaysMs(baselineEnd, -7 * (k + 1), tz);
    counts.push(activities.filter((a) => a.startedAt >= start && a.startedAt < end).length);
  }
  return median(counts);
}

export function deriveFacts(activities: Activity[], nowMs: number, tz: string): Facts {
  const windowStart = nowMs - TUNING.WINDOW_DAYS * DAY_MS;
  const inWindow = activities
    .filter((a) => a.startedAt >= windowStart && a.startedAt <= nowMs)
    .sort((a, b) => b.startedAt - a.startedAt);

  const last = inWindow[0];
  const previous = inWindow[1];
  const countWithin = (days: number): number =>
    inWindow.filter((a) => daysBetween(a.startedAt, nowMs) <= days).length;

  const countLast28 = countWithin(28);

  return {
    totalActivities: inWindow.length,
    last: last ? toLastActivity(last) : null,
    daysSinceLast: last ? daysBetween(last.startedAt, nowMs) : null,
    countLast7: countWithin(7),
    countLast14: countWithin(14),
    countLast28,
    baselineWeekly: computeBaseline(inWindow, nowMs, tz, countLast28),
    streakDays: computeStreak(inWindow, nowMs, tz),
    previousGapDays: last && previous ? daysBetween(previous.startedAt, last.startedAt) : null,
    // Task 4 replaces these three.
    relEffortLast: TUNING.NEUTRAL_EFFORT,
    isLongest90: false,
    isFastest90: false,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/domain/facts.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/facts.ts test/domain/facts.test.ts test/fixtures/activities.ts
git commit -m "feat(domain): derive counts, baseline, streak, and gaps from activities"
```

---

### Task 4: deriveFacts — relative effort and 90-day records

Extends the same `deriveFacts` function. The three fields Task 3 stubbed become real here.

**Files:**
- Modify: `src/domain/facts.ts` (replace the three stubbed fields and add the helpers below)
- Test: `test/domain/effort.test.ts`

**Interfaces:**
- Consumes: `Activity`, `Facts`, `TUNING`, and `deriveFacts` from Task 3.
- Produces: no new exported names. `Facts.relEffortLast`, `Facts.isLongest90`, and `Facts.isFastest90` become correct. Task 5 reads `relEffortLast`; Task 7 reads both booleans.

**Definitions, restated exactly:**
- `effort(a) = a.sufferScore ?? a.movingTimeS / 60`
- `relEffortLast` = the fraction of *other* same-sport activities in the window with strictly lower effort. Needs at least `MIN_EFFORT_SAMPLES` (5) other same-sport activities; else retry against all other activities with the same threshold; else `NEUTRAL_EFFORT` (0.5).
- `isLongest90` = the last activity's `distanceM` is strictly greater than every other same-sport activity's, with at least `MIN_RECORD_SAMPLES` (3) other same-sport activities.
- `isFastest90` = the last activity's `averageSpeed` is strictly greater than every other same-sport activity whose `distanceM >= FASTEST_DISTANCE_GUARD * last.distanceM`, with at least 3 such others.

- [ ] **Step 1: Write the failing tests**

```ts
// test/domain/effort.test.ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/domain/effort.test.ts`
Expected: FAIL — `relEffortLast` is the stubbed `0.5` and both booleans are `false`.

- [ ] **Step 3: Add the helpers to `src/domain/facts.ts`**

```ts
function effort(a: Activity): number {
  return a.sufferScore ?? a.movingTimeS / 60;
}

/** Fraction of `others` with strictly lower effort than `target`. */
function percentileRank(target: Activity, others: Activity[]): number {
  const lower = others.filter((o) => effort(o) < effort(target)).length;
  return lower / others.length;
}

function computeRelEffort(last: Activity, others: Activity[]): number {
  const sameSport = others.filter((o) => o.sportType === last.sportType);
  if (sameSport.length >= TUNING.MIN_EFFORT_SAMPLES) return percentileRank(last, sameSport);
  if (others.length >= TUNING.MIN_EFFORT_SAMPLES) return percentileRank(last, others);
  return TUNING.NEUTRAL_EFFORT;
}

function computeIsLongest(last: Activity, others: Activity[]): boolean {
  const sameSport = others.filter((o) => o.sportType === last.sportType);
  if (sameSport.length < TUNING.MIN_RECORD_SAMPLES) return false;
  return sameSport.every((o) => o.distanceM < last.distanceM);
}

function computeIsFastest(last: Activity, others: Activity[]): boolean {
  const comparable = others.filter(
    (o) =>
      o.sportType === last.sportType &&
      o.distanceM >= TUNING.FASTEST_DISTANCE_GUARD * last.distanceM,
  );
  if (comparable.length < TUNING.MIN_RECORD_SAMPLES) return false;
  return comparable.every((o) => o.averageSpeed < last.averageSpeed);
}
```

- [ ] **Step 4: Replace the three stubbed fields in `deriveFacts`**

Change the returned object's last three fields from the Task 3 stubs to:

```ts
    relEffortLast: last ? computeRelEffort(last, inWindow.slice(1)) : 0,
    isLongest90: last ? computeIsLongest(last, inWindow.slice(1)) : false,
    isFastest90: last ? computeIsFastest(last, inWindow.slice(1)) : false,
```

`inWindow` is sorted most-recent-first, so `slice(1)` is exactly "every activity other than the last one". Note the no-activities case now yields `relEffortLast: 0`, not `0.5` — with nothing to measure there is no effort, and Task 5's charge formula multiplies by it.

- [ ] **Step 5: Run both fact suites**

Run: `npx vitest run test/domain/facts.test.ts test/domain/effort.test.ts`
Expected: all PASS. The Task 3 zero-activities test asserts counts and streak only, so the `relEffortLast` change does not break it.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/facts.ts test/domain/effort.test.ts
git commit -m "feat(domain): relative effort percentile and 90-day distance/speed records"
```

---

### Task 5: The two axes

**Files:**
- Create: `src/domain/axes.ts`
- Test: `test/domain/axes.test.ts`

**Interfaces:**
- Consumes: `Facts` (Task 2), `TUNING` (Task 2).
- Produces:
  - `scoreConsistency(f: Facts): number` → integer 0–100
  - `scoreCharge(f: Facts): number` → integer 0–100
  - `clamp(value: number, min: number, max: number): number` (exported; Task 9 reuses it)

- [ ] **Step 1: Write the failing tests**

```ts
// test/domain/axes.test.ts
import { describe, expect, it } from "vitest";
import type { Facts } from "../../src/domain/activity";
import { clamp, scoreCharge, scoreConsistency } from "../../src/domain/axes";

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    totalActivities: 10,
    last: {
      name: "Run", sportType: "Run", distanceM: 5000,
      movingTimeS: 1800, elevationM: 0, startedAt: 0,
    },
    daysSinceLast: 1,
    countLast7: 3,
    countLast14: 6,
    countLast28: 12,
    baselineWeekly: 3,
    streakDays: 0,
    relEffortLast: 0.5,
    isLongest90: false,
    isFastest90: false,
    previousGapDays: 2,
    ...overrides,
  };
}

describe("clamp", () => {
  it("bounds on both sides and passes through in range", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBeCloseTo(0.4, 6);
  });
});

describe("scoreConsistency", () => {
  it("is 0 with no activities", () => {
    expect(scoreConsistency(facts({ totalActivities: 0, daysSinceLast: null }))).toBe(0);
  });

  it("is 100 at maximum volume, maximum 4-week floor, and a full streak", () => {
    const f = facts({ countLast7: 10, baselineWeekly: 2, countLast28: 20, streakDays: 7, daysSinceLast: 0 });
    expect(scoreConsistency(f)).toBe(100);
  });

  it("caps the volume term at 150% of baseline", () => {
    const a = scoreConsistency(facts({ countLast7: 3, baselineWeekly: 2, streakDays: 0 }));
    const b = scoreConsistency(facts({ countLast7: 30, baselineWeekly: 2, streakDays: 0 }));
    expect(a).toBe(b);
  });

  it("holds recency at full strength through day 3", () => {
    const a = scoreConsistency(facts({ daysSinceLast: 0 }));
    const b = scoreConsistency(facts({ daysSinceLast: 3 }));
    expect(a).toBe(b);
  });

  it("decays after day 3 and floors at day 14", () => {
    const day3 = scoreConsistency(facts({ daysSinceLast: 3 }));
    const day8 = scoreConsistency(facts({ daysSinceLast: 8 }));
    const day14 = scoreConsistency(facts({ daysSinceLast: 14 }));
    const day40 = scoreConsistency(facts({ daysSinceLast: 40 }));
    expect(day8).toBeLessThan(day3);
    expect(day14).toBeLessThan(day8);
    expect(day40).toBe(day14); // the 0.15 floor
    expect(day14).toBeGreaterThan(0);
  });

  it("treats a baseline below 1 as 1 so a returning athlete is not inflated", () => {
    const f = facts({ countLast7: 1, baselineWeekly: 0.2, countLast28: 1, streakDays: 0 });
    expect(scoreConsistency(f)).toBeLessThan(50);
  });
});

describe("scoreCharge", () => {
  it("is 0 with no activities", () => {
    expect(scoreCharge(facts({ totalActivities: 0, daysSinceLast: null, relEffortLast: 0 }))).toBe(0);
  });

  it("matches the spec's worked examples", () => {
    expect(scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 1 }))).toBe(79);
    expect(scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 9 }))).toBe(13);
  });

  it("halves every three days", () => {
    const fresh = scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 0 }));
    const later = scoreCharge(facts({ relEffortLast: 1, daysSinceLast: 3 }));
    expect(fresh).toBe(100);
    expect(later).toBe(50);
  });

  it("scales with effort", () => {
    expect(scoreCharge(facts({ relEffortLast: 0, daysSinceLast: 0 }))).toBe(0);
    expect(scoreCharge(facts({ relEffortLast: 0.5, daysSinceLast: 0 }))).toBe(50);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/domain/axes.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/axes`.

- [ ] **Step 3: Implement `src/domain/axes.ts`**

```ts
import type { Facts } from "./activity";
import { TUNING } from "./tuning";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function scoreConsistency(f: Facts): number {
  if (f.totalActivities === 0 || f.daysSinceLast === null) return 0;

  const volumeRatio = f.countLast7 / Math.max(f.baselineWeekly, 1);
  const vol = Math.min(volumeRatio, TUNING.VOLUME_RATIO_CAP) / TUNING.VOLUME_RATIO_CAP;
  const floor28 = Math.min(f.countLast28 / TUNING.FLOOR28_TARGET, 1);
  const streakPart = Math.min(f.streakDays / TUNING.STREAK_TARGET, 1);

  const raw =
    TUNING.W_VOLUME * vol + TUNING.W_FLOOR28 * floor28 + TUNING.W_STREAK * streakPart;

  const recency = clamp(
    1 - (f.daysSinceLast - TUNING.RECENCY_GRACE_DAYS) / TUNING.RECENCY_SPAN_DAYS,
    TUNING.RECENCY_FLOOR,
    1,
  );

  return Math.round(100 * raw * recency);
}

export function scoreCharge(f: Facts): number {
  if (f.totalActivities === 0 || f.daysSinceLast === null) return 0;
  const decay = 0.5 ** (f.daysSinceLast / TUNING.CHARGE_HALF_LIFE_DAYS);
  return Math.round(100 * f.relEffortLast * decay);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/domain/axes.test.ts`
Expected: all PASS. If the "100 at maximum" test fails, check that `vol`, `floor28`, and `streakPart` each reach exactly 1 — the three weights sum to 1.00 by design.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/axes.ts test/domain/axes.test.ts
git commit -m "feat(domain): consistency and charge axis scoring"
```

---

### Task 6: The mood catalogue and deterministic quote selection

**Files:**
- Create: `src/data/moods.ts`, `src/domain/quote.ts`
- Test: `test/domain/quote.test.ts`, `test/data/moods.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Mood { id: string; name: string; accent: string; quotes: Quote[]; gifs: Gif[]; verifiedOn: string }`
  - `interface Quote { text: string; character: string }`
  - `interface Gif { url: string; alt: string; source: string; verifiedOn: string }`
  - `MOODS: Mood[]` and `MOOD_IDS` (a union type) and `getMood(id: string): Mood | undefined` from `src/data/moods.ts`
  - `fnv1a(input: string): number` and `pickQuote(mood: Mood, seed: number): { quote: Quote; gif: Gif | null }` from `src/domain/quote.ts`

**GIF sourcing — read this before starting.** Do **not** invent GIF URLs. A fabricated URL renders a broken image on a page whose whole point is looking hand-made. For each GIF: find a real hosted Ted Lasso GIF, confirm it returns HTTP 200 with an image content-type (`curl -sSI -o /dev/null -w '%{http_code} %{content_type}\n' "<url>"`), and record the date in `verifiedOn`. If a mood ends up with zero verified GIFs, ship it with `gifs: []` — `pickQuote` returns `gif: null` and Task 16 renders the designed no-GIF state. An honest empty state beats a broken image.

**Quote attributions** below are from the show. Verify each speaker before committing; misattributing a line to the wrong character is the kind of error a Ted Lasso fan spots instantly.

| Mood id | Name | Accent | Quotes (text — character) |
|---|---|---|---|
| `preseason` | Preseason | `#6B7A8F` | "I believe in hope. I believe in believe." — Ted Lasso · "Taking on a challenge is a lot like riding a horse. If you're comfortable while you're doing it, you're probably doing it wrong." — Ted Lasso · "There's two buttons I never like to hit: panic and snooze." — Ted Lasso |
| `whered-you-go` | Where'd You Go | `#8C6239` | "I feel like we fell out of the lucky tree and hit every branch on the way down." — Ted Lasso · "You know what the happiest animal in the world is? It's a goldfish. It's got a ten-second memory. Be a goldfish." — Ted Lasso · "I promise you there is something worse out there than being sad, and that's being alone and being sad." — Ted Lasso |
| `believe` | Believe | `#F2C14E` | "Believe." — AFC Richmond locker room · "It's the lack of hope that comes and gets you. I believe in hope." — Ted Lasso · "Doing the right thing is never the wrong thing." — Ted Lasso |
| `roy-kent` | Roy Kent | `#B03A2E` | "He's here, he's there, he's every-bleeping-where." — Richmond supporters · "I don't want to be lucky. I want to be good." — Roy Kent · "Be curious, not judgmental." — Ted Lasso |
| `comeback-szn` | Comeback Szn | `#2E7D6B` | "Be a goldfish." — Ted Lasso · "Every disadvantage has its advantage." — Ted Lasso · "A good mentor hopes you will move on. A great mentor knows you will." — Leslie Higgins |
| `football-is-life` | Football Is Life | `#1F7A3D` | "Football is life!" — Dani Rojas · "I think that you might be so sure that you're one in a million that sometimes you forget that out there you're just one of eleven." — Ted Lasso · "If the Lasso way is wrong, it's hard to imagine being right." — Ted Lasso |
| `gaffer-mode` | Gaffer Mode | `#34495E` | "Success is not about the wins and losses. It's about helping these young fellas be the best versions of themselves." — Ted Lasso · "I think things come into our lives to help us get from one place to a better one." — Ted Lasso · "The harder you work, the luckier you get." — Ted Lasso |
| `hopeful` | Hopeful | `#C77DBB` | "I believe in hope. I believe in believe." — Ted Lasso · "You beating yourself up is like Woody Allen playing the clarinet. I don't wanna hear it." — Ted Lasso · "Small acts of kindness never go unnoticed." — Ted Lasso |
| `biscuits` | Biscuits | `#D98B5F` | "Biscuits with the boss." — Ted Lasso · "I always figured that tea was gonna taste like hot brown water. And you know what? I was right." — Ted Lasso · "Taking a break is not the same as giving up." — Ted Lasso |

- [ ] **Step 1: Write the failing catalogue tests**

```ts
// test/data/moods.test.ts
import { describe, expect, it } from "vitest";
import { MOODS, getMood } from "../../src/data/moods";

const REQUIRED_IDS = [
  "preseason", "whered-you-go", "believe", "roy-kent", "comeback-szn",
  "football-is-life", "gaffer-mode", "hopeful", "biscuits",
];

describe("mood catalogue", () => {
  it("contains exactly the nine moods the engine can select", () => {
    expect(MOODS.map((m) => m.id).sort()).toEqual([...REQUIRED_IDS].sort());
  });

  it("has unique ids", () => {
    expect(new Set(MOODS.map((m) => m.id)).size).toBe(MOODS.length);
  });

  it("gives every mood at least three quotes", () => {
    for (const m of MOODS) expect(m.quotes.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every quote non-empty text and a named character", () => {
    for (const m of MOODS) {
      for (const q of m.quotes) {
        expect(q.text.trim().length).toBeGreaterThan(0);
        expect(q.character.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("uses a valid hex accent for every mood", () => {
    for (const m of MOODS) expect(m.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("dates every mood and every gif with an ISO day", () => {
    for (const m of MOODS) {
      expect(m.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const g of m.gifs) expect(g.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("gives every gif an https url and alt text that reads as a sentence", () => {
    for (const m of MOODS) {
      for (const g of m.gifs) {
        expect(g.url.startsWith("https://")).toBe(true);
        expect(g.alt.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("never uses forbidden record language", () => {
    const all = MOODS.flatMap((m) => m.quotes.map((q) => q.text)).join(" ").toLowerCase();
    expect(all).not.toContain("personal record");
  });

  it("resolves a known id and rejects an unknown one", () => {
    expect(getMood("believe")?.name).toBe("Believe");
    expect(getMood("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing quote-selection tests**

```ts
// test/domain/quote.test.ts
import { describe, expect, it } from "vitest";
import { MOODS, getMood } from "../../src/data/moods";
import { fnv1a, pickQuote } from "../../src/domain/quote";

describe("fnv1a", () => {
  it("is deterministic", () => {
    expect(fnv1a("believe")).toBe(fnv1a("believe"));
  });

  it("differs for different inputs", () => {
    expect(fnv1a("believe")).not.toBe(fnv1a("biscuits"));
  });

  it("returns a non-negative 32-bit integer", () => {
    for (const s of ["", "a", "1755200000000believe"]) {
      const h = fnv1a(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe("pickQuote", () => {
  const mood = getMood("believe")!;

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

  it("returns a null gif when a mood has none verified", () => {
    const empty = { ...mood, gifs: [] };
    expect(pickQuote(empty, 1).gif).toBeNull();
  });

  it("works for every mood in the catalogue", () => {
    for (const m of MOODS) {
      const picked = pickQuote(m, 12_345);
      expect(m.quotes).toContainEqual(picked.quote);
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/data/moods.test.ts test/domain/quote.test.ts`
Expected: FAIL — neither module resolves.

- [ ] **Step 4: Implement `src/data/moods.ts`**

Transcribe every row of the table above. The shape, shown with the first mood in full:

```ts
export interface Quote {
  text: string;
  character: string;
}

export interface Gif {
  url: string;
  alt: string;
  source: string;
  verifiedOn: string;
}

export interface Mood {
  id: string;
  name: string;
  accent: string;
  quotes: Quote[];
  gifs: Gif[];
  verifiedOn: string;
}

export const MOODS: Mood[] = [
  {
    id: "preseason",
    name: "Preseason",
    accent: "#6B7A8F",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "I believe in hope. I believe in believe.", character: "Ted Lasso" },
      {
        text: "Taking on a challenge is a lot like riding a horse. If you're comfortable while you're doing it, you're probably doing it wrong.",
        character: "Ted Lasso",
      },
      { text: "There's two buttons I never like to hit: panic and snooze.", character: "Ted Lasso" },
    ],
    gifs: [
      // Only verified URLs. See the sourcing note in this task.
    ],
  },
  // ...the remaining eight moods, transcribed from the table.
];

export function getMood(id: string): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}
```

- [ ] **Step 5: Source and verify the GIFs**

For each mood, find real hosted Ted Lasso GIFs and verify:

```bash
curl -sSI -o /dev/null -w '%{http_code} %{content_type}\n' "<candidate-url>"
```

Expected: `200 image/gif` (or `image/webp`). Add only URLs that pass, each with `verifiedOn: "2026-08-14"`, a `source` naming the host, and alt text of at least four words describing what happens in the GIF. Leave `gifs: []` for any mood you cannot source — do not guess a URL.

- [ ] **Step 6: Implement `src/domain/quote.ts`**

```ts
import type { Gif, Mood, Quote } from "../data/moods";

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

export function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function pickQuote(mood: Mood, seed: number): { quote: Quote; gif: Gif | null } {
  const hash = fnv1a(`${seed}${mood.id}`);
  const quote = mood.quotes[hash % mood.quotes.length] as Quote;
  const gif = mood.gifs.length > 0 ? (mood.gifs[hash % mood.gifs.length] as Gif) : null;
  return { quote, gif };
}
```

`Math.imul` is what keeps the multiply in 32-bit space; a plain `*` overflows into float territory and stops being a hash.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run test/data/moods.test.ts test/domain/quote.test.ts`
Expected: all PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/data/moods.ts src/domain/quote.ts test/data/moods.test.ts test/domain/quote.test.ts
git commit -m "feat(data): nine-mood catalogue with deterministic quote and gif selection"
```

---

### Task 7: Mood selection and reason strings

**Files:**
- Create: `src/domain/mood.ts`
- Test: `test/domain/mood.test.ts`

**Interfaces:**
- Consumes: `Facts` (Task 2), `TUNING` (Task 2).
- Produces:
  - `interface Scores { consistency: number; charge: number }`
  - `interface Selection { moodId: string; reasons: string[] }`
  - `selectMood(f: Facts, scores: Scores): Selection`

Reason strings are user-facing copy. Keep them factual and warm, never scolding, and never containing "personal record" or "PR".

- [ ] **Step 1: Write the failing tests**

```ts
// test/domain/mood.test.ts
import { describe, expect, it } from "vitest";
import type { Facts } from "../../src/domain/activity";
import { selectMood } from "../../src/domain/mood";

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    totalActivities: 10,
    last: {
      name: "Evening Run", sportType: "Run", distanceM: 8000,
      movingTimeS: 2400, elevationM: 60, startedAt: 0,
    },
    daysSinceLast: 4,
    countLast7: 2,
    countLast14: 4,
    countLast28: 8,
    baselineWeekly: 2,
    streakDays: 0,
    relEffortLast: 0.5,
    isLongest90: false,
    isFastest90: false,
    previousGapDays: 3,
    ...overrides,
  };
}

const MID = { consistency: 45, charge: 45 };

describe("override rules, in order", () => {
  it("1. no activities wins over everything", () => {
    const f = facts({ totalActivities: 0, last: null, daysSinceLast: null, isLongest90: true, streakDays: 9 });
    expect(selectMood(f, { consistency: 0, charge: 0 }).moodId).toBe("preseason");
  });

  it("2. ten or more days dormant", () => {
    expect(selectMood(facts({ daysSinceLast: 10 }), MID).moodId).toBe("whered-you-go");
  });

  it("2. exactly 10.0 days is dormant; 9.9 is not", () => {
    expect(selectMood(facts({ daysSinceLast: 10.0 }), MID).moodId).toBe("whered-you-go");
    expect(selectMood(facts({ daysSinceLast: 9.9 }), MID).moodId).not.toBe("whered-you-go");
  });

  it("3. a fresh 90-day best beats a streak", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 1, streakDays: 9 });
    expect(selectMood(f, MID).moodId).toBe("believe");
  });

  it("3. fastest also qualifies", () => {
    expect(selectMood(facts({ isFastest90: true, daysSinceLast: 2 }), MID).moodId).toBe("believe");
  });

  it("3. a stale best does not qualify", () => {
    expect(selectMood(facts({ isLongest90: true, daysSinceLast: 5 }), MID).moodId).not.toBe("believe");
  });

  it("4. a five-day streak", () => {
    expect(selectMood(facts({ streakDays: 5, daysSinceLast: 0 }), MID).moodId).toBe("roy-kent");
  });

  it("5. back within two days after a week off", () => {
    const f = facts({ daysSinceLast: 1, previousGapDays: 8, streakDays: 1 });
    expect(selectMood(f, MID).moodId).toBe("comeback-szn");
  });

  it("5. does not fire when the gap was short", () => {
    const f = facts({ daysSinceLast: 1, previousGapDays: 2, streakDays: 1 });
    expect(selectMood(f, MID).moodId).not.toBe("comeback-szn");
  });

  it("5. does not fire with no previous activity to measure a gap against", () => {
    const f = facts({ daysSinceLast: 1, previousGapDays: null });
    expect(selectMood(f, MID).moodId).not.toBe("comeback-szn");
  });
});

describe("the score grid", () => {
  const plain = facts({ daysSinceLast: 4, streakDays: 0, previousGapDays: 2 });

  it("middle band on both axes is checked first", () => {
    expect(selectMood(plain, { consistency: 45, charge: 45 }).moodId).toBe("diamond-dogs");
    expect(selectMood(plain, { consistency: 36, charge: 59 }).moodId).toBe("diamond-dogs");
  });

  it("high and high", () => {
    expect(selectMood(plain, { consistency: 80, charge: 80 }).moodId).toBe("football-is-life");
  });

  it("high consistency, low charge", () => {
    expect(selectMood(plain, { consistency: 80, charge: 20 }).moodId).toBe("gaffer-mode");
  });

  it("low consistency, high charge", () => {
    expect(selectMood(plain, { consistency: 20, charge: 80 }).moodId).toBe("hopeful");
  });

  it("low and low", () => {
    expect(selectMood(plain, { consistency: 20, charge: 20 }).moodId).toBe("biscuits");
  });

  it("treats 60 as high on both axes", () => {
    expect(selectMood(plain, { consistency: 60, charge: 60 }).moodId).toBe("football-is-life");
  });

  it("a mid consistency with a low charge is not diamond-dogs", () => {
    expect(selectMood(plain, { consistency: 45, charge: 10 }).moodId).toBe("biscuits");
  });
});

describe("reasons", () => {
  it("always returns at least one reason", () => {
    expect(selectMood(facts(), MID).reasons.length).toBeGreaterThan(0);
  });

  it("never uses record language", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 1 });
    const joined = selectMood(f, MID).reasons.join(" ").toLowerCase();
    expect(joined).not.toContain("personal record");
    expect(joined).not.toMatch(/\bpr\b/);
  });

  it("mentions the 90-day window when a best triggered the mood", () => {
    const f = facts({ isLongest90: true, daysSinceLast: 1 });
    expect(selectMood(f, MID).reasons.join(" ")).toContain("90 days");
  });

  it("reports the layoff length when dormant", () => {
    expect(selectMood(facts({ daysSinceLast: 12.4 }), MID).reasons.join(" ")).toContain("12 days");
  });

  it("compares this week against the athlete's own baseline", () => {
    const f = facts({ countLast7: 4, baselineWeekly: 2.5 });
    expect(selectMood(f, MID).reasons.join(" ")).toContain("2.5");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/domain/mood.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/mood`.

- [ ] **Step 3: Implement `src/domain/mood.ts`**

```ts
import type { Facts } from "./activity";
import { TUNING } from "./tuning";

export interface Scores {
  consistency: number;
  charge: number;
}

export interface Selection {
  moodId: string;
  reasons: string[];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Facts worth showing regardless of which rule fired. */
function commonReasons(f: Facts): string[] {
  const out: string[] = [];

  if (f.countLast7 > 0) {
    out.push(
      `${f.countLast7} ${plural(f.countLast7, "workout", "workouts")} this week, ` +
        `against your usual ${formatCount(f.baselineWeekly)}`,
    );
  }
  if (f.streakDays >= 2) {
    out.push(`${f.streakDays} days in a row`);
  }
  return out;
}

export function selectMood(f: Facts, scores: Scores): Selection {
  // 1. Nothing to go on.
  if (f.totalActivities === 0) {
    return {
      moodId: "preseason",
      reasons: ["No activities in the last 90 days — the season hasn't kicked off yet"],
    };
  }

  const days = f.daysSinceLast ?? 0;

  // 2. Dormant.
  if (days >= TUNING.DORMANT_DAYS) {
    return {
      moodId: "whered-you-go",
      reasons: [`${Math.floor(days)} days since your last activity`, ...commonReasons(f)],
    };
  }

  // 3. A fresh 90-day best.
  if ((f.isLongest90 || f.isFastest90) && days <= TUNING.RECENT_DAYS) {
    const what = f.isLongest90 ? "longest" : "fastest";
    const sport = f.last?.sportType.toLowerCase() ?? "session";
    return {
      moodId: "believe",
      reasons: [`Your ${what} ${sport} in 90 days, and it was ${days < 1 ? "today" : "just now"}`, ...commonReasons(f)],
    };
  }

  // 4. On a run of days.
  if (f.streakDays >= TUNING.STREAK_MOOD_DAYS) {
    return {
      moodId: "roy-kent",
      reasons: [`${f.streakDays} days in a row and still going`, ...commonReasons(f).slice(0, 1)],
    };
  }

  // 5. Back after a layoff.
  if (days <= TUNING.RECENT_DAYS && f.previousGapDays !== null && f.previousGapDays >= TUNING.COMEBACK_GAP_DAYS) {
    return {
      moodId: "comeback-szn",
      reasons: [
        `Back at it after ${Math.floor(f.previousGapDays)} days off`,
        ...commonReasons(f),
      ],
    };
  }

  // Grid fallback.
  const { consistency, charge } = scores;
  const inBand = (n: number): boolean => n > TUNING.GRID_LOW && n < TUNING.GRID_HIGH;
  const reasons = commonReasons(f);
  if (reasons.length === 0) reasons.push(`${Math.floor(days)} days since your last activity`);

  if (inBand(consistency) && inBand(charge)) return { moodId: "diamond-dogs", reasons };
  if (consistency >= TUNING.GRID_HIGH && charge >= TUNING.GRID_HIGH) {
    return { moodId: "football-is-life", reasons };
  }
  if (consistency >= TUNING.GRID_HIGH) return { moodId: "gaffer-mode", reasons };
  if (charge >= TUNING.GRID_HIGH) return { moodId: "hopeful", reasons };
  return { moodId: "biscuits", reasons };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/domain/mood.test.ts`
Expected: all PASS. If the "exactly 10.0 days" test fails, the comparison must be `>=`, not `>`.

- [ ] **Step 5: Run the whole domain suite with coverage**

Run: `npx vitest run --coverage`
Expected: PASS with branch coverage at or above 95% for `src/domain` and `src/data`. If a branch is uncovered, add the missing fixture — do not lower the threshold.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/mood.ts test/domain/mood.test.ts
git commit -m "feat(domain): mood selection via ordered overrides then score grid"
```

---

### Task 8: Polyline decoding and the privacy trim

The privacy trim is the single most safety-relevant function in the repo. Its tests are not optional.

**Files:**
- Create: `src/domain/route.ts` (decode and trim only; Task 9 adds the rest)
- Test: `test/domain/route-decode.test.ts`

**Interfaces:**
- Consumes: `TUNING` (Task 2).
- Produces:
  - `interface LatLng { lat: number; lng: number }`
  - `decodePolyline(encoded: string): LatLng[]`
  - `haversineM(a: LatLng, b: LatLng): number`
  - `privacyTrim(points: LatLng[], trimM: number): LatLng[]`

- [ ] **Step 1: Write the failing tests**

```ts
// test/domain/route-decode.test.ts
import { describe, expect, it } from "vitest";
import { decodePolyline, haversineM, privacyTrim } from "../../src/domain/route";
import type { LatLng } from "../../src/domain/route";

describe("decodePolyline", () => {
  it("decodes the canonical example from Google's documentation", () => {
    // "_p~iF~ps|U_ulLnnqC_mqNvxq`@" -> (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0]!.lat).toBeCloseTo(38.5, 5);
    expect(points[0]!.lng).toBeCloseTo(-120.2, 5);
    expect(points[1]!.lat).toBeCloseTo(40.7, 5);
    expect(points[1]!.lng).toBeCloseTo(-120.95, 5);
    expect(points[2]!.lat).toBeCloseTo(43.252, 5);
    expect(points[2]!.lng).toBeCloseTo(-126.453, 5);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("haversineM", () => {
  it("is zero for identical points", () => {
    expect(haversineM({ lat: 37.77, lng: -122.42 }, { lat: 37.77, lng: -122.42 })).toBe(0);
  });

  it("measures roughly 111km per degree of latitude", () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("is symmetric", () => {
    const a = { lat: 37.77, lng: -122.42 };
    const b = { lat: 37.80, lng: -122.40 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

/** A straight south-to-north line of `n` points spaced ~11.1m apart. */
function line(n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 37.7 + i * 0.0001, lng: -122.4 }));
}

describe("privacyTrim", () => {
  it("removes at least trimM from the start", () => {
    const pts = line(200); // ~2.2km
    const trimmed = privacyTrim(pts, 250);
    expect(haversineM(pts[0]!, trimmed[0]!)).toBeGreaterThanOrEqual(250);
  });

  it("removes at least trimM from the end", () => {
    const pts = line(200);
    const trimmed = privacyTrim(pts, 250);
    expect(haversineM(pts[pts.length - 1]!, trimmed[trimmed.length - 1]!)).toBeGreaterThanOrEqual(250);
  });

  it("keeps the middle of a long route", () => {
    const pts = line(200);
    expect(privacyTrim(pts, 250).length).toBeGreaterThan(100);
  });

  it("trims both ends of an out-and-back that starts and ends at the same point", () => {
    const out = line(100);
    const back = [...out].reverse().slice(1);
    const loop = [...out, ...back];
    const trimmed = privacyTrim(loop, 250);
    expect(trimmed.length).toBeGreaterThan(1);
    expect(haversineM(loop[0]!, trimmed[0]!)).toBeGreaterThanOrEqual(250);
    expect(haversineM(loop[loop.length - 1]!, trimmed[trimmed.length - 1]!)).toBeGreaterThanOrEqual(250);
  });

  it("returns fewer than two points when the route is shorter than twice the trim", () => {
    expect(privacyTrim(line(20), 250).length).toBeLessThan(2); // ~220m total
  });

  it("returns an empty array for an empty input", () => {
    expect(privacyTrim([], 250)).toEqual([]);
  });

  it("passes the route through untouched when trimM is 0", () => {
    const pts = line(50);
    expect(privacyTrim(pts, 0)).toEqual(pts);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/domain/route-decode.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/route`.

- [ ] **Step 3: Implement the first half of `src/domain/route.ts`**

```ts
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Google encoded polyline algorithm, precision 5. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const axis of ["lat", "lng"] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === "lat") lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Drop points from both ends until each end is at least `trimM` from the
 * original endpoint. Measured as straight-line distance FROM THE ORIGINAL
 * ENDPOINT, not cumulative path length — an out-and-back route would otherwise
 * satisfy a cumulative check while still ending at the athlete's front door.
 */
export function privacyTrim(points: LatLng[], trimM: number): LatLng[] {
  if (trimM <= 0 || points.length === 0) return points;

  const first = points[0] as LatLng;
  let start = 0;
  while (start < points.length && haversineM(first, points[start] as LatLng) < trimM) {
    start++;
  }

  const last = points[points.length - 1] as LatLng;
  let end = points.length - 1;
  while (end >= start && haversineM(last, points[end] as LatLng) < trimM) {
    end--;
  }

  return points.slice(start, end + 1);
}
```

The comment on `privacyTrim` explains the one decision a reviewer is most likely to want to "simplify" into a bug. Leave it in.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/domain/route-decode.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/route.ts test/domain/route-decode.test.ts
git commit -m "feat(domain): polyline decoding and endpoint privacy trim"
```

---

### Task 9: Simplify, project, and build the route render

**Files:**
- Modify: `src/domain/route.ts` (append)
- Test: `test/domain/route-render.test.ts`

**Interfaces:**
- Consumes: `LatLng`, `decodePolyline`, `haversineM`, `privacyTrim` (Task 8); `Activity` (Task 2); `TUNING` (Task 2).
- Produces:
  - `interface XY { x: number; y: number }`
  - `simplify(points: LatLng[], epsilonDeg: number): LatLng[]`
  - `simplifyToCap(points: LatLng[]): LatLng[]` — raises epsilon until the result fits `TUNING.MAX_ROUTE_POINTS`
  - `project(points: LatLng[]): XY[]`
  - `toPath(points: XY[]): { pathD: string; viewBox: string }`
  - `interface RouteRender { pathD: string; viewBox: string; distanceM: number; elevationM: number; sportType: string; locationLabel: string | null }`
  - `buildRoute(activity: Activity, trimM: number): RouteRender | null` — the single entry point Task 12 calls

- [ ] **Step 1: Write the failing tests**

```ts
// test/domain/route-render.test.ts
import { describe, expect, it } from "vitest";
import { buildRoute, project, simplify, simplifyToCap, toPath } from "../../src/domain/route";
import type { LatLng } from "../../src/domain/route";
import { makeActivity } from "../fixtures/activities";

const REAL_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

function line(n: number, step = 0.0001): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 37.7 + i * step, lng: -122.4 }));
}

describe("simplify", () => {
  it("collapses collinear points", () => {
    expect(simplify(line(50), 0.00001).length).toBeLessThan(50);
  });

  it("keeps the first and last points", () => {
    const pts = line(50);
    const out = simplify(pts, 0.00001);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("returns short inputs unchanged", () => {
    const pts = line(2);
    expect(simplify(pts, 0.001)).toEqual(pts);
  });

  it("preserves a genuine corner", () => {
    const corner: LatLng[] = [
      { lat: 37.70, lng: -122.40 },
      { lat: 37.75, lng: -122.40 },
      { lat: 37.75, lng: -122.35 },
    ];
    expect(simplify(corner, 0.0001)).toHaveLength(3);
  });
});

describe("project", () => {
  it("scales longitude by cos(latitude) so high-latitude routes are not stretched", () => {
    // One degree of longitude at 60N covers about half the ground distance of
    // one degree of latitude, so x must span about half of y.
    const square: LatLng[] = [
      { lat: 60.0, lng: 0.0 },
      { lat: 61.0, lng: 0.0 },
      { lat: 61.0, lng: 1.0 },
    ];
    const xy = project(square);
    const spanX = Math.max(...xy.map((p) => p.x)) - Math.min(...xy.map((p) => p.x));
    const spanY = Math.max(...xy.map((p) => p.y)) - Math.min(...xy.map((p) => p.y));
    expect(spanX / spanY).toBeCloseTo(0.5, 1);
  });

  it("flips the y axis so north is up in SVG coordinates", () => {
    const xy = project([{ lat: 37.7, lng: -122.4 }, { lat: 37.8, lng: -122.4 }]);
    expect(xy[1]!.y).toBeLessThan(xy[0]!.y); // the northern point has the smaller y
  });
});

describe("toPath", () => {
  it("emits a moveto followed by linetos", () => {
    const { pathD } = toPath(project(line(5)));
    expect(pathD.startsWith("M")).toBe(true);
    expect((pathD.match(/L/g) ?? []).length).toBe(4);
  });

  it("emits a viewBox containing only finite numbers", () => {
    const { viewBox } = toPath(project(line(5)));
    const parts = viewBox.split(" ").map(Number);
    expect(parts).toHaveLength(4);
    for (const n of parts) expect(Number.isFinite(n)).toBe(true);
  });

  it("rounds coordinates so the path stays small", () => {
    const { pathD } = toPath(project(line(5)));
    expect(pathD).not.toMatch(/\d\.\d{3}/); // at most two decimal places
  });
});

describe("buildRoute", () => {
  it("returns null when the activity has no polyline", () => {
    expect(buildRoute(makeActivity({ summaryPolyline: null }), 250)).toBeNull();
  });

  it("returns null when the trim consumes the whole route", () => {
    // The canonical polyline spans hundreds of km, so trim by more than that.
    expect(buildRoute(makeActivity({ summaryPolyline: REAL_POLYLINE }), 10_000_000)).toBeNull();
  });

  it("builds a path from a real polyline", () => {
    const route = buildRoute(
      makeActivity({ summaryPolyline: REAL_POLYLINE, distanceM: 8000, elevationM: 120, sportType: "Ride" }),
      0,
    );
    expect(route).not.toBeNull();
    expect(route!.pathD.startsWith("M")).toBe(true);
    expect(route!.distanceM).toBe(8000);
    expect(route!.elevationM).toBe(120);
    expect(route!.sportType).toBe("Ride");
    expect(route!.locationLabel).toBeNull();
  });

  it("carries a location label through when Strava supplied one", () => {
    const route = buildRoute(
      makeActivity({ summaryPolyline: REAL_POLYLINE, locationLabel: "San Francisco" }),
      0,
    );
    expect(route!.locationLabel).toBe("San Francisco");
  });

  it("never exceeds the point cap, however dense the input", () => {
    // 5,000 wiggly points must come out under MAX_ROUTE_POINTS (300).
    const dense: LatLng[] = Array.from({ length: 5000 }, (_, i) => ({
      lat: 37.7 + i * 0.00002,
      lng: -122.4 + Math.sin(i / 40) * 0.01,
    }));
    const { pathD } = toPath(project(simplifyToCap(dense)));
    const commands = (pathD.match(/[ML]/g) ?? []).length;
    expect(commands).toBeGreaterThan(2);
    expect(commands).toBeLessThanOrEqual(300);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/domain/route-render.test.ts`
Expected: FAIL — the new exports do not exist.

- [ ] **Step 3: Append to `src/domain/route.ts`**

```ts
import type { Activity } from "./activity";
import { TUNING } from "./tuning";

export interface XY {
  x: number;
  y: number;
}

export interface RouteRender {
  pathD: string;
  viewBox: string;
  distanceM: number;
  elevationM: number;
  sportType: string;
  locationLabel: string | null;
}

/** Perpendicular distance from `p` to the segment `a`–`b`, in degrees. */
function perpendicularDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.hypot(p.lng - a.lng, p.lat - a.lat);
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
  const clamped = Math.min(1, Math.max(0, t));
  return Math.hypot(p.lng - (a.lng + clamped * dx), p.lat - (a.lat + clamped * dy));
}

/** Ramer–Douglas–Peucker. Iterative, so a long route cannot blow the stack. */
export function simplify(points: LatLng[], epsilonDeg: number): LatLng[] {
  if (points.length <= 2) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDist = 0;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i] as LatLng, points[start] as LatLng, points[end] as LatLng);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDist > epsilonDeg) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Reduce to at most TUNING.MAX_ROUTE_POINTS by increasing epsilon until it fits. */
export function simplifyToCap(points: LatLng[]): LatLng[] {
  let epsilon = 0.00001;
  let out = simplify(points, epsilon);
  while (out.length > TUNING.MAX_ROUTE_POINTS && epsilon < 1) {
    epsilon *= 2;
    out = simplify(points, epsilon);
  }
  return out;
}

export function project(points: LatLng[]): XY[] {
  if (points.length === 0) return [];
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const scale = Math.cos((meanLat * Math.PI) / 180);
  // Negate latitude: SVG y grows downward, and north should be up.
  return points.map((p) => ({ x: p.lng * scale, y: -p.lat }));
}

export function toPath(points: XY[]): { pathD: string; viewBox: string } {
  const size = TUNING.ROUTE_VIEWBOX;
  const pad = TUNING.ROUTE_PADDING;
  const inner = size - pad * 2;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  // A single uniform scale for both axes keeps the route's real proportions.
  const scale = Math.min(spanX > 0 ? inner / spanX : Infinity, spanY > 0 ? inner / spanY : Infinity);
  const usable = Number.isFinite(scale) ? scale : 1;

  const offsetX = pad + (inner - spanX * usable) / 2;
  const offsetY = pad + (inner - spanY * usable) / 2;

  const round = (n: number): string => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");

  const d = points
    .map((p, i) => {
      const x = round(offsetX + (p.x - minX) * usable);
      const y = round(offsetY + (p.y - minY) * usable);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");

  return { pathD: d, viewBox: `0 0 ${size} ${size}` };
}

export function buildRoute(activity: Activity, trimM: number): RouteRender | null {
  if (!activity.summaryPolyline) return null;

  const decoded = decodePolyline(activity.summaryPolyline);
  const trimmed = privacyTrim(decoded, trimM);
  if (trimmed.length < 2) return null;

  const { pathD, viewBox } = toPath(project(simplifyToCap(trimmed)));

  return {
    pathD,
    viewBox,
    distanceM: activity.distanceM,
    elevationM: activity.elevationM,
    sportType: activity.sportType,
    locationLabel: activity.locationLabel,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/domain/route-render.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run the full domain suite with coverage**

Run: `npx vitest run --coverage`
Expected: PASS, branch coverage at or above 95%.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/route.ts test/domain/route-render.test.ts
git commit -m "feat(domain): simplify, project, and render routes as svg path data"
```

---

## Phase 3 — Infrastructure

### Task 10: KV store

**Files:**
- Create: `src/types.ts`, `src/infrastructure/store/kv.ts`
- Test: `test/infrastructure/kv.test.ts`

**Interfaces:**
- Consumes: `LastActivity` (Task 2), `RouteRender` (Task 9).
- Produces:
  - `interface Snapshot`, `interface Health`, `interface PublicFacts` in `src/types.ts`
  - `class KvStore` with: `getRefreshToken`, `putRefreshToken`, `getSnapshot`, `putSnapshot`, `getHealth`, `putHealth`, `getLastManualRefreshAt`, `putLastManualRefreshAt`, `putOAuthState`, `consumeOAuthState`

- [ ] **Step 1: Write `src/types.ts`**

```ts
import type { LastActivity } from "./domain/activity";
import type { RouteRender } from "./domain/route";

export interface PublicFacts {
  last: LastActivity | null;
  daysSinceLast: number | null;
  countLast7: number;
  baselineWeekly: number;
  streakDays: number;
  totalActivities: number;
}

export interface Snapshot {
  version: 1;
  refreshedAt: number;
  mood: { id: string; name: string; accent: string };
  quote: { text: string; character: string };
  gif: { url: string; alt: string } | null;
  scores: { consistency: number; charge: number };
  reasons: string[];
  facts: PublicFacts;
  route: RouteRender | null;
}

export interface Health {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  needsReauth: boolean;
}

export const EMPTY_HEALTH: Health = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  needsReauth: false,
};
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/infrastructure/kv.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { KvStore } from "../../src/infrastructure/store/kv";
import type { Snapshot } from "../../src/types";

const store = (): KvStore => new KvStore((env as never as { STORE: KVNamespace }).STORE);

function snapshot(): Snapshot {
  return {
    version: 1,
    refreshedAt: 1_755_200_000_000,
    mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
    quote: { text: "Believe.", character: "AFC Richmond locker room" },
    gif: null,
    scores: { consistency: 70, charge: 60 },
    reasons: ["3 workouts this week, against your usual 2"],
    facts: {
      last: null, daysSinceLast: 1, countLast7: 3,
      baselineWeekly: 2, streakDays: 1, totalActivities: 12,
    },
    route: null,
  };
}

describe("KvStore", () => {
  let s: KvStore;
  beforeEach(async () => {
    s = store();
    const kv = (env as never as { STORE: KVNamespace }).STORE;
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv.delete(key);
    }
  });

  it("round-trips the refresh token", async () => {
    expect(await s.getRefreshToken()).toBeNull();
    await s.putRefreshToken("tok-1");
    expect(await s.getRefreshToken()).toBe("tok-1");
  });

  it("round-trips a snapshot", async () => {
    expect(await s.getSnapshot()).toBeNull();
    await s.putSnapshot(snapshot());
    expect(await s.getSnapshot()).toEqual(snapshot());
  });

  it("returns an empty health record before any attempt", async () => {
    const h = await s.getHealth();
    expect(h.needsReauth).toBe(false);
    expect(h.lastSuccessAt).toBeNull();
  });

  it("round-trips health", async () => {
    await s.putHealth({ lastAttemptAt: 5, lastSuccessAt: 4, lastError: "boom", needsReauth: true });
    expect((await s.getHealth()).needsReauth).toBe(true);
    expect((await s.getHealth()).lastError).toBe("boom");
  });

  it("round-trips the manual refresh timestamp", async () => {
    expect(await s.getLastManualRefreshAt()).toBeNull();
    await s.putLastManualRefreshAt(1234);
    expect(await s.getLastManualRefreshAt()).toBe(1234);
  });

  it("consumes an oauth state exactly once", async () => {
    await s.putOAuthState("nonce-1");
    expect(await s.consumeOAuthState("nonce-1")).toBe(true);
    expect(await s.consumeOAuthState("nonce-1")).toBe(false);
  });

  it("rejects an unknown oauth state", async () => {
    expect(await s.consumeOAuthState("never-issued")).toBe(false);
  });

  it("tolerates corrupt snapshot json rather than throwing", async () => {
    await (env as never as { STORE: KVNamespace }).STORE.put("snapshot/current", "{not json");
    expect(await s.getSnapshot()).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/infrastructure/kv.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 4: Implement `src/infrastructure/store/kv.ts`**

```ts
import { TUNING } from "../../domain/tuning";
import { EMPTY_HEALTH, type Health, type Snapshot } from "../../types";

const KEY = {
  token: "token/refresh",
  snapshot: "snapshot/current",
  health: "health",
  lastManual: "refresh/lastAt",
  state: (nonce: string) => `oauth/state/${nonce}`,
} as const;

export class KvStore {
  constructor(private readonly kv: KVNamespace) {}

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key, "text");
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt value must not take the page down. Treat it as absent.
      return null;
    }
  }

  getRefreshToken(): Promise<string | null> {
    return this.kv.get(KEY.token, "text");
  }

  async putRefreshToken(token: string): Promise<void> {
    await this.kv.put(KEY.token, token);
  }

  getSnapshot(): Promise<Snapshot | null> {
    return this.getJson<Snapshot>(KEY.snapshot);
  }

  async putSnapshot(snapshot: Snapshot): Promise<void> {
    await this.kv.put(KEY.snapshot, JSON.stringify(snapshot));
  }

  async getHealth(): Promise<Health> {
    return (await this.getJson<Health>(KEY.health)) ?? { ...EMPTY_HEALTH };
  }

  async putHealth(health: Health): Promise<void> {
    await this.kv.put(KEY.health, JSON.stringify(health));
  }

  async getLastManualRefreshAt(): Promise<number | null> {
    const raw = await this.kv.get(KEY.lastManual, "text");
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async putLastManualRefreshAt(epochMs: number): Promise<void> {
    await this.kv.put(KEY.lastManual, String(epochMs));
  }

  async putOAuthState(nonce: string): Promise<void> {
    await this.kv.put(KEY.state(nonce), "1", { expirationTtl: TUNING.OAUTH_STATE_TTL_S });
  }

  /** True only on the first call for a given nonce. */
  async consumeOAuthState(nonce: string): Promise<boolean> {
    const found = await this.kv.get(KEY.state(nonce), "text");
    if (found === null) return false;
    await this.kv.delete(KEY.state(nonce));
    return true;
  }
}
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `npx vitest run test/infrastructure/kv.test.ts && npm run typecheck`
Expected: all PASS, no type errors.

```bash
git add src/types.ts src/infrastructure/store/kv.ts test/infrastructure/kv.test.ts
git commit -m "feat(infra): kv store for tokens, snapshots, health, and oauth state"
```

---

### Task 11: Strava client and response mapping

**Files:**
- Create: `src/infrastructure/strava/map.ts`, `src/infrastructure/strava/client.ts`
- Test: `test/infrastructure/strava.test.ts`

**Interfaces:**
- Consumes: `Activity` (Task 2), `TUNING` (Task 2).
- Produces:
  - `mapActivity(raw: unknown): Activity | null` from `map.ts` — returns `null` for records missing required fields rather than throwing
  - `class StravaAuthError extends Error` — thrown on 4xx from either token endpoint
  - `class StravaRateLimitError extends Error` — thrown on 429
  - `interface TokenResult { accessToken: string; refreshToken: string; expiresAt: number; athleteId: number | null }`
  - `class StravaClient` with `refresh(refreshToken)`, `exchangeCode(code, redirectUri)`, `listActivities(accessToken, afterEpochSeconds)`

The constructor takes a `fetch` implementation so tests inject a fake. There is no network access in unit tests and none is wanted.

- [ ] **Step 1: Write the failing tests**

```ts
// test/infrastructure/strava.test.ts
import { describe, expect, it } from "vitest";
import { mapActivity } from "../../src/infrastructure/strava/map";
import {
  StravaAuthError,
  StravaClient,
  StravaRateLimitError,
} from "../../src/infrastructure/strava/client";

const RAW = {
  id: 42,
  name: "Morning Ride",
  sport_type: "Ride",
  distance: 24_300.5,
  moving_time: 3600,
  total_elevation_gain: 210,
  average_speed: 6.75,
  suffer_score: 88,
  start_date: "2026-08-13T15:04:05Z",
  map: { summary_polyline: "abc", id: "m1", resource_state: 2 },
  location_city: "San Francisco",
  location_state: "CA",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("mapActivity", () => {
  it("maps every field the domain needs", () => {
    const a = mapActivity(RAW)!;
    expect(a.id).toBe(42);
    expect(a.sportType).toBe("Ride");
    expect(a.distanceM).toBe(24_300.5);
    expect(a.movingTimeS).toBe(3600);
    expect(a.elevationM).toBe(210);
    expect(a.averageSpeed).toBe(6.75);
    expect(a.sufferScore).toBe(88);
    expect(a.startedAt).toBe(Date.parse("2026-08-13T15:04:05Z"));
    expect(a.summaryPolyline).toBe("abc");
    expect(a.locationLabel).toBe("San Francisco, CA");
  });

  it("treats a missing suffer_score as null rather than zero", () => {
    const { suffer_score, ...rest } = RAW;
    expect(mapActivity(rest)!.sufferScore).toBeNull();
  });

  it("treats a null polyline as null", () => {
    expect(mapActivity({ ...RAW, map: { summary_polyline: null } })!.summaryPolyline).toBeNull();
  });

  it("tolerates a missing map object entirely", () => {
    const { map, ...rest } = RAW;
    expect(mapActivity(rest)!.summaryPolyline).toBeNull();
  });

  it("omits the location label when Strava sends nulls", () => {
    expect(mapActivity({ ...RAW, location_city: null, location_state: null })!.locationLabel).toBeNull();
  });

  it("uses the city alone when the state is missing", () => {
    expect(mapActivity({ ...RAW, location_state: null })!.locationLabel).toBe("San Francisco");
  });

  it("returns null for a record missing a start date", () => {
    const { start_date, ...rest } = RAW;
    expect(mapActivity(rest)).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(mapActivity("nope")).toBeNull();
    expect(mapActivity(null)).toBeNull();
  });
});

describe("StravaClient.refresh", () => {
  it("posts the refresh grant and returns the rotated token", async () => {
    let seen: Request | null = null;
    const client = new StravaClient("cid", "secret", async (input, init) => {
      seen = new Request(input as string, init);
      return jsonResponse({
        access_token: "acc-2", refresh_token: "ref-2", expires_at: 1_755_300_000,
      });
    });

    const result = await client.refresh("ref-1");
    expect(result.accessToken).toBe("acc-2");
    expect(result.refreshToken).toBe("ref-2");
    expect(result.expiresAt).toBe(1_755_300_000);

    const body = await seen!.text();
    expect(seen!.method).toBe("POST");
    expect(seen!.url).toBe("https://www.strava.com/oauth/token");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=ref-1");
    expect(body).toContain("client_id=cid");
  });

  it("throws StravaAuthError on a 400", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({ message: "Bad" }, 400));
    await expect(client.refresh("dead")).rejects.toBeInstanceOf(StravaAuthError);
  });

  it("throws StravaAuthError on a 401", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 401));
    await expect(client.refresh("dead")).rejects.toBeInstanceOf(StravaAuthError);
  });

  it("throws StravaRateLimitError on a 429", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 429));
    await expect(client.refresh("t")).rejects.toBeInstanceOf(StravaRateLimitError);
  });
});

describe("StravaClient.exchangeCode", () => {
  it("returns the athlete id so the caller can verify ownership", async () => {
    const client = new StravaClient("cid", "secret", async () =>
      jsonResponse({
        access_token: "a", refresh_token: "r", expires_at: 1,
        athlete: { id: 99_887_766 },
      }),
    );
    expect((await client.exchangeCode("code-1", "https://x/cb")).athleteId).toBe(99_887_766);
  });

  it("returns a null athlete id when Strava omits the athlete", async () => {
    const client = new StravaClient("cid", "secret", async () =>
      jsonResponse({ access_token: "a", refresh_token: "r", expires_at: 1 }),
    );
    expect((await client.exchangeCode("c", "https://x/cb")).athleteId).toBeNull();
  });
});

describe("StravaClient.listActivities", () => {
  it("sends the bearer token and an epoch-seconds after parameter", async () => {
    let url = "";
    let auth = "";
    const client = new StravaClient("cid", "secret", async (input, init) => {
      const req = new Request(input as string, init);
      url = req.url;
      auth = req.headers.get("authorization") ?? "";
      return jsonResponse([]);
    });

    await client.listActivities("acc", 1_747_000_000);
    expect(auth).toBe("Bearer acc");
    expect(url).toContain("after=1747000000");
    expect(url).toContain("per_page=200");
    expect(url).not.toContain("1747000000000"); // must not be milliseconds
  });

  it("stops paging when a page comes back short", async () => {
    let calls = 0;
    const client = new StravaClient("cid", "secret", async () => {
      calls++;
      return jsonResponse([RAW]);
    });
    await client.listActivities("acc", 1);
    expect(calls).toBe(1);
  });

  it("fetches a second page when the first is full, and stops at the cap", async () => {
    let calls = 0;
    const full = Array.from({ length: 200 }, (_, i) => ({ ...RAW, id: i }));
    const client = new StravaClient("cid", "secret", async () => {
      calls++;
      return jsonResponse(full);
    });
    const activities = await client.listActivities("acc", 1);
    expect(calls).toBe(2); // MAX_PAGES
    expect(activities).toHaveLength(400);
  });

  it("skips unmappable records instead of failing the whole fetch", async () => {
    const client = new StravaClient("cid", "secret", async () =>
      jsonResponse([RAW, { id: 7 }, RAW]),
    );
    expect(await client.listActivities("acc", 1)).toHaveLength(2);
  });

  it("throws StravaRateLimitError on a 429", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 429));
    await expect(client.listActivities("acc", 1)).rejects.toBeInstanceOf(StravaRateLimitError);
  });

  it("throws StravaAuthError on a 401", async () => {
    const client = new StravaClient("cid", "secret", async () => jsonResponse({}, 401));
    await expect(client.listActivities("acc", 1)).rejects.toBeInstanceOf(StravaAuthError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/infrastructure/strava.test.ts`
Expected: FAIL — modules do not resolve.

- [ ] **Step 3: Implement `src/infrastructure/strava/map.ts`**

```ts
import type { Activity } from "../../domain/activity";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function locationLabel(raw: Record<string, unknown>): string | null {
  const city = str(raw.location_city);
  const state = str(raw.location_state);
  if (city && state) return `${city}, ${state}`;
  return city ?? state ?? null;
}

/** Returns null for records the domain cannot use, rather than throwing. */
export function mapActivity(raw: unknown): Activity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const startedAt = typeof r.start_date === "string" ? Date.parse(r.start_date) : NaN;
  if (!Number.isFinite(startedAt)) return null;

  const map = (typeof r.map === "object" && r.map !== null ? r.map : {}) as Record<string, unknown>;

  return {
    id: num(r.id),
    name: str(r.name) ?? "Untitled activity",
    sportType: str(r.sport_type) ?? str(r.type) ?? "Workout",
    distanceM: num(r.distance),
    movingTimeS: num(r.moving_time),
    elevationM: num(r.total_elevation_gain),
    averageSpeed: num(r.average_speed),
    sufferScore: typeof r.suffer_score === "number" ? r.suffer_score : null,
    startedAt,
    summaryPolyline: str(map.summary_polyline),
    locationLabel: locationLabel(r),
  };
}
```

- [ ] **Step 4: Implement `src/infrastructure/strava/client.ts`**

```ts
import type { Activity } from "../../domain/activity";
import { TUNING } from "../../domain/tuning";
import { mapActivity } from "./map";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

export class StravaAuthError extends Error {}
export class StravaRateLimitError extends Error {}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class StravaClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private static assertOk(status: number, context: string): void {
    if (status === 429) throw new StravaRateLimitError(`${context}: rate limited`);
    if (status >= 400 && status < 500) throw new StravaAuthError(`${context}: ${status}`);
    if (!(status >= 200 && status < 300)) throw new Error(`${context}: ${status}`);
  }

  private async token(params: Record<string, string>, context: string): Promise<TokenResult> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      ...params,
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    StravaClient.assertOk(res.status, context);

    const json = (await res.json()) as Record<string, unknown>;
    const athlete = (typeof json.athlete === "object" && json.athlete !== null
      ? json.athlete
      : {}) as Record<string, unknown>;

    return {
      accessToken: String(json.access_token ?? ""),
      refreshToken: String(json.refresh_token ?? ""),
      expiresAt: Number(json.expires_at ?? 0),
      athleteId: typeof athlete.id === "number" ? athlete.id : null,
    };
  }

  refresh(refreshToken: string): Promise<TokenResult> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, "token refresh");
  }

  exchangeCode(code: string, redirectUri: string): Promise<TokenResult> {
    return this.token(
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      "code exchange",
    );
  }

  /** `afterEpochSeconds` is SECONDS. Passing milliseconds returns an empty list. */
  async listActivities(accessToken: string, afterEpochSeconds: number): Promise<Activity[]> {
    const activities: Activity[] = [];

    for (let page = 1; page <= TUNING.MAX_PAGES; page++) {
      const url = `${ACTIVITIES_URL}?after=${afterEpochSeconds}&per_page=${TUNING.PER_PAGE}&page=${page}`;
      const res = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      StravaClient.assertOk(res.status, "activity fetch");

      const body = (await res.json()) as unknown;
      const rows = Array.isArray(body) ? body : [];
      for (const row of rows) {
        const mapped = mapActivity(row);
        if (mapped) activities.push(mapped);
      }
      if (rows.length < TUNING.PER_PAGE) break;
    }

    return activities;
  }
}
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `npx vitest run test/infrastructure/strava.test.ts && npm run typecheck`
Expected: all PASS.

```bash
git add src/infrastructure/strava/ test/infrastructure/strava.test.ts
git commit -m "feat(infra): strava client with token rotation and activity mapping"
```

---

## Phase 4 — Application

### Task 12: The refresh orchestration

This task encodes the three safety properties from spec §3.3. Its tests are the ones that stop a bad refactor from bricking the site.

**Files:**
- Create: `src/app/refresh.ts`
- Test: `test/app/refresh.test.ts`

**Interfaces:**
- Consumes: `KvStore` (Task 10), `StravaClient`/`StravaAuthError`/`StravaRateLimitError` (Task 11), `deriveFacts` (Tasks 3–4), `scoreConsistency`/`scoreCharge` (Task 5), `selectMood` (Task 7), `getMood`/`MOODS` (Task 6), `pickQuote` (Task 6), `buildRoute` (Task 9), `Snapshot`/`Health` (Task 10), `TUNING`/`DAY_MS` (Task 2).
- Produces:
  - `interface RefreshDeps { store: KvStore; strava: StravaClient; tz: string; privacyTrimM: number }`
  - `type RefreshResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: "no-token" | "auth" | "rate-limit" | "error"; message: string }`
  - `runRefresh(deps: RefreshDeps, nowMs: number): Promise<RefreshResult>`

Task 14 calls this from both the cron handler and `POST /api/refresh`. Task 13 calls it after a successful OAuth callback.

- [ ] **Step 1: Write the failing tests**

```ts
// test/app/refresh.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runRefresh } from "../../src/app/refresh";
import { KvStore } from "../../src/infrastructure/store/kv";
import { StravaClient } from "../../src/infrastructure/strava/client";
import type { Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");
const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

const ACTIVITY = {
  id: 1, name: "Morning Run", sport_type: "Run", distance: 8000,
  moving_time: 2400, total_elevation_gain: 50, average_speed: 3.3,
  suffer_score: 60, start_date: "2026-08-14T14:00:00Z",
  map: { summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
  location_city: "San Francisco", location_state: "CA",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A client whose token endpoint succeeds and whose activity endpoint returns `activities`. */
function happyClient(activities: unknown[] = [ACTIVITY], onToken?: () => void): StravaClient {
  return new StravaClient("cid", "sec", async (input) => {
    if (input.startsWith("https://www.strava.com/oauth/token")) {
      onToken?.();
      return json({ access_token: "acc-new", refresh_token: "ref-new", expires_at: 1 });
    }
    return json(activities);
  });
}

function deps(strava: StravaClient) {
  return { store: new KvStore(kv()), strava, tz: "America/Los_Angeles", privacyTrimM: 250 };
}

async function seedSnapshot(): Promise<Snapshot> {
  const existing: Snapshot = {
    version: 1, refreshedAt: 1, mood: { id: "biscuits", name: "Biscuits", accent: "#D98B5F" },
    quote: { text: "Biscuits with the boss.", character: "Ted Lasso" }, gif: null,
    scores: { consistency: 1, charge: 1 }, reasons: ["seeded"],
    facts: { last: null, daysSinceLast: null, countLast7: 0, baselineWeekly: 0, streakDays: 0, totalActivities: 0 },
    route: null,
  };
  await new KvStore(kv()).putSnapshot(existing);
  return existing;
}

describe("runRefresh", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv().delete(key);
    }
  });

  it("fails cleanly when no token has been stored yet", async () => {
    const result = await runRefresh(deps(happyClient()), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-token");
    expect(await new KvStore(kv()).getSnapshot()).toBeNull();
  });

  it("writes the rotated refresh token BEFORE fetching activities", async () => {
    const order: string[] = [];
    const store = new KvStore(kv());
    await store.putRefreshToken("ref-old");

    const strava = new StravaClient("cid", "sec", async (input) => {
      if (input.startsWith("https://www.strava.com/oauth/token")) {
        return json({ access_token: "acc", refresh_token: "ref-new", expires_at: 1 });
      }
      order.push(`activities:token=${await store.getRefreshToken()}`);
      return json([ACTIVITY]);
    });

    await runRefresh(deps(strava), NOW);
    expect(order).toEqual(["activities:token=ref-new"]);
  });

  it("writes a snapshot on success", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    const result = await runRefresh(deps(happyClient()), NOW);

    expect(result.ok).toBe(true);
    const stored = await new KvStore(kv()).getSnapshot();
    expect(stored).not.toBeNull();
    expect(stored!.refreshedAt).toBe(NOW);
    expect(stored!.version).toBe(1);
    expect(stored!.facts.totalActivities).toBe(1);
  });

  it("records success in health", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient()), NOW);
    const health = await new KvStore(kv()).getHealth();
    expect(health.lastSuccessAt).toBe(NOW);
    expect(health.needsReauth).toBe(false);
    expect(health.lastError).toBeNull();
  });

  it("leaves the previous snapshot byte-identical when the refresh 4xxs", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-dead");
    const strava = new StravaClient("cid", "sec", async () => json({ message: "Bad" }, 400));

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);
  });

  it("sets needsReauth when the refresh 4xxs", async () => {
    await new KvStore(kv()).putRefreshToken("ref-dead");
    const strava = new StravaClient("cid", "sec", async () => json({}, 401));
    await runRefresh(deps(strava), NOW);
    expect((await new KvStore(kv()).getHealth()).needsReauth).toBe(true);
  });

  it("writes no snapshot and does not set needsReauth when rate limited", async () => {
    const before = await seedSnapshot();
    await new KvStore(kv()).putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) =>
      input.startsWith("https://www.strava.com/oauth/token")
        ? json({ access_token: "a", refresh_token: "r", expires_at: 1 })
        : json({}, 429),
    );

    const result = await runRefresh(deps(strava), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rate-limit");
    expect(await new KvStore(kv()).getSnapshot()).toEqual(before);
    expect((await new KvStore(kv()).getHealth()).needsReauth).toBe(false);
  });

  it("clears a previous needsReauth after a good refresh", async () => {
    const store = new KvStore(kv());
    await store.putHealth({ lastAttemptAt: 1, lastSuccessAt: null, lastError: "old", needsReauth: true });
    await store.putRefreshToken("ref-old");
    await runRefresh(deps(happyClient()), NOW);
    expect((await store.getHealth()).needsReauth).toBe(false);
  });

  it("requests activities with an epoch-SECONDS after value 90 days back", async () => {
    let seenUrl = "";
    await new KvStore(kv()).putRefreshToken("ref-old");
    const strava = new StravaClient("cid", "sec", async (input) => {
      if (input.startsWith("https://www.strava.com/oauth/token")) {
        return json({ access_token: "a", refresh_token: "r", expires_at: 1 });
      }
      seenUrl = input;
      return json([]);
    });

    await runRefresh(deps(strava), NOW);
    const expected = Math.floor((NOW - 90 * 86_400_000) / 1000);
    expect(seenUrl).toContain(`after=${expected}`);
  });

  it("produces a snapshot with a route built from the polyline", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient()), NOW);
    const snap = await new KvStore(kv()).getSnapshot();
    expect(snap!.route).not.toBeNull();
    expect(snap!.route!.pathD.startsWith("M")).toBe(true);
  });

  it("never persists raw coordinates alongside the path", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    await runRefresh(deps(happyClient()), NOW);
    const raw = (await kv().get("snapshot/current", "text")) ?? "";
    expect(raw).not.toContain("summaryPolyline");
    expect(raw).not.toContain("_p~iF");
    expect(raw).not.toContain('"lat"');
  });

  it("still writes a snapshot when the athlete has no activities", async () => {
    await new KvStore(kv()).putRefreshToken("ref-old");
    const result = await runRefresh(deps(happyClient([])), NOW);
    expect(result.ok).toBe(true);
    const snap = await new KvStore(kv()).getSnapshot();
    expect(snap!.mood.id).toBe("preseason");
    expect(snap!.route).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/app/refresh.test.ts`
Expected: FAIL — cannot resolve `../../src/app/refresh`.

- [ ] **Step 3: Implement `src/app/refresh.ts`**

```ts
import { getMood } from "../data/moods";
import { scoreCharge, scoreConsistency } from "../domain/axes";
import { deriveFacts } from "../domain/facts";
import { selectMood } from "../domain/mood";
import { pickQuote } from "../domain/quote";
import { buildRoute } from "../domain/route";
import { DAY_MS, TUNING } from "../domain/tuning";
import type { KvStore } from "../infrastructure/store/kv";
import {
  StravaAuthError,
  StravaClient,
  StravaRateLimitError,
} from "../infrastructure/strava/client";
import type { Snapshot } from "../types";

export interface RefreshDeps {
  store: KvStore;
  strava: StravaClient;
  tz: string;
  privacyTrimM: number;
}

export type RefreshResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: "no-token" | "auth" | "rate-limit" | "error"; message: string };

export async function runRefresh(deps: RefreshDeps, nowMs: number): Promise<RefreshResult> {
  const { store, strava, tz, privacyTrimM } = deps;
  const health = await store.getHealth();
  await store.putHealth({ ...health, lastAttemptAt: nowMs });

  const currentToken = await store.getRefreshToken();
  if (!currentToken) {
    const message = "No Strava refresh token stored. Visit /auth/login to connect.";
    await store.putHealth({ ...health, lastAttemptAt: nowMs, lastError: message, needsReauth: true });
    return { ok: false, reason: "no-token", message };
  }

  try {
    const token = await strava.refresh(currentToken);

    // Rotation is persisted before the access token is used for anything else.
    // A crash after this line costs one refresh cycle; a crash before it costs nothing.
    await store.putRefreshToken(token.refreshToken);

    const afterEpochSeconds = Math.floor((nowMs - TUNING.WINDOW_DAYS * DAY_MS) / 1000);
    const activities = await strava.listActivities(token.accessToken, afterEpochSeconds);

    const facts = deriveFacts(activities, nowMs, tz);
    const scores = { consistency: scoreConsistency(facts), charge: scoreCharge(facts) };
    const selection = selectMood(facts, scores);

    const mood = getMood(selection.moodId);
    if (!mood) throw new Error(`selectMood returned unknown mood id: ${selection.moodId}`);
    const { quote, gif } = pickQuote(mood, nowMs);

    // buildRoute needs the full Activity, not the trimmed LastActivity in Facts.
    const lastActivity = [...activities].sort((a, b) => b.startedAt - a.startedAt)[0];

    const snapshot: Snapshot = {
      version: 1,
      refreshedAt: nowMs,
      mood: { id: mood.id, name: mood.name, accent: mood.accent },
      quote,
      gif: gif ? { url: gif.url, alt: gif.alt } : null,
      scores,
      reasons: selection.reasons,
      facts: {
        last: facts.last,
        daysSinceLast: facts.daysSinceLast,
        countLast7: facts.countLast7,
        baselineWeekly: facts.baselineWeekly,
        streakDays: facts.streakDays,
        totalActivities: facts.totalActivities,
      },
      route: lastActivity ? buildRoute(lastActivity, privacyTrimM) : null,
    };

    await store.putSnapshot(snapshot);
    await store.putHealth({
      lastAttemptAt: nowMs,
      lastSuccessAt: nowMs,
      lastError: null,
      needsReauth: false,
    });

    return { ok: true, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason =
      error instanceof StravaAuthError
        ? "auth"
        : error instanceof StravaRateLimitError
          ? "rate-limit"
          : "error";

    // The snapshot is deliberately untouched here. A stale mood beats a blank page.
    await store.putHealth({
      ...health,
      lastAttemptAt: nowMs,
      lastError: message,
      needsReauth: reason === "auth",
    });

    return { ok: false, reason, message };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/app/refresh.test.ts`
Expected: all PASS. The two tests that matter most are "writes the rotated refresh token BEFORE fetching activities" and "leaves the previous snapshot byte-identical when the refresh 4xxs". If either fails, do not proceed — they are the spec's safety properties, not stylistic preferences.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/refresh.ts test/app/refresh.test.ts
git commit -m "feat(app): refresh orchestration with token-before-use and snapshot isolation"
```

---

### Task 13: The one-time authorization flow

**Files:**
- Create: `src/app/auth.ts`
- Test: `test/app/auth.test.ts`

**Interfaces:**
- Consumes: `KvStore` (Task 10), `StravaClient` (Task 11), `runRefresh`/`RefreshDeps` (Task 12), `TUNING` (Task 2).
- Produces:
  - `interface AuthDeps extends RefreshDeps { clientId: string; athleteId: string; setupKey: string; redirectUri: string }`
  - `handleLogin(request: Request, deps: AuthDeps): Promise<Response>`
  - `handleCallback(request: Request, deps: AuthDeps, nowMs: number): Promise<Response>`
  - `timingSafeEqual(a: string, b: string): boolean`
  - `hasSetupKey(request: Request, setupKey: string): boolean` — Tasks 14 and 15 both import this; it is the single definition of "is this the owner"

`timingSafeEqual` compares every character regardless of where the first difference is, so response time does not leak how much of the key an attacker guessed correctly. It is a few lines and there is no reason not to.

- [ ] **Step 1: Write the failing tests**

```ts
// test/app/auth.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleCallback, handleLogin, timingSafeEqual } from "../../src/app/auth";
import { KvStore } from "../../src/infrastructure/store/kv";
import { StravaClient } from "../../src/infrastructure/strava/client";

const NOW = Date.parse("2026-08-14T19:00:00Z");
const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deps(strava?: StravaClient) {
  return {
    store: new KvStore(kv()),
    strava:
      strava ??
      new StravaClient("cid", "sec", async () =>
        json({ access_token: "a", refresh_token: "ref-new", expires_at: 1, athlete: { id: 4242 } }),
      ),
    tz: "America/Los_Angeles",
    privacyTrimM: 250,
    clientId: "cid",
    athleteId: "4242",
    setupKey: "s3cret",
    redirectUri: "https://example.test/auth/callback",
  };
}

describe("timingSafeEqual", () => {
  it("matches identical strings and rejects differences", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("handleLogin", () => {
  it("404s without a key, so the route is not advertised", async () => {
    const res = await handleLogin(new Request("https://x/auth/login"), deps());
    expect(res.status).toBe(404);
  });

  it("404s with a wrong key", async () => {
    const res = await handleLogin(new Request("https://x/auth/login?key=nope"), deps());
    expect(res.status).toBe(404);
  });

  it("redirects to Strava with the right scope and a state", async () => {
    const res = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe("activity:read_all");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe("cid");
    expect(location.searchParams.get("redirect_uri")).toBe("https://example.test/auth/callback");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("stores the state so the callback can consume it", async () => {
    const res = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    expect(await new KvStore(kv()).consumeOAuthState(state)).toBe(true);
  });

  it("issues a different state each time", async () => {
    const a = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    const b = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    const stateA = new URL(a.headers.get("location")!).searchParams.get("state");
    const stateB = new URL(b.headers.get("location")!).searchParams.get("state");
    expect(stateA).not.toBe(stateB);
  });
});

describe("handleCallback", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health"]) await kv().delete(key);
  });

  async function issuedState(): Promise<string> {
    const res = await handleLogin(new Request("https://x/auth/login?key=s3cret"), deps());
    return new URL(res.headers.get("location")!).searchParams.get("state")!;
  }

  it("400s with no code", async () => {
    const state = await issuedState();
    const res = await handleCallback(new Request(`https://x/auth/callback?state=${state}`), deps(), NOW);
    expect(res.status).toBe(400);
  });

  it("400s with an unknown state", async () => {
    const res = await handleCallback(
      new Request("https://x/auth/callback?code=c&state=never-issued"), deps(), NOW,
    );
    expect(res.status).toBe(400);
    expect(await new KvStore(kv()).getRefreshToken()).toBeNull();
  });

  it("400s when the same state is replayed", async () => {
    const state = await issuedState();
    const url = `https://x/auth/callback?code=c&state=${state}`;
    expect((await handleCallback(new Request(url), deps(), NOW)).status).toBe(302);
    expect((await handleCallback(new Request(url), deps(), NOW)).status).toBe(400);
  });

  it("400s when the state has expired", async () => {
    // KV expiry cannot be fast-forwarded in tests, so delete the key directly.
    // Expiry and deletion are indistinguishable to consumeOAuthState by design:
    // both leave no value, which is exactly the condition under test.
    const state = await issuedState();
    await kv().delete(`oauth/state/${state}`);
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(), NOW,
    );
    expect(res.status).toBe(400);
    expect(await new KvStore(kv()).getRefreshToken()).toBeNull();
  });

  it("403s and writes nothing when the athlete id does not match", async () => {
    const state = await issuedState();
    const stranger = new StravaClient("cid", "sec", async () =>
      json({ access_token: "a", refresh_token: "stranger", expires_at: 1, athlete: { id: 9999 } }),
    );
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(stranger), NOW,
    );
    expect(res.status).toBe(403);
    expect(await new KvStore(kv()).getRefreshToken()).toBeNull();
  });

  it("403s when Strava returns no athlete at all", async () => {
    const state = await issuedState();
    const anon = new StravaClient("cid", "sec", async () =>
      json({ access_token: "a", refresh_token: "r", expires_at: 1 }),
    );
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(anon), NOW,
    );
    expect(res.status).toBe(403);
  });

  it("stores the token and redirects home on success", async () => {
    const state = await issuedState();
    const res = await handleCallback(
      new Request(`https://x/auth/callback?code=c&state=${state}`), deps(), NOW,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(await new KvStore(kv()).getRefreshToken()).toBe("ref-new");
  });

  it("clears needsReauth on success", async () => {
    const store = new KvStore(kv());
    await store.putHealth({ lastAttemptAt: 1, lastSuccessAt: null, lastError: "x", needsReauth: true });
    const state = await issuedState();
    await handleCallback(new Request(`https://x/auth/callback?code=c&state=${state}`), deps(), NOW);
    expect((await store.getHealth()).needsReauth).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/app/auth.test.ts`
Expected: FAIL — cannot resolve `../../src/app/auth`.

- [ ] **Step 3: Implement `src/app/auth.ts`**

```ts
import { runRefresh, type RefreshDeps } from "./refresh";

export interface AuthDeps extends RefreshDeps {
  clientId: string;
  athleteId: string;
  setupKey: string;
  redirectUri: string;
}

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";

/** Constant-time-ish comparison: always inspects every character. */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function hasSetupKey(request: Request, setupKey: string): boolean {
  const provided = new URL(request.url).searchParams.get("key");
  return provided !== null && setupKey.length > 0 && timingSafeEqual(provided, setupKey);
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleLogin(request: Request, deps: AuthDeps): Promise<Response> {
  // 404, not 403: a wrong key should not confirm the route exists.
  if (!hasSetupKey(request, deps.setupKey)) return new Response("Not found", { status: 404 });

  const nonce = newNonce();
  await deps.store.putOAuthState(nonce);

  const target = new URL(AUTHORIZE_URL);
  target.searchParams.set("client_id", deps.clientId);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("redirect_uri", deps.redirectUri);
  target.searchParams.set("approval_prompt", "auto");
  target.searchParams.set("scope", "activity:read_all");
  target.searchParams.set("state", nonce);

  return Response.redirect(target.toString(), 302);
}

export async function handleCallback(
  request: Request,
  deps: AuthDeps,
  nowMs: number,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) return new Response("Missing code or state", { status: 400 });
  if (!(await deps.store.consumeOAuthState(state))) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  const token = await deps.strava.exchangeCode(code, deps.redirectUri);

  // Even a caller who somehow reached this point cannot install their own token.
  if (token.athleteId === null || String(token.athleteId) !== deps.athleteId) {
    return new Response("This site belongs to a different athlete.", { status: 403 });
  }

  await deps.store.putRefreshToken(token.refreshToken);
  const health = await deps.store.getHealth();
  await deps.store.putHealth({ ...health, needsReauth: false, lastError: null });

  // Populate a snapshot immediately so the page is not empty after connecting.
  await runRefresh(deps, nowMs);

  return new Response(null, { status: 302, headers: { location: "/" } });
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run test/app/auth.test.ts && npm run typecheck`
Expected: all PASS.

```bash
git add src/app/auth.ts test/app/auth.test.ts
git commit -m "feat(app): one-time strava authorization with single-use state and athlete check"
```

---

### Task 14: Worker routing, the cron handler, and the manual refresh endpoint

**Files:**
- Modify: `src/worker.ts`
- Test: `test/app/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 10–13. `renderPage` does not exist until Task 15, so this task returns a plain-text placeholder body for `GET /` and Task 15 swaps in the real renderer.
- Produces: the finished `Env` interface and a default export whose `fetch` routes `/`, `/auth/login`, `/auth/callback`, and `POST /api/refresh`, and whose `scheduled` calls `runRefresh`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/app/routes.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker";
import { KvStore } from "../../src/infrastructure/store/kv";

const kv = (): KVNamespace => (env as never as { STORE: KVNamespace }).STORE;

function ctx(): ExecutionContext {
  return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function testEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...(env as object),
    TIMEZONE: "America/Los_Angeles",
    PRIVACY_TRIM_M: "250",
    REDIRECT_URI: "https://example.test/auth/callback",
    STRAVA_CLIENT_ID: "cid",
    STRAVA_CLIENT_SECRET: "sec",
    STRAVA_ATHLETE_ID: "4242",
    SETUP_KEY: "s3cret",
    ...overrides,
  } as never;
}

describe("routing", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv().delete(key);
    }
  });

  it("serves the page at /", async () => {
    const res = await worker.fetch(new Request("https://x/"), testEnv(), ctx());
    expect(res.status).toBe(200);
  });

  it("404s an unknown path", async () => {
    const res = await worker.fetch(new Request("https://x/nope"), testEnv(), ctx());
    expect(res.status).toBe(404);
  });

  it("404s /auth/login without the setup key", async () => {
    const res = await worker.fetch(new Request("https://x/auth/login"), testEnv(), ctx());
    expect(res.status).toBe(404);
  });

  it("redirects /auth/login with the setup key", async () => {
    const res = await worker.fetch(new Request("https://x/auth/login?key=s3cret"), testEnv(), ctx());
    expect(res.status).toBe(302);
  });
});

describe("POST /api/refresh", () => {
  beforeEach(async () => {
    for (const key of ["token/refresh", "snapshot/current", "health", "refresh/lastAt"]) {
      await kv().delete(key);
    }
  });

  it("405s a GET", async () => {
    const res = await worker.fetch(new Request("https://x/api/refresh?key=s3cret"), testEnv(), ctx());
    expect(res.status).toBe(405);
  });

  it("404s without the key", async () => {
    const req = new Request("https://x/api/refresh", { method: "POST" });
    expect((await worker.fetch(req, testEnv(), ctx())).status).toBe(404);
  });

  it("404s with a wrong key", async () => {
    const req = new Request("https://x/api/refresh?key=wrong", { method: "POST" });
    expect((await worker.fetch(req, testEnv(), ctx())).status).toBe(404);
  });

  it("429s when called again inside the cooldown", async () => {
    await new KvStore(kv()).putLastManualRefreshAt(Date.now());
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("allows a call once the cooldown has elapsed", async () => {
    await new KvStore(kv()).putLastManualRefreshAt(Date.now() - 120_000);
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    // No token stored, so the refresh fails — but not with a cooldown rejection.
    expect(res.status).not.toBe(429);
  });

  it("records the attempt time so the next call is throttled", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    await worker.fetch(req, testEnv(), ctx());
    expect(await new KvStore(kv()).getLastManualRefreshAt()).not.toBeNull();
  });

  it("returns a JSON body describing the failure when not connected", async () => {
    const req = new Request("https://x/api/refresh?key=s3cret", { method: "POST" });
    const res = await worker.fetch(req, testEnv(), ctx());
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ ok: false, reason: "no-token" });
  });
});

describe("scheduled", () => {
  it("runs without throwing when nothing is connected", async () => {
    const controller = { cron: "0 */4 * * *", scheduledTime: Date.now(), noRetry: () => {} };
    await expect(
      worker.scheduled(controller as unknown as ScheduledController, testEnv(), ctx()),
    ).resolves.toBeUndefined();
  });

  it("records a health attempt", async () => {
    await kv().delete("health");
    const controller = { cron: "0 */4 * * *", scheduledTime: Date.now(), noRetry: () => {} };
    await worker.scheduled(controller as unknown as ScheduledController, testEnv(), ctx());
    expect((await new KvStore(kv()).getHealth()).lastAttemptAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/app/routes.test.ts`
Expected: FAIL — every route currently returns the Task 1 placeholder.

- [ ] **Step 3: Rewrite `src/worker.ts`**

```ts
import { handleCallback, handleLogin, hasSetupKey, type AuthDeps } from "./app/auth";
import { runRefresh } from "./app/refresh";
import { TUNING } from "./domain/tuning";
import { KvStore } from "./infrastructure/store/kv";
import { StravaClient } from "./infrastructure/strava/client";

export interface Env {
  STORE: KVNamespace;
  TIMEZONE: string;
  PRIVACY_TRIM_M: string;
  REDIRECT_URI: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_ATHLETE_ID: string;
  SETUP_KEY: string;
}

function buildDeps(env: Env): AuthDeps {
  const trim = Number(env.PRIVACY_TRIM_M);
  return {
    store: new KvStore(env.STORE),
    strava: new StravaClient(env.STRAVA_CLIENT_ID, env.STRAVA_CLIENT_SECRET),
    tz: env.TIMEZONE || "UTC",
    privacyTrimM: Number.isFinite(trim) ? trim : TUNING.DEFAULT_PRIVACY_TRIM_M,
    clientId: env.STRAVA_CLIENT_ID,
    athleteId: env.STRAVA_ATHLETE_ID,
    setupKey: env.SETUP_KEY,
    redirectUri: env.REDIRECT_URI,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleManualRefresh(request: Request, env: Env, nowMs: number): Promise<Response> {
  const deps = buildDeps(env);

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  }
  if (!hasSetupKey(request, deps.setupKey)) return new Response("Not found", { status: 404 });

  const lastAt = await deps.store.getLastManualRefreshAt();
  if (lastAt !== null && nowMs - lastAt < TUNING.MANUAL_REFRESH_COOLDOWN_MS) {
    const waitS = Math.ceil((TUNING.MANUAL_REFRESH_COOLDOWN_MS - (nowMs - lastAt)) / 1000);
    return new Response(JSON.stringify({ ok: false, reason: "cooldown", retryAfterSeconds: waitS }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(waitS) },
    });
  }

  // Recorded before running, so a slow or failing refresh still throttles the next call.
  await deps.store.putLastManualRefreshAt(nowMs);

  const result = await runRefresh(deps, nowMs);
  return json(result, result.ok ? 200 : 502);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();

    if (url.pathname === "/auth/login") return handleLogin(request, buildDeps(env));
    if (url.pathname === "/auth/callback") return handleCallback(request, buildDeps(env), nowMs);
    if (url.pathname === "/api/refresh") return handleManualRefresh(request, env, nowMs);

    if (url.pathname === "/") {
      // Task 15 replaces this with renderPage().
      const snapshot = await new KvStore(env.STORE).getSnapshot();
      return new Response(snapshot ? snapshot.mood.name : "Preseason", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runRefresh(buildDeps(env), Date.now());
  },
};
```

`Date.now()` appears here and only here. This is the composition root — the one place allowed to read the clock — and it injects the value into every layer below.

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: the whole suite PASSES.

```bash
git add src/worker.ts test/app/routes.test.ts
git commit -m "feat(app): worker routing, cron handler, and guarded manual refresh"
```

---

## Phase 5 — The page

### Task 15: Stylesheet and page shell

Read `CLAUDE.md` before writing a line of CSS. The aesthetic is a non-league matchday programme: newsprint stock, heavy condensed display type, one ink accent per mood, hairline rules instead of shadows. The banned list is binding — no gradients, no emoji icons, no glassmorphism, no shadowed cards, no uniform-everything spacing.

**Files:**
- Create: `src/app/styles.ts`, `src/app/render.ts`
- Test: `test/app/render.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Health` (Task 10), `TUNING` (Task 2).
- Produces:
  - `STYLES: string` from `styles.ts`
  - `interface PageView { snapshot: Snapshot | null; health: Health; nowMs: number; showRefreshButton: boolean; previewNotice: string | null }`
  - `renderPage(view: PageView): string`
  - `escapeHtml(value: string): string` (exported; Task 16 reuses it)

- [ ] **Step 1: Write the failing tests**

```ts
// test/app/render.test.ts
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
    expect(html).not.toContain("onerror=");
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/app/render.test.ts`
Expected: FAIL — cannot resolve `../../src/app/render`.

- [ ] **Step 3: Implement `src/app/styles.ts`**

```ts
export const STYLES = `
:root {
  --stock: #F4F1E8;
  --ink: #17171A;
  --ink-soft: #55565C;
  --rule: #C9C3B4;
  --ink-accent: #17171A;
  --display: ui-sans-serif, "Helvetica Neue", Arial, sans-serif;
  --text: Georgia, "Iowan Old Style", "Times New Roman", serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --stock: #14140F;
    --ink: #F1EDE2;
    --ink-soft: #A7A296;
    --rule: #3A382F;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--stock);
  color: var(--ink);
  font-family: var(--text);
  font-size: 17px;
  line-height: 1.5;
  /* Newsprint tooth. A flat fill is the giveaway of a generated page. */
  background-image:
    repeating-linear-gradient(0deg, rgba(0,0,0,.014) 0 1px, transparent 1px 3px);
}

.sheet { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }

.masthead {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  border-top: 3px solid var(--ink);
  border-bottom: 1px solid var(--rule);
  padding: .5rem 0 .35rem;
}

.mood-name {
  font-family: var(--display);
  font-weight: 800;
  font-size: clamp(1.75rem, 7vw, 3.25rem);
  letter-spacing: -.035em;
  text-transform: uppercase;
  color: var(--ink-accent);
  margin: 0;
  line-height: .95;
}

.masthead-meta {
  font-family: var(--display);
  font-size: .7rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-soft);
}

.stamp {
  display: inline-block;
  transform: rotate(-4deg);
  border: 2px solid var(--ink-soft);
  color: var(--ink-soft);
  font-family: var(--display);
  font-size: .62rem; letter-spacing: .2em; text-transform: uppercase;
  padding: .15rem .4rem;
}

.hero { display: grid; grid-template-columns: 1fr; gap: 1.5rem; padding: 2.5rem 0 1.75rem; }
@media (min-width: 46rem) { .hero { grid-template-columns: 1.6fr 1fr; align-items: start; } }

blockquote.quote {
  margin: 0;
  font-size: clamp(1.65rem, 5.2vw, 3rem);
  line-height: 1.08;
  letter-spacing: -.02em;
  text-wrap: balance;
}

.attribution {
  margin-top: .9rem;
  font-family: var(--display);
  font-size: .72rem; letter-spacing: .18em; text-transform: uppercase;
  color: var(--ink-soft);
}

.gif { width: 100%; height: auto; display: block; border: 1px solid var(--ink-accent); }

.rule { border: 0; border-top: 1px solid var(--rule); margin: 0; }

/* The receipts are deliberately denser than the hero. That contrast is the layout. */
.receipts {
  width: 100%; border-collapse: collapse;
  font-family: var(--display);
  font-size: .8rem;
  font-variant-numeric: tabular-nums lining-nums;
  margin-top: 1.25rem;
}
.receipts th {
  text-align: left; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; font-size: .62rem; color: var(--ink-soft);
  padding: .3rem .75rem .3rem 0; white-space: nowrap; vertical-align: baseline;
}
.receipts td { padding: .3rem 0; border-bottom: 1px solid var(--rule); }

.reasons { margin: 1.25rem 0 0; padding: 0; list-style: none; }
.reasons li { padding-left: 1rem; text-indent: -1rem; color: var(--ink-soft); }
.reasons li::before { content: "— "; color: var(--ink-accent); }

.notice {
  border: 1px solid var(--ink-accent);
  border-left-width: 5px;
  padding: .6rem .8rem;
  margin: 1rem 0;
  font-family: var(--display);
  font-size: .8rem;
}

.footer {
  margin-top: 2.5rem; padding-top: .6rem;
  border-top: 1px solid var(--rule);
  display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-soft);
}
.footer a { color: inherit; }

button.refresh {
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .18em; text-transform: uppercase;
  background: var(--ink); color: var(--stock);
  border: 0; padding: .5rem .9rem; cursor: pointer;
}
button.refresh[disabled] { opacity: .45; cursor: wait; }
`;
```

- [ ] **Step 4: Implement `src/app/render.ts`**

```ts
import { TUNING } from "../domain/tuning";
import type { Health, Snapshot } from "../types";
import { STYLES } from "./styles";

export interface PageView {
  snapshot: Snapshot | null;
  health: Health;
  nowMs: number;
  showRefreshButton: boolean;
  previewNotice: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function km(metres: number): string {
  return (metres / 1000).toFixed(1);
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function agoLabel(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  return `${Math.floor(days)} days ago`;
}

function count(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function receipts(snapshot: Snapshot): string {
  const f = snapshot.facts;
  const rows: [string, string][] = [
    ["Last out", f.last ? escapeHtml(f.last.name) : "Nothing yet"],
    ["Sport", f.last ? escapeHtml(f.last.sportType) : "—"],
    ["Distance", f.last ? `${km(f.last.distanceM)} km` : "—"],
    ["Time", f.last ? duration(f.last.movingTimeS) : "—"],
    ["When", agoLabel(f.daysSinceLast)],
    ["This week", `${f.countLast7} vs your usual ${count(f.baselineWeekly)}`],
    ["Streak", f.streakDays > 0 ? `${f.streakDays} days` : "—"],
    ["Last 90 days", `${f.totalActivities} activities`],
  ];

  return `<table class="receipts"><tbody>${rows
    .map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`)
    .join("")}</tbody></table>`;
}

/** The state before the first successful fetch, and when there is nothing to show. */
const PRESEASON = {
  mood: { id: "preseason", name: "Preseason", accent: "#6B7A8F" },
  quote: {
    text: "I believe in hope. I believe in believe.",
    character: "Ted Lasso",
  },
};

export function renderPage(view: PageView): string {
  const { snapshot, health, nowMs, showRefreshButton, previewNotice } = view;

  const mood = snapshot?.mood ?? PRESEASON.mood;
  const quote = snapshot?.quote ?? PRESEASON.quote;

  const ageHours = snapshot ? (nowMs - snapshot.refreshedAt) / 3_600_000 : 0;
  const stale = snapshot !== null && ageHours > TUNING.STALE_SNAPSHOT_HOURS;

  const notices: string[] = [];
  if (previewNotice) {
    notices.push(`<p class="notice">${escapeHtml(previewNotice)}</p>`);
  }
  if (health.needsReauth) {
    notices.push(
      `<p class="notice">Strava access has lapsed — the mood below is the last one we recorded. ` +
        `<a href="/auth/login">Reconnect Strava</a>.</p>`,
    );
  }
  if (!snapshot) {
    notices.push(
      `<p class="notice">The first fetch hasn't run yet. Once it does, this page fills in on its own.</p>`,
    );
  }

  const gif = snapshot?.gif
    ? `<img class="gif" src="${escapeHtml(snapshot.gif.url)}" alt="${escapeHtml(snapshot.gif.alt)}" ` +
      `loading="eager" decoding="async">`
    : "";

  const reasons = snapshot?.reasons.length
    ? `<ul class="reasons">${snapshot.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
    : "";

  const staleStamp = stale
    ? `<span class="stamp">last updated ${Math.floor(ageHours)}h ago</span>`
    : "";

  const refreshButton = showRefreshButton
    ? `<button class="refresh" id="refresh" type="button">Refresh now</button>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(mood.name)} — tedlasso-strava</title>
<meta name="robots" content="noindex">
<style>${STYLES}</style>
</head>
<body style="--ink-accent: ${escapeHtml(mood.accent)}">
<main class="sheet">
  <header class="masthead">
    <h1 class="mood-name">${escapeHtml(mood.name)}</h1>
    <div class="masthead-meta">Matchday report ${staleStamp}</div>
  </header>

  ${notices.join("")}

  <section class="hero">
    <div>
      <blockquote class="quote">${escapeHtml(quote.text)}</blockquote>
      <p class="attribution">${escapeHtml(quote.character)}</p>
      ${reasons}
    </div>
    <div>${gif}</div>
  </section>

  <hr class="rule">
  ${snapshot ? receipts(snapshot) : ""}

  <footer class="footer">
    <span><a href="https://www.strava.com" rel="noopener">Powered by Strava</a></span>
    <span>${refreshButton}</span>
  </footer>
</main>
</body>
</html>`;
}
```

- [ ] **Step 5: Wire it into the worker**

In `src/worker.ts`, replace the `GET /` placeholder branch with:

```ts
    if (url.pathname === "/") {
      const store = new KvStore(env.STORE);
      const [snapshot, health] = await Promise.all([store.getSnapshot(), store.getHealth()]);
      return new Response(
        renderPage({
          snapshot,
          health,
          nowMs,
          showRefreshButton: hasSetupKey(request, env.SETUP_KEY),
          previewNotice: null,
        }),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
```

Add `import { renderPage } from "./app/render";` at the top.

- [ ] **Step 6: Run the full suite, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

```bash
git add src/app/styles.ts src/app/render.ts src/worker.ts test/app/render.test.ts
git commit -m "feat(app): matchday-programme page shell with designed failure states"
```

---

### Task 16: The route map block and the preview route

**Files:**
- Modify: `src/app/render.ts`, `src/app/styles.ts`, `src/worker.ts`
- Test: `test/app/route-render.test.ts`

**Interfaces:**
- Consumes: `RouteRender` (Task 9), `renderPage`/`escapeHtml` (Task 15), `MOODS`/`getMood` (Task 6), `pickQuote` (Task 6).
- Produces: `renderRoute(route: RouteRender | null, snapshot: Snapshot): string` exported from `render.ts`; a `?preview=<moodId>` branch on `GET /`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/app/route-render.test.ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/app/render";
import worker from "../../src/worker";
import { MOODS } from "../../src/data/moods";
import { EMPTY_HEALTH, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

function snapshot(route: Snapshot["route"]): Snapshot {
  return {
    version: 1, refreshedAt: NOW,
    mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
    quote: { text: "Believe.", character: "AFC Richmond locker room" },
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
    const res = await worker.fetch(new Request("https://x/?preview=roy-kent"), testEnv(), ctx());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Roy Kent");
    expect(html.toLowerCase()).toContain("preview");
  });

  it("ignores an unknown mood id rather than erroring", async () => {
    const res = await worker.fetch(new Request("https://x/?preview=not-a-mood"), testEnv(), ctx());
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).not.toContain("not-a-mood");
  });
});

// Spec §8 requires render coverage of all nine moods, not just the one the
// engine happens to select today.
describe("every mood renders", () => {
  for (const mood of MOODS) {
    it(`renders ${mood.id} with its name, accent, and a quote`, () => {
      const s = snapshot(ROUTE);
      s.mood = { id: mood.id, name: mood.name, accent: mood.accent };
      s.quote = mood.quotes[0]!;
      const html = renderPage(view(s));

      expect(html).toContain(mood.name);
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/app/route-render.test.ts`
Expected: FAIL — no SVG is emitted and `?preview=` is ignored.

- [ ] **Step 3: Add route styles to `src/app/styles.ts`**

Append inside the template string:

```css
.route { margin-top: 1.75rem; border-top: 1px solid var(--rule); padding-top: .9rem; }
.route-frame { border: 1px solid var(--rule); padding: .75rem; }
.route svg { display: block; width: 100%; height: auto; }
.route-caption {
  display: flex; gap: 1.25rem; flex-wrap: wrap;
  margin-top: .6rem;
  font-family: var(--display);
  font-size: .68rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums lining-nums;
}
.route-none {
  font-family: var(--display); font-weight: 800;
  font-size: clamp(1.25rem, 4vw, 2rem);
  letter-spacing: -.02em; text-transform: uppercase;
  color: var(--ink-soft);
  padding: 2.5rem .25rem;
}
```

- [ ] **Step 4: Add `renderRoute` to `src/app/render.ts`**

```ts
import type { RouteRender } from "../domain/route";

export function renderRoute(route: RouteRender | null, snapshot: Snapshot): string {
  if (!route) {
    const sport = snapshot.facts.last?.sportType ?? "Session";
    const time = snapshot.facts.last ? duration(snapshot.facts.last.movingTimeS) : "";
    return `<section class="route"><div class="route-frame">
      <p class="route-none">No route — ${escapeHtml(sport)} ${escapeHtml(time)}</p>
    </div></section>`;
  }

  const place = route.locationLabel
    ? `<span class="route-place">${escapeHtml(route.locationLabel)}</span>`
    : "";

  return `<section class="route"><div class="route-frame">
    <svg viewBox="${escapeHtml(route.viewBox)}" role="img"
         aria-label="Route of the last ${escapeHtml(route.sportType)}, ${km(route.distanceM)} kilometres">
      <path d="${escapeHtml(route.pathD)}" fill="none" stroke="var(--ink-accent)"
            stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="route-caption">
      <span>${km(route.distanceM)} km</span>
      <span>${Math.round(route.elevationM)} m up</span>
      <span>${escapeHtml(route.sportType)}</span>
      ${place}
    </div>
  </div></section>`;
}
```

Then insert `${snapshot ? renderRoute(snapshot.route, snapshot) : ""}` into `renderPage` between the `<hr class="rule">` and the receipts table.

- [ ] **Step 5: Add the preview branch in `src/worker.ts`**

Inside the `GET /` handler, after loading `snapshot` and `health`:

```ts
      const previewId = url.searchParams.get("preview");
      const previewMood = previewId ? getMood(previewId) : undefined;

      let shown = snapshot;
      let previewNotice: string | null = null;

      if (previewMood) {
        const { quote, gif } = pickQuote(previewMood, nowMs);
        const base = snapshot ?? EMPTY_PREVIEW_SNAPSHOT;
        shown = {
          ...base,
          mood: { id: previewMood.id, name: previewMood.name, accent: previewMood.accent },
          quote,
          gif: gif ? { url: gif.url, alt: gif.alt } : null,
        };
        previewNotice = `Preview — not your live mood.`;
      }
```

and pass `shown` as the snapshot. Define the fallback next to the handler:

```ts
const EMPTY_PREVIEW_SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: 0,
  mood: { id: "preseason", name: "Preseason", accent: "#6B7A8F" },
  quote: { text: "", character: "" },
  gif: null,
  scores: { consistency: 0, charge: 0 },
  reasons: [],
  facts: {
    last: null, daysSinceLast: null, countLast7: 0,
    baselineWeekly: 0, streakDays: 0, totalActivities: 0,
  },
  route: null,
};
```

Add the imports `getMood` from `./data/moods`, `pickQuote` from `./domain/quote`, and the `Snapshot` type from `./types`.

Note the preview deliberately reuses your real stats and real route — only the mood, quote, and GIF are substituted. That is what makes it useful for checking the design against real data rather than against invented numbers.

- [ ] **Step 6: Run the full suite, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

```bash
git add src/app/render.ts src/app/styles.ts src/worker.ts test/app/route-render.test.ts
git commit -m "feat(app): inline svg route map, indoor fallback, and mood preview route"
```

---

### Task 17: Manual refresh without a page reload

**Files:**
- Create: `src/app/client.ts`
- Modify: `src/app/render.ts`
- Test: `test/app/refresh-ui.test.ts`

**Interfaces:**
- Consumes: `renderPage` (Task 15), `TUNING` (Task 2).
- Produces: `REFRESH_SCRIPT: string` from `client.ts`, injected only when `showRefreshButton` is true.

The button must work without JavaScript. It is wrapped in a real form that POSTs to `/api/refresh`; the script intercepts the submit and swaps the content in place. If the script never runs, the form still posts and the browser follows the response.

- [ ] **Step 1: Write the failing tests**

```ts
// test/app/refresh-ui.test.ts
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/app/render";
import { EMPTY_HEALTH, type Snapshot } from "../../src/types";

const NOW = Date.parse("2026-08-14T19:00:00Z");

const SNAPSHOT: Snapshot = {
  version: 1, refreshedAt: NOW,
  mood: { id: "believe", name: "Believe", accent: "#F2C14E" },
  quote: { text: "Believe.", character: "AFC Richmond locker room" },
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
    expect(renderPage(view(true))).toContain("/api/refresh?key=");
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/app/refresh-ui.test.ts`
Expected: FAIL — the button is a bare `<button>` with no form and no script.

- [ ] **Step 3: Implement `src/app/client.ts`**

```ts
import { TUNING } from "../domain/tuning";

/**
 * Progressive enhancement only. Without this script the form still posts and
 * the browser navigates to the JSON response, which is ugly but not broken.
 */
export const REFRESH_SCRIPT = `
(function () {
  var form = document.getElementById("refresh-form");
  if (!form) return;
  var button = document.getElementById("refresh");
  var MIN_MS = ${TUNING.REFRESH_ANIMATION_MS};

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Warming up";
    document.body.setAttribute("data-refreshing", "true");

    var started = Date.now();
    fetch(form.action, { method: "POST", headers: { accept: "application/json" } })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        var wait = Math.max(0, MIN_MS - (Date.now() - started));
        setTimeout(function () {
          if (payload && payload.ok) {
            window.location.reload();
          } else {
            button.disabled = false;
            button.textContent = "Try again";
            document.body.removeAttribute("data-refreshing");
          }
        }, wait);
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = "Try again";
        document.body.removeAttribute("data-refreshing");
      });
  });
})();
`;
```

Reloading after a successful refresh is deliberate: the server already knows how to render every state, so re-rendering client-side would mean maintaining a second renderer that could drift from the first.

- [ ] **Step 4: Update `renderPage`**

Change `PageView` to carry the key, and the button markup to a form:

```ts
export interface PageView {
  snapshot: Snapshot | null;
  health: Health;
  nowMs: number;
  showRefreshButton: boolean;
  previewNotice: string | null;
  setupKey?: string;
}
```

```ts
  const refreshButton = showRefreshButton
    ? `<form id="refresh-form" method="post" action="/api/refresh?key=${encodeURIComponent(view.setupKey ?? "")}">
         <button class="refresh" id="refresh" type="submit">Refresh now</button>
       </form>`
    : "";
```

and immediately before `</body>`:

```ts
  ${showRefreshButton ? `<script>${REFRESH_SCRIPT}</script>` : ""}
```

Add a fade to `styles.ts`:

```css
body[data-refreshing="true"] .hero { opacity: .35; transition: opacity .35s ease; }
```

In `src/worker.ts`, pass `setupKey: env.SETUP_KEY` in the `GET /` view.

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

```bash
git add src/app/client.ts src/app/render.ts src/app/styles.ts src/worker.ts test/app/refresh-ui.test.ts
git commit -m "feat(app): manual refresh with a no-javascript form fallback"
```

---

## Phase 6 — Ship

### Task 18: Setup documentation and final verification

**Files:**
- Create: `README.md`, `.dev.vars.example`
- Test: the whole suite, plus a manual local run

**Interfaces:**
- Consumes: everything.
- Produces: no code. This task's deliverable is a repo someone can deploy without asking questions.

- [ ] **Step 1: Write `.dev.vars.example`**

```
# Copy to .dev.vars for local development. .dev.vars is gitignored.
STRAVA_CLIENT_ID=00000
STRAVA_CLIENT_SECRET=replace-me
STRAVA_ATHLETE_ID=00000000
SETUP_KEY=pick-a-long-random-string
```

- [ ] **Step 2: Write `README.md`**

It must contain, in this order:

1. **What it is** — two sentences, and a note that it is single-athlete.
2. **The one-time setup**, as a numbered list someone can follow without prior knowledge:
   - Create a Strava API application at `https://www.strava.com/settings/api`. Set the Authorization Callback Domain to the Worker's domain (for local work, `localhost`).
   - `npx wrangler kv namespace create STORE`, then paste the returned id into `wrangler.jsonc`.
   - `npx wrangler secret put STRAVA_CLIENT_ID` (and `STRAVA_CLIENT_SECRET`, `STRAVA_ATHLETE_ID`, `SETUP_KEY`). Note that `STRAVA_ATHLETE_ID` is the number in your Strava profile URL.
   - Set `REDIRECT_URI` in `wrangler.jsonc` to `https://<your-worker-domain>/auth/callback`.
   - `npx wrangler deploy`.
   - Visit `https://<your-worker-domain>/auth/login?key=<SETUP_KEY>` once and approve. That is the only manual step, ever.
3. **Local development** — `cp .dev.vars.example .dev.vars`, `npm run dev`, and the scheduled-trigger curl:
   ```bash
   curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"
   ```
4. **Operating notes:**
   - The cron runs every 4 hours; roughly 12 Strava requests a day against a 1,000/day limit.
   - `POST /api/refresh?key=<SETUP_KEY>` forces a refresh, throttled to once a minute.
   - `/?preview=<moodId>` previews any mood. Valid ids: `preseason`, `whered-you-go`, `believe`, `roy-kent`, `comeback-szn`, `football-is-life`, `gaffer-mode`, `biscuits`, `hopeful`.
   - If the page shows "Reconnect Strava", visit `/auth/login?key=<SETUP_KEY>` again.
5. **Privacy** — state plainly that the page is public, that it shows activity name, sport, distance, timing, frequency, and route shape, and that routes are trimmed by `PRIVACY_TRIM_M` metres at both ends by default because `activity:read_all` bypasses Strava privacy zones. Note that setting it to `0` publishes exact start and end points.
6. **Attribution** — "Powered by Strava", linking to `https://www.strava.com`, and a line clarifying this project is not affiliated with or endorsed by Strava or the makers of Ted Lasso.

- [ ] **Step 3: Run the whole suite with coverage**

Run: `npx vitest run --coverage`
Expected: every test PASSES, and `src/domain` plus `src/data` branch coverage is at or above 95%. If coverage is short, add the missing fixtures rather than lowering the threshold.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Verify the layering rule mechanically**

Run:
```bash
grep -rnE "from \"\.\./(infrastructure|app)|from \"\.\./\.\./(infrastructure|app)" src/domain src/data && echo "LAYERING VIOLATION" || echo "layering ok"
```
Expected: `layering ok`.

Run:
```bash
grep -rnE "Date\.now\(\)|Math\.random\(\)|new Date\(\)" src/domain src/data && echo "PURITY VIOLATION" || echo "purity ok"
```
Expected: `purity ok`. `new Date(epochMs)` with an argument is fine and will not match this pattern.

- [ ] **Step 6: Run it locally and look at it**

```bash
cp .dev.vars.example .dev.vars   # then fill in real values
npm run dev
```

Open `http://localhost:8787/?preview=believe` and check every mood by changing the id. Confirm against `CLAUDE.md`: no gradients, no emoji icons, no glassmorphism, no shadowed cards, and the receipts block is visibly denser than the hero. Check one narrow viewport.

Then connect for real via `/auth/login?key=...`, trigger a refresh, and confirm the route map draws.

- [ ] **Step 7: Commit**

```bash
git add README.md .dev.vars.example
git commit -m "docs: setup, operating, and privacy notes"
```

---

## Verification checklist

Run before declaring the build done. Every line needs actual observed output, not an assumption.

- [ ] `npx vitest run --coverage` — all tests pass, domain and data branch coverage ≥ 95%
- [ ] `npm run typecheck` — clean
- [ ] The layering and purity greps from Task 18 Step 5 both report ok
- [ ] `npm run dev` serves the page, and every one of the nine `?preview=` ids renders
- [ ] The three safety tests pass by name:
  - rotated refresh token is written before the access token is used
  - a 4xx refresh leaves the snapshot byte-identical
  - the snapshot never contains raw coordinates
- [ ] `/api/refresh` returns 404 without the key and 429 inside the cooldown
- [ ] `/auth/callback` rejects a replayed state and a mismatched athlete id
- [ ] Every GIF url in `src/data/moods.ts` was verified with a real HTTP request, or its mood ships with `gifs: []`
- [ ] The page renders correctly with JavaScript disabled
- [ ] "Powered by Strava" is present and links back
