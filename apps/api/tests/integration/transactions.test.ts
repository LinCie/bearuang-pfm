import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { loginResponseSchema } from "../../src/schemas/auth.schema";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import {
  transactionDetailSchema,
  transactionSchema,
} from "../../src/schemas/transaction.schema";
import { accountFactory, categoryFactory } from "../fixtures/factories";
import { applyMigrations } from "../setup";

describe("transaction routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);

    const row = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'")
      .first();

    expect(row).not.toBeNull();
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM transactions").run();
    await env.DB.prepare("DELETE FROM accounts").run();
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

  const seedAccountAndCategories = async (userId: string) => {
    const account = accountFactory({
      name: "BCA Savings",
      type: "bank",
      initial_balance: "1000.00",
      created_by: userId,
      updated_by: userId,
    });
    const expenseCategory = categoryFactory({
      name: "Food",
      type: "expense",
      created_by: userId,
      updated_by: userId,
    });
    const incomeCategory = categoryFactory({
      name: "Salary",
      type: "income",
      created_by: userId,
      updated_by: userId,
    });

    await db.insert(schema.accounts).values(account);
    await db.insert(schema.categories).values([expenseCategory, incomeCategory]);

    return { account, expenseCategory, incomeCategory };
  };

  it("creates an expense with a client UUID and increments category usage_count", async () => {
    const { token, userId } = await login();
    const { account, expenseCategory } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "client-uuid-123",
          type: "expense",
          amount: "50000.00",
          account_id: account.id,
          category_id: expenseCategory.id,
          date: "2026-05-28",
          payee: "Warung Makan",
          notes: "Lunch",
        }),
      },
      env,
    );

    expect(res.status).toBe(201);

    const body = transactionSchema.parse(await res.json());
    expect(body).toMatchObject({
      id: "client-uuid-123",
      type: "expense",
      amount: "50000.00",
      account_id: account.id,
      category_id: expenseCategory.id,
      destination_account_id: null,
      payee: "Warung Makan",
      notes: "Lunch",
      date: "2026-05-28",
      created_by: userId,
      updated_by: userId,
      is_deleted: false,
      deleted_at: null,
    });

    const categoryRows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, expenseCategory.id))
      .limit(1);

    expect(categoryRows[0]?.usage_count).toBe(1);
  }, 30_000);

  it("creates an income with a server-generated UUID", async () => {
    const { token, userId } = await login();
    const { account, incomeCategory } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "income",
          amount: "15000000.00",
          account_id: account.id,
          category_id: incomeCategory.id,
          date: "2026-05-01",
        }),
      },
      env,
    );

    expect(res.status).toBe(201);

    const body = transactionSchema.parse(await res.json());
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.type).toBe("income");
  }, 30_000);

  it("treats repeated client UUID posts as idempotent replays", async () => {
    const { token, userId } = await login();
    const { account, expenseCategory, incomeCategory } = await seedAccountAndCategories(userId);

    const firstRes = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "offline-retry-1",
          type: "expense",
          amount: "50000.00",
          account_id: account.id,
          category_id: expenseCategory.id,
          date: "2026-05-28",
          payee: "Warung Makan",
          notes: "Lunch",
        }),
      },
      env,
    );

    expect(firstRes.status).toBe(201);

    const secondRes = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "offline-retry-1",
          type: "income",
          amount: "999999.00",
          account_id: account.id,
          category_id: incomeCategory.id,
          date: "2026-05-29",
          payee: "Ignored",
          notes: "Ignored",
        }),
      },
      env,
    );

    expect(secondRes.status).toBe(200);

    const replay = transactionSchema.parse(await secondRes.json());
    expect(replay).toMatchObject({
      id: "offline-retry-1",
      type: "expense",
      amount: "50000.00",
      category_id: expenseCategory.id,
      payee: "Warung Makan",
      notes: "Lunch",
      date: "2026-05-28",
    });

    const transactionRows = await db.select().from(schema.transactions);
    const categoryRows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, expenseCategory.id))
      .limit(1);

    expect(transactionRows).toHaveLength(1);
    expect(categoryRows[0]?.usage_count).toBe(1);
  }, 30_000);

  it("returns account and category names from get-by-id", async () => {
    const { token, userId } = await login();
    const { account, expenseCategory } = await seedAccountAndCategories(userId);

    const createRes = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "tx-detail-1",
          type: "expense",
          amount: "10000.00",
          account_id: account.id,
          category_id: expenseCategory.id,
          date: "2026-05-28",
        }),
      },
      env,
    );

    expect(createRes.status).toBe(201);

    const detailRes = await app.request(
      "/api/v1/transactions/tx-detail-1",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(detailRes.status).toBe(200);

    const detail = transactionDetailSchema.parse(await detailRes.json());
    expect(detail.account_name).toBe("BCA Savings");
    expect(detail.category_name).toBe("Food");
  }, 30_000);

  it("returns validation errors for missing required fields", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category_id: "missing-required-fields",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);

    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Validation failed");
  }, 30_000);

  it("returns ACCOUNT_NOT_FOUND for unknown accounts", async () => {
    const { token, userId } = await login();
    const { expenseCategory } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "expense",
          amount: "500.00",
          account_id: "missing-account",
          category_id: expenseCategory.id,
        }),
      },
      env,
    );

    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
      },
    });
  }, 30_000);

  it("returns CATEGORY_NOT_FOUND for unknown categories", async () => {
    const { token, userId } = await login();
    const { account } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "expense",
          amount: "500.00",
          account_id: account.id,
          category_id: "missing-category",
        }),
      },
      env,
    );

    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "CATEGORY_NOT_FOUND",
        message: "Category not found",
      },
    });
  }, 30_000);

  it("defaults date to today and rejects invalid dates", async () => {
    const { token, userId } = await login();
    const { account, expenseCategory } = await seedAccountAndCategories(userId);

    const createRes = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "expense",
          amount: "500.00",
          account_id: account.id,
          category_id: expenseCategory.id,
        }),
      },
      env,
    );

    expect(createRes.status).toBe(201);

    const created = transactionSchema.parse(await createRes.json());
    expect(created.date).toBe(new Date().toISOString().slice(0, 10));

    const invalidRes = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "expense",
          amount: "500.00",
          account_id: account.id,
          category_id: expenseCategory.id,
          date: "2026-99-99",
        }),
      },
      env,
    );

    expect(invalidRes.status).toBe(400);

    const error = errorResponseSchema.parse(await invalidRes.json());
    expect(error.error.code).toBe("VALIDATION_ERROR");
  }, 30_000);

  it("rejects transfer creation for this story", async () => {
    const { token, userId } = await login();
    const { account, expenseCategory } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "transfer",
          amount: "500.00",
          account_id: account.id,
          category_id: expenseCategory.id,
        }),
      },
      env,
    );

    expect(res.status).toBe(501);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Transfers are not yet supported",
      },
    });
  }, 30_000);

  it("rejects non-positive amounts with a validation error", async () => {
    const { token, userId } = await login();
    const { account, expenseCategory } = await seedAccountAndCategories(userId);

    for (const amount of ["-50000.00", "0", "0.00"]) {
      const res = await app.request(
        "/api/v1/transactions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "expense",
            amount,
            account_id: account.id,
            category_id: expenseCategory.id,
          }),
        },
        env,
      );

      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  }, 30_000);

  it("rejects a category whose type does not match the transaction type", async () => {
    const { token, userId } = await login();
    const { account, incomeCategory } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "expense",
          amount: "500.00",
          account_id: account.id,
          category_id: incomeCategory.id,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("CATEGORY_TYPE_MISMATCH");
  }, 30_000);

  it("rejects expense/income with no category_id as a required-field error", async () => {
    const { token, userId } = await login();
    const { account } = await seedAccountAndCategories(userId);

    const res = await app.request(
      "/api/v1/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "expense",
          amount: "500.00",
          account_id: account.id,
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("CATEGORY_REQUIRED");
  }, 30_000);

  it("requires auth on create and get", async () => {
    const cases = [
      {
        path: "/api/v1/transactions",
        options: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "expense",
            amount: "1.00",
            account_id: "account-id",
            category_id: "category-id",
          }),
        },
      },
      {
        path: "/api/v1/transactions/nonexistent-id",
        options: {},
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
