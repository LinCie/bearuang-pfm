import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../../src/index";
import { applyMigrations } from "../setup";

describe("health route", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it("returns healthy when all services are reachable", async () => {
    const res = await app.request("/api/v1/health", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "healthy",
      services: {
        d1: { status: "ok" },
        kv: { status: "ok" },
        r2: { status: "ok" },
      },
    });
  });
});
