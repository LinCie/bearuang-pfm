import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import {
  setupInitializeResponseSchema,
  setupStatusResponseSchema,
} from "../../src/schemas/setup.schema";
import { applyMigrations } from "../setup";

describe("setup routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM settings").run();
  });

  it("returns is_setup_complete false on a fresh instance", async () => {
    const res = await app.request("/api/v1/setup/status", {}, env);

    expect(res.status).toBe(200);
    expect(setupStatusResponseSchema.parse(await res.json())).toEqual({
      is_setup_complete: false,
    });
  });

  it("initializes setup and stores settings", async () => {
    const res = await app.request(
      "/api/v1/setup/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: "LinCie",
          base_currency: "IDR",
          seed_categories: true,
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(setupInitializeResponseSchema.parse(await res.json())).toEqual({
      message: "Setup complete",
    });

    const rows = await db.select().from(schema.settings);
    const settingsByKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    expect(settingsByKey).toMatchObject({
      display_name: "LinCie",
      base_currency: "IDR",
      seed_categories_on_first_use: "true",
      setup_complete: "true",
    });
  });

  it("returns is_setup_complete true after initialize", async () => {
    await app.request(
      "/api/v1/setup/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: "LinCie",
          base_currency: "IDR",
          seed_categories: false,
        }),
      },
      env,
    );

    const res = await app.request("/api/v1/setup/status", {}, env);

    expect(res.status).toBe(200);
    expect(setupStatusResponseSchema.parse(await res.json())).toEqual({
      is_setup_complete: true,
    });
  });

  it("returns 409 if initialize is called twice", async () => {
    const body = JSON.stringify({
      display_name: "LinCie",
      base_currency: "IDR",
      seed_categories: false,
    });
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    };

    await app.request("/api/v1/setup/initialize", request, env);
    const res = await app.request("/api/v1/setup/initialize", request, env);

    expect(res.status).toBe(409);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "CONFLICT",
        message: "Setup has already been completed",
      },
    });
  });

  it("returns 400 when display_name is missing", async () => {
    const res = await app.request(
      "/api/v1/setup/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_currency: "IDR",
          seed_categories: false,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(JSON.stringify(body)).toContain("display_name");
  });
});
