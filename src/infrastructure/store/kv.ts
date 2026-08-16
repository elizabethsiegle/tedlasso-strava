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
