import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import {
  loginResponseSchema,
  sessionResponseSchema,
} from "../../src/schemas/auth.schema";
import { applyMigrations } from "../setup";

describe("auth routes", () => {
  const db = drizzle(env.DB, { schema });

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

  it("auto-provisions first user and returns session token", async () => {
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

    const body = loginResponseSchema.parse(await res.json());
    expect(typeof body.token).toBe("string");
    expect(body.token).toMatch(/^[a-f0-9]{64}$/);

    const rows = await db.select().from(schema.users).limit(1);
    const passwordHash = rows[0]?.password_hash ?? "";
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      display_name: "Admin",
      role: "primary",
      is_active: 1,
    });
    expect(passwordHash.startsWith("argon2id:") || passwordHash.startsWith("pbkdf2:")).toBe(true);
  }, 30_000);

  it("supports normal login when user already exists", async () => {
    const firstRes = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    const firstBody = loginResponseSchema.parse(await firstRes.json());

    const secondRes = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    expect(secondRes.status).toBe(200);

    const secondBody = loginResponseSchema.parse(await secondRes.json());
    expect(secondBody.token).toMatch(/^[a-f0-9]{64}$/);
    expect(secondBody.token).not.toBe(firstBody.token);
  }, 30_000);

  it("returns 401 for wrong password", async () => {
    await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    const res = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      },
      env,
    );

    expect(res.status).toBe(401);

    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      },
    });
  }, 30_000);

  it("returns 401 for wrong password before any user exists", async () => {
    const res = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      },
      env,
    );

    expect(res.status).toBe(401);

    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      },
    });
  });

  it("returns session user info with a valid token", async () => {
    const loginRes = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    const { token } = loginResponseSchema.parse(await loginRes.json());

    const sessionRes = await app.request(
      "/api/v1/auth/session",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(sessionRes.status).toBe(200);

    const body = sessionResponseSchema.parse(await sessionRes.json());

    const rows = await db.select().from(schema.users).limit(1);
    expect(body).toEqual({
      user_id: rows[0]?.id,
      display_name: "Admin",
      role: "primary",
    });
  }, 30_000);

  it("returns 401 for protected session route without token", async () => {
    const res = await app.request("/api/v1/auth/session", {}, env);

    expect(res.status).toBe(401);

    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
    });
  });

  it("invalidates token on logout", async () => {
    const loginRes = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    const { token } = loginResponseSchema.parse(await loginRes.json());

    const logoutRes = await app.request(
      "/api/v1/auth/logout",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(logoutRes.status).toBe(204);

    const sessionRes = await app.request(
      "/api/v1/auth/session",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(sessionRes.status).toBe(401);
  }, 30_000);

  it("keeps health route public", async () => {
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

  it("uses display_name setting when provisioning first user", async () => {
    const updatedAt = new Date().toISOString();

    await db.insert(schema.settings).values({
      key: "display_name",
      value: "Owner",
      updated_at: updatedAt,
    });

    const loginRes = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );

    expect(loginRes.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.display_name, "Owner"))
      .limit(1);

    expect(rows).toHaveLength(1);
  }, 30_000);

  describe("change password", () => {
    it("changes password and allows login with the new password", async () => {
      const firstLoginRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
        },
        env,
      );
      const firstLoginBody = loginResponseSchema.parse(await firstLoginRes.json());

      const changeRes = await app.request(
        "/api/v1/auth/change-password",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firstLoginBody.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            current_password: env.INITIAL_PASSWORD,
            new_password: "new-password",
          }),
        },
        env,
      );

      expect(changeRes.status).toBe(200);
      expect(await changeRes.json()).toEqual({ message: "Password changed successfully" });

      const secondLoginRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "new-password" }),
        },
        env,
      );

      expect(secondLoginRes.status).toBe(200);
      const secondLoginBody = loginResponseSchema.parse(await secondLoginRes.json());
      expect(secondLoginBody.token).toMatch(/^[a-f0-9]{64}$/);
    }, 90_000);

    it("returns 401 when current password is incorrect", async () => {
      const loginRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
        },
        env,
      );
      const { token } = loginResponseSchema.parse(await loginRes.json());

      const changeRes = await app.request(
        "/api/v1/auth/change-password",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            current_password: "wrong-current-password",
            new_password: "new-password",
          }),
        },
        env,
      );

      expect(changeRes.status).toBe(401);
      const body = errorResponseSchema.parse(await changeRes.json());
      expect(body).toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        },
      });
    }, 30_000);

    it("returns 400 when new password is empty", async () => {
      const loginRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
        },
        env,
      );
      const { token } = loginResponseSchema.parse(await loginRes.json());

      const changeRes = await app.request(
        "/api/v1/auth/change-password",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            current_password: env.INITIAL_PASSWORD,
            new_password: "",
          }),
        },
        env,
      );

      expect(changeRes.status).toBe(400);
      const body = await changeRes.json();
      expect(body).toHaveProperty("error");
      expect(JSON.stringify(body)).toContain("new_password");
    }, 30_000);

    it("returns 401 when changing password without auth token", async () => {
      const res = await app.request(
        "/api/v1/auth/change-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_password: env.INITIAL_PASSWORD,
            new_password: "new-password",
          }),
        },
        env,
      );

      expect(res.status).toBe(401);
      const body = errorResponseSchema.parse(await res.json());
      expect(body).toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      });
    });
  });

  describe("rate limiting", () => {
    it("locks out on sixth failed attempt after five failures", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failedRes = await app.request(
          "/api/v1/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: "wrong-password" }),
          },
          env,
        );
        expect(failedRes.status).toBe(401);
      }

      const lockedRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
        },
        env,
      );

      expect(lockedRes.status).toBe(429);
      const body = errorResponseSchema.parse(await lockedRes.json());
      expect(body).toEqual({
        error: {
          code: "RATE_LIMITED",
          message: "Too many login attempts. Try again in 15 minutes.",
        },
      });
    }, 30_000);

    it("resets failed-login counter after a successful login", async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const failedRes = await app.request(
          "/api/v1/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: "wrong-password" }),
          },
          env,
        );
        expect(failedRes.status).toBe(401);
      }

      const successRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
        },
        env,
      );
      expect(successRes.status).toBe(200);

      const failedAfterResetRes = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "wrong-password" }),
        },
        env,
      );

      expect(failedAfterResetRes.status).toBe(401);
      const body = errorResponseSchema.parse(await failedAfterResetRes.json());
      expect(body.error.code).toBe("UNAUTHORIZED");
    }, 30_000);

    it("allows login after lockout window expires", async () => {
      await env.SESSIONS.put("rate_limit:login:global", "5", { expirationTtl: 60 });
      await new Promise((resolve) => setTimeout(resolve, 61_000));

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
      const body = loginResponseSchema.parse(await res.json());
      expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    }, 90_000);
  });
});
