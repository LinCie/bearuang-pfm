import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { loginResponseSchema } from "../../src/schemas/auth.schema";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import { categoryListResponseSchema, categorySchema } from "../../src/schemas/category.schema";
import { categoryFactory } from "../fixtures/factories";
import { applyMigrations } from "../setup";

describe("category routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);

    const row = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
      .first();

    expect(row).not.toBeNull();
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM categories").run();
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

    const { token } = loginResponseSchema.parse(await res.json());
    const users = await db.select().from(schema.users).limit(1);
    const user = users[0];

    if (!user) {
      throw new Error("Login helper did not provision a user");
    }

    return { token, userId: user.id };
  };

  it("creates a new category and returns 201", async () => {
    const { token, userId } = await login();

    const res = await app.request(
      "/api/v1/categories",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Food", type: "expense" }),
      },
      env,
    );

    expect(res.status).toBe(201);

    const body = categorySchema.parse(await res.json());
    expect(body).toMatchObject({
      name: "Food",
      type: "expense",
      usage_count: 0,
      created_by: userId,
      updated_by: userId,
    });

    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, body.id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(body);
  }, 30_000);

  it("returns empty items array when no categories exist", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/categories",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(categoryListResponseSchema.parse(await res.json())).toEqual({
      items: [],
    });
  }, 30_000);

  it("lists categories sorted by usage_count desc then name asc", async () => {
    const { token, userId } = await login();

    await db.insert(schema.categories).values([
      categoryFactory({
        name: "Food",
        type: "expense",
        usage_count: 5,
        created_by: userId,
        updated_by: userId,
      }),
      categoryFactory({
        name: "Transport",
        type: "expense",
        usage_count: 0,
        created_by: userId,
        updated_by: userId,
      }),
      categoryFactory({
        name: "Bills",
        type: "income",
        usage_count: 5,
        created_by: userId,
        updated_by: userId,
      }),
    ]);

    const res = await app.request(
      "/api/v1/categories",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = categoryListResponseSchema.parse(await res.json());
    expect(body.items.map((item) => item.name)).toEqual(["Bills", "Food", "Transport"]);
  }, 30_000);

  it("filters categories by type", async () => {
    const { token, userId } = await login();

    await db.insert(schema.categories).values([
      categoryFactory({
        name: "Food",
        type: "expense",
        created_by: userId,
        updated_by: userId,
      }),
      categoryFactory({
        name: "Salary",
        type: "income",
        created_by: userId,
        updated_by: userId,
      }),
      categoryFactory({
        name: "Gift",
        type: "income",
        created_by: userId,
        updated_by: userId,
      }),
    ]);

    const res = await app.request(
      "/api/v1/categories?type=income",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = categoryListResponseSchema.parse(await res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items.every((item) => item.type === "income")).toBe(true);
  }, 30_000);

  it("returns 400 for invalid type query", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/categories?type=invalid",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(400);

    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Validation failed");
  }, 30_000);

  it("updates a category name and refreshes updated_at", async () => {
    const { token, userId } = await login();

    const createdRes = await app.request(
      "/api/v1/categories",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Food", type: "expense" }),
      },
      env,
    );

    const created = categorySchema.parse(await createdRes.json());
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updateRes = await app.request(
      `/api/v1/categories/${created.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Groceries" }),
      },
      env,
    );

    expect(updateRes.status).toBe(200);

    const updated = categorySchema.parse(await updateRes.json());
    expect(updated).toMatchObject({
      id: created.id,
      name: "Groceries",
      type: "expense",
      created_by: userId,
      updated_by: userId,
      usage_count: 0,
    });
    expect(updated.updated_at > created.updated_at).toBe(true);

    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, created.id))
      .limit(1);

    expect(rows[0]).toMatchObject({
      name: "Groceries",
      updated_by: userId,
    });
  }, 30_000);

  it("returns 404 when updating non-existent category", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/categories/nonexistent-id",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Groceries" }),
      },
      env,
    );

    expect(res.status).toBe(404);

    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Category not found",
      },
    });
  }, 30_000);

  it("hard-deletes a category", async () => {
    const { token } = await login();

    const createdRes = await app.request(
      "/api/v1/categories",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Food", type: "expense" }),
      },
      env,
    );

    const created = categorySchema.parse(await createdRes.json());

    const deleteRes = await app.request(
      `/api/v1/categories/${created.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(deleteRes.status).toBe(204);

    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, created.id));

    expect(rows).toHaveLength(0);
  }, 30_000);

  it("returns 404 when deleting non-existent category", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/categories/nonexistent-id",
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(404);

    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Category not found",
      },
    });
  }, 30_000);

  it("seeds default categories", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/categories/seed",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = categoryListResponseSchema.parse(await res.json());
    expect(body.items).toHaveLength(15);

    const actual = body.items
      .map((item) => `${item.type}:${item.name}`)
      .sort();
    const expected = [
      "expense:Food",
      "expense:Transport",
      "expense:Housing",
      "expense:Utilities",
      "expense:Entertainment",
      "expense:Health",
      "expense:Shopping",
      "expense:Education",
      "expense:Other",
      "income:Salary",
      "income:Freelance",
      "income:Gift",
      "income:Refund",
      "income:Interest",
      "income:Other",
    ].sort();

    expect(actual).toEqual(expected);
  }, 30_000);

  it("seed is idempotent", async () => {
    const { token } = await login();

    const firstRes = await app.request(
      "/api/v1/categories/seed",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(firstRes.status).toBe(200);

    const secondRes = await app.request(
      "/api/v1/categories/seed",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(secondRes.status).toBe(200);

    const body = categoryListResponseSchema.parse(await secondRes.json());
    expect(body.items).toHaveLength(15);

    const rows = await db.select().from(schema.categories);
    expect(rows).toHaveLength(15);
  }, 30_000);

  it("requires auth on create, list, update, delete, and seed", async () => {
    const cases = [
      {
        path: "/api/v1/categories",
        options: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Food", type: "expense" }),
        },
      },
      {
        path: "/api/v1/categories",
        options: {},
      },
      {
        path: "/api/v1/categories/nonexistent-id",
        options: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Groceries" }),
        },
      },
      {
        path: "/api/v1/categories/nonexistent-id",
        options: {
          method: "DELETE",
        },
      },
      {
        path: "/api/v1/categories/seed",
        options: {
          method: "POST",
        },
      },
    ] as const;

    for (const testCase of cases) {
      const res = await app.request(testCase.path, testCase.options, env);

      expect(res.status).toBe(401);
      expect(errorResponseSchema.parse(await res.json())).toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      });
    }
  });
});
