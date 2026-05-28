import { env } from "cloudflare:test";
import { expect, test } from "vitest";

test("KV pool round-trip", async () => {
  await env.SESSIONS.put("test-key", "ok");
  expect(await env.SESSIONS.get("test-key")).toBe("ok");
});
