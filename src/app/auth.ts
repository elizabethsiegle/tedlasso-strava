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
