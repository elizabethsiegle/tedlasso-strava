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
