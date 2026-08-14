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
