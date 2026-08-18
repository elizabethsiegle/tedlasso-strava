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
import { EMPTY_HEALTH, type Snapshot } from "../types";

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
  // Captured outside the try so the catch block has something to merge onto
  // even if the very first KV call (getHealth) is what failed.
  let health = EMPTY_HEALTH;

  try {
    health = await store.getHealth();
    // Record the attempt immediately, before the token call — if the Worker dies
    // mid-refresh, health still reflects that an attempt was made.
    await store.putHealth({ ...health, lastAttemptAt: nowMs });

    const currentToken = await store.getRefreshToken();
    if (!currentToken) {
      const message = "No Strava refresh token stored. Visit /auth/login to connect.";
      await store.putHealth({ ...health, lastAttemptAt: nowMs, lastError: message, needsReauth: true });
      return { ok: false, reason: "no-token", message };
    }

    const token = await strava.refresh(currentToken);

    // A parseable 200 with a missing/empty refresh_token is not a success: if
    // it were persisted, it would silently destroy the one working credential
    // and lock the app out on the very next refresh. Refuse and classify it as
    // an auth failure instead — the previous, still-valid refresh token in KV
    // is left untouched.
    if (!token.refreshToken) {
      throw new StravaAuthError("token refresh: response had no refresh_token");
    }

    // Rotation is persisted before the access token is used for anything else.
    // Strava invalidates the old refresh token the instant this one is issued;
    // if the Worker dies before this write lands, the stored token is still the
    // live one. A crash after this line costs one refresh cycle; a crash before
    // it would cost permanent lockout.
    await store.putRefreshToken(token.refreshToken);

    const afterEpochSeconds = Math.floor((nowMs - TUNING.WINDOW_DAYS * DAY_MS) / 1000);
    const activities = await strava.listActivities(token.accessToken, afterEpochSeconds);

    const facts = deriveFacts(activities, nowMs, tz);
    const scores = { consistency: scoreConsistency(facts), charge: scoreCharge(facts) };
    const selection = selectMood(facts, scores);

    const mood = getMood(selection.moodId);
    if (!mood) throw new Error(`selectMood returned unknown mood id: ${selection.moodId}`);
    const { quote, gif } = pickQuote(mood, nowMs);

    // buildRoute needs the full Activity (it carries the polyline); Facts.last
    // is a trimmed projection that does not. Sort the raw activities ourselves
    // and take the most recent one.
    const lastActivity = [...activities].sort((a, b) => b.startedAt - a.startedAt)[0];

    const snapshot: Snapshot = {
      version: 1,
      refreshedAt: nowMs,
      mood: { id: mood.id, name: mood.name, accent: mood.accent },
      quote,
      gif: gif ? { url: gif.url, alt: gif.alt, verifiedOn: gif.verifiedOn } : null,
      scores,
      reasons: selection.reasons,
      facts: {
        last: facts.last,
        daysSinceLast: facts.daysSinceLast,
        countLast7: facts.countLast7,
        baselineWeekly: facts.baselineWeekly,
        streakDays: facts.streakDays,
        totalActivities: facts.totalActivities,
        recent: facts.recent,
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

    // The snapshot is deliberately untouched here. A stale mood beats a blank
    // page: only `health` records that this attempt failed.
    try {
      await store.putHealth({
        ...health,
        lastAttemptAt: nowMs,
        lastError: message,
        // A non-auth failure (rate limit, network blip, etc.) must not clear
        // a standing reconnect notice: if the token was already revoked and
        // this attempt merely failed for some other reason, the notice has
        // to survive until an actual successful refresh clears it.
        needsReauth: reason === "auth" || health.needsReauth,
      });
    } catch {
      // Best-effort: if KV itself is what's failing, we cannot record the
      // failure either. The caller still gets a returned result, never a
      // thrown error — recording the failure must not become a new one.
    }

    return { ok: false, reason, message };
  }
}
