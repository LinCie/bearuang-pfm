import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import { loginResponseSchema } from "../../src/schemas/auth.schema";
import {
  settingsListResponseSchema,
  updateSettingsResponseSchema,
} from "../../src/schemas/settings.schema";
import { applyMigrations } from "../setup";

describe("settings routes", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM settings").run();
    const kvList = await env.SESSIONS.list();
    await Promise.all(kvList.keys.map((k) => env.SESSIONS.delete(k.name) as Promise<void>));
    await env.SESSIONS.delete("rate_limit:login:global");
  });

  const login = async () => {
    const res = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    expect(res.status).toBe(200);
    return loginResponseSchema.parse(await res.json()).token;
  };

  it("returns an empty list on a fresh instance", async () => {
    const token = await login();

    const res = await app.request(
      "/api/v1/settings",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(settingsListResponseSchema.parse(await res.json())).toEqual({
      items: [],
    });
  }, 30_000);

  it("upserts a setting and returns the updated item", async () => {
    const token = await login();

    const putRes = await app.request(
      "/api/v1/settings",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "theme", value: "dark" }),
      },
      env,
    );

    expect(putRes.status).toBe(200);
    expect(updateSettingsResponseSchema.parse(await putRes.json())).toMatchObject({
      key: "theme",
      value: "dark",
    });

    const getRes = await app.request(
      "/api/v1/settings",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(getRes.status).toBe(200);
    const body = settingsListResponseSchema.parse(await getRes.json());
    expect(body.items).toContainEqual(
      expect.objectContaining({
        key: "theme",
        value: "dark",
      }),
    );
  }, 30_000);

  it("updates an existing key on repeated PUT", async () => {
    const token = await login();

    const firstRes = await app.request(
      "/api/v1/settings",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "theme", value: "dark" }),
      },
      env,
    );

    expect(firstRes.status).toBe(200);

    const secondRes = await app.request(
      "/api/v1/settings",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "theme", value: "light" }),
      },
      env,
    );

    expect(secondRes.status).toBe(200);
    expect(updateSettingsResponseSchema.parse(await secondRes.json())).toMatchObject({
      key: "theme",
      value: "light",
    });

    const getRes = await app.request(
      "/api/v1/settings",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    const body = settingsListResponseSchema.parse(await getRes.json());
    expect(body.items).toContainEqual(
      expect.objectContaining({
        key: "theme",
        value: "light",
      }),
    );
  }, 30_000);

  it("returns 400 when key is empty", async () => {
    const token = await login();

    const res = await app.request(
      "/api/v1/settings",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "", value: "dark" }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(JSON.stringify(body)).toContain("key");
  }, 30_000);

  it("returns 401 without auth on GET", async () => {
    const res = await app.request("/api/v1/settings", {}, env);

    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
    });
  });

  it("returns 401 without auth on PUT", async () => {
    const res = await app.request(
      "/api/v1/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "theme", value: "dark" }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
    });
  });
});
