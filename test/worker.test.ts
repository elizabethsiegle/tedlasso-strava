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
