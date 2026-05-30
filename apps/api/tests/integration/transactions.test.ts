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

  describe("transfers", () => {
    const seedTwoAccounts = async (userId: string) => {
      const source = accountFactory({
        name: "Source Wallet",
        type: "ewallet",
        initial_balance: "5000000.00",
        created_by: userId,
        updated_by: userId,
      });
      const destination = accountFactory({
        name: "Destination Bank",
        type: "bank",
        initial_balance: "1000000.00",
        created_by: userId,
        updated_by: userId,
      });
      await db.insert(schema.accounts).values([source, destination]);
      return { source, destination };
    };

    it("creates a transfer between two accounts (AC-1)", async () => {
      const { token, userId } = await login();
      const { source, destination } = await seedTwoAccounts(userId);

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
            amount: "1000000.00",
            account_id: source.id,
            destination_account_id: destination.id,
            date: "2026-05-28",
          }),
        },
        env,
      );

      expect(res.status).toBe(201);

      const body = transactionSchema.parse(await res.json());
      expect(body).toMatchObject({
        type: "transfer",
        amount: "1000000.00",
        account_id: source.id,
        destination_account_id: destination.id,
        category_id: null,
        created_by: userId,
        updated_by: userId,
        is_deleted: false,
      });
    }, 30_000);

    it("reflects transfer in account balances and net_worth is unchanged (AC-2)", async () => {
      const { token, userId } = await login();
      const { source, destination } = await seedTwoAccounts(userId);

      await app.request(
        "/api/v1/transactions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "transfer",
            amount: "1000000.00",
            account_id: source.id,
            destination_account_id: destination.id,
            date: "2026-05-28",
          }),
        },
        env,
      );

      const accountsRes = await app.request(
        "/api/v1/accounts",
        { headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(accountsRes.status).toBe(200);

      const accountsBody: {
        items: { id: string; current_balance: string }[];
        summary: { net_worth: string };
      } = await accountsRes.json();

      const sourceAccount = accountsBody.items.find((a) => a.id === source.id);
      const destAccount = accountsBody.items.find((a) => a.id === destination.id);

      // Source: 5000000.00 - 1000000.00 = 4000000.00
      expect(sourceAccount?.current_balance).toBe("4000000.00");
      // Destination: 1000000.00 + 1000000.00 = 2000000.00
      expect(destAccount?.current_balance).toBe("2000000.00");
      // Net worth unchanged: 5000000.00 + 1000000.00 = 6000000.00
      expect(accountsBody.summary.net_worth).toBe("6000000.00");
    }, 30_000);

    it("rejects same-account transfer (AC-4)", async () => {
      const { token, userId } = await login();
      const { source } = await seedTwoAccounts(userId);

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
            account_id: source.id,
            destination_account_id: source.id,
          }),
        },
        env,
      );

      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(await res.json())).toEqual({
        error: {
          code: "TRANSFER_SAME_ACCOUNT",
          message: "Source and destination accounts must be different",
        },
      });
    }, 30_000);

    it("rejects transfer without destination_account_id (AC-5)", async () => {
      const { token, userId } = await login();
      const { source } = await seedTwoAccounts(userId);

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
            account_id: source.id,
          }),
        },
        env,
      );

      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("VALIDATION_ERROR");
    }, 30_000);

    it("rejects transfer with non-existent destination account (AC-6)", async () => {
      const { token, userId } = await login();
      const { source } = await seedTwoAccounts(userId);

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
            account_id: source.id,
            destination_account_id: "non-existent-account-id",
          }),
        },
        env,
      );

      expect(res.status).toBe(404);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("ACCOUNT_NOT_FOUND");
    }, 30_000);

    it("rejects transfer with inactive destination account (AC-6)", async () => {
      const { token, userId } = await login();
      const { source, destination } = await seedTwoAccounts(userId);

      // Deactivate the destination account
      await db
        .update(schema.accounts)
        .set({ is_active: 0 })
        .where(eq(schema.accounts.id, destination.id));

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
            account_id: source.id,
            destination_account_id: destination.id,
          }),
        },
        env,
      );

      expect(res.status).toBe(404);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("ACCOUNT_NOT_FOUND");
    }, 30_000);

    it("handles idempotent transfer creation (AC-7)", async () => {
      const { token, userId } = await login();
      const { source, destination } = await seedTwoAccounts(userId);

      const payload = {
        id: "transfer-idempotent-1",
        type: "transfer",
        amount: "250000.00",
        account_id: source.id,
        destination_account_id: destination.id,
        date: "2026-05-28",
      };

      const firstRes = await app.request(
        "/api/v1/transactions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
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
          body: JSON.stringify(payload),
        },
        env,
      );

      expect(secondRes.status).toBe(200);

      const replay = transactionSchema.parse(await secondRes.json());
      expect(replay.id).toBe("transfer-idempotent-1");
      expect(replay.amount).toBe("250000.00");
    }, 30_000);

    it("allows transfer without category_id (AC-8)", async () => {
      const { token, userId } = await login();
      const { source, destination } = await seedTwoAccounts(userId);

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
            amount: "100000.00",
            account_id: source.id,
            destination_account_id: destination.id,
          }),
        },
        env,
      );

      expect(res.status).toBe(201);

      const body = transactionSchema.parse(await res.json());
      expect(body.category_id).toBeNull();
    }, 30_000);
  });

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
