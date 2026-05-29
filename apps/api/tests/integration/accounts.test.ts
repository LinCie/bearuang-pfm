import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { loginResponseSchema } from "../../src/schemas/auth.schema";
import {
  accountListResponseSchema,
  accountSchema,
} from "../../src/schemas/account.schema";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import { accountFactory } from "../fixtures/factories";
import { applyMigrations } from "../setup";

describe("account routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);

    const row = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
      .first();

    expect(row).not.toBeNull();
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM accounts").run();
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

  it("creates an account and returns 201", async () => {
    const { token, userId } = await login();

    const res = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "BCA Savings",
          type: "bank",
          currency: "IDR",
          initial_balance: "5000000.00",
        }),
      },
      env,
    );

    expect(res.status).toBe(201);

    const body = accountSchema.parse(await res.json());
    expect(body).toMatchObject({
      name: "BCA Savings",
      type: "bank",
      currency: "IDR",
      initial_balance: "5000000.00",
      is_active: true,
      created_by: userId,
      updated_by: userId,
    });

    const rows = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, body.id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_active).toBe(1);
    expect(rows[0]?.initial_balance).toBe("5000000.00");
  }, 30_000);

  it('defaults initial_balance to "0" when omitted', async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Cash Wallet",
          type: "cash",
          currency: "IDR",
        }),
      },
      env,
    );

    expect(res.status).toBe(201);

    const body = accountSchema.parse(await res.json());
    expect(body.initial_balance).toBe("0");
  }, 30_000);

  it("returns 400 for invalid account type", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Crypto Wallet",
          type: "crypto",
          currency: "IDR",
          initial_balance: "100",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);

    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Validation failed");
  }, 30_000);

  it("lists only active accounts ordered by created_at then name", async () => {
    const { token, userId } = await login();
    const sharedTime = "2026-01-02T00:00:00.000Z";

    await db.insert(schema.accounts).values([
      accountFactory({
        name: "Cash Wallet",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        created_by: userId,
        updated_by: userId,
      }),
      accountFactory({
        name: "Beta Account",
        created_at: sharedTime,
        updated_at: sharedTime,
        created_by: userId,
        updated_by: userId,
      }),
      accountFactory({
        name: "Alpha Account",
        created_at: sharedTime,
        updated_at: sharedTime,
        created_by: userId,
        updated_by: userId,
      }),
      accountFactory({
        name: "Hidden Account",
        is_active: 0,
        created_at: "2025-12-31T00:00:00.000Z",
        updated_at: "2025-12-31T00:00:00.000Z",
        created_by: userId,
        updated_by: userId,
      }),
    ]);

    const res = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountListResponseSchema.parse(await res.json());
    expect(body.items.map((item) => item.name)).toEqual([
      "Cash Wallet",
      "Alpha Account",
      "Beta Account",
    ]);
    expect(body.items.every((item) => item.is_active)).toBe(true);
  }, 30_000);

  it("list includes current_balance and summary", async () => {
    const { token, userId } = await login();

    await db.insert(schema.accounts).values(
      accountFactory({
        name: "Main Account",
        initial_balance: "1000.00",
        created_by: userId,
        updated_by: userId,
      }),
    );

    const res = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountListResponseSchema.parse(await res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.current_balance).toBe("1000.00");
    expect(body.summary).toEqual({
      total_assets: "1000.00",
      total_liabilities: "0",
      net_worth: "1000.00",
    });
  }, 30_000);

  it("summary computes net worth from assets and liabilities", async () => {
    const { token, userId } = await login();

    await db.insert(schema.accounts).values([
      accountFactory({
        name: "Checking",
        type: "bank",
        initial_balance: "5000000.00",
        created_by: userId,
        updated_by: userId,
      }),
      accountFactory({
        name: "Cash",
        type: "cash",
        initial_balance: "1000.00",
        created_by: userId,
        updated_by: userId,
      }),
      accountFactory({
        name: "Card",
        type: "credit_card",
        initial_balance: "2000000.00",
        created_by: userId,
        updated_by: userId,
      }),
    ]);

    const res = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountListResponseSchema.parse(await res.json());
    expect(body.summary).toEqual({
      total_assets: "5001000.00",
      total_liabilities: "2000000.00",
      net_worth: "3001000.00",
    });
  }, 30_000);

  it("excludes soft-deleted accounts from listing and net worth", async () => {
    const { token, userId } = await login();

    const active = accountFactory({
      name: "Active Savings",
      type: "bank",
      initial_balance: "100.00",
      created_by: userId,
      updated_by: userId,
    });
    const deleted = accountFactory({
      name: "Deleted Savings",
      type: "bank",
      initial_balance: "999.99",
      is_active: 0,
      created_by: userId,
      updated_by: userId,
    });

    await db.insert(schema.accounts).values([active, deleted]);

    const res = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountListResponseSchema.parse(await res.json());
    expect(body.items.find((item) => item.id === deleted.id)).toBeUndefined();
    expect(body.summary).toEqual({
      total_assets: "100.00",
      total_liabilities: "0",
      net_worth: "100.00",
    });
  }, 30_000);

  it('returns a zeroed summary when there are no accounts', async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountListResponseSchema.parse(await res.json());
    expect(body.items).toHaveLength(0);
    expect(body.summary).toEqual({
      total_assets: "0",
      total_liabilities: "0",
      net_worth: "0",
    });
  }, 30_000);

  it("computes a negative net worth when liabilities exceed assets", async () => {
    const { token, userId } = await login();

    await db.insert(schema.accounts).values([
      accountFactory({
        name: "Cash",
        type: "cash",
        initial_balance: "500.00",
        created_by: userId,
        updated_by: userId,
      }),
      accountFactory({
        name: "Mortgage",
        type: "loan",
        initial_balance: "2000.00",
        created_by: userId,
        updated_by: userId,
      }),
    ]);

    const res = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountListResponseSchema.parse(await res.json());
    expect(body.summary).toEqual({
      total_assets: "500.00",
      total_liabilities: "2000.00",
      net_worth: "-1500.00",
    });
  }, 30_000);

  it("gets an account by id including soft-deleted", async () => {
    const { token, userId } = await login();

    const seeded = accountFactory({
      name: "Archived Loan",
      type: "loan",
      is_active: 0,
      created_by: userId,
      updated_by: userId,
    });

    await db.insert(schema.accounts).values(seeded);

    const res = await app.request(
      `/api/v1/accounts/${seeded.id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);

    const body = accountSchema.parse(await res.json());
    expect(body).toMatchObject({
      id: seeded.id,
      name: "Archived Loan",
      type: "loan",
      is_active: false,
    });
  }, 30_000);

  it("returns 404 for missing account on get", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/accounts/nonexistent-id",
      {
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
        message: "Account not found",
      },
    });
  }, 30_000);

  it("updates mutable fields and refreshes updated_at", async () => {
    const { token, userId } = await login();

    const createdRes = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Old Name",
          type: "bank",
          currency: "IDR",
          initial_balance: "1000",
        }),
      },
      env,
    );

    const created = accountSchema.parse(await createdRes.json());
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updateRes = await app.request(
      `/api/v1/accounts/${created.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Emergency Fund",
          type: "investment",
          currency: "USD",
        }),
      },
      env,
    );

    expect(updateRes.status).toBe(200);

    const updated = accountSchema.parse(await updateRes.json());
    expect(updated).toMatchObject({
      id: created.id,
      name: "Emergency Fund",
      type: "investment",
      currency: "USD",
      initial_balance: "1000",
      is_active: true,
      created_by: userId,
      updated_by: userId,
    });
    expect(updated.updated_at > created.updated_at).toBe(true);

    const rows = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, created.id))
      .limit(1);

    expect(rows[0]).toMatchObject({
      name: "Emergency Fund",
      type: "investment",
      currency: "USD",
      updated_by: userId,
    });
  }, 30_000);

  it("does not change initial_balance via update", async () => {
    const { token } = await login();

    const createdRes = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Locked Balance",
          type: "bank",
          currency: "IDR",
          initial_balance: "123.45",
        }),
      },
      env,
    );

    const created = accountSchema.parse(await createdRes.json());

    const updateRes = await app.request(
      `/api/v1/accounts/${created.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Locked Balance Updated",
          initial_balance: "999",
        }),
      },
      env,
    );

    expect(updateRes.status).toBe(200);

    const updated = accountSchema.parse(await updateRes.json());
    expect(updated.initial_balance).toBe("123.45");

    const rows = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, created.id))
      .limit(1);

    expect(rows[0]?.initial_balance).toBe("123.45");
  }, 30_000);

  it("returns 404 when updating non-existent account", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/accounts/nonexistent-id",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Missing Account" }),
      },
      env,
    );

    expect(res.status).toBe(404);

    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Account not found",
      },
    });
  }, 30_000);

  it("returns 400 for invalid account type on update", async () => {
    const { token } = await login();

    const createdRes = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Valid Account",
          type: "bank",
          currency: "IDR",
          initial_balance: "100",
        }),
      },
      env,
    );

    const created = accountSchema.parse(await createdRes.json());

    const res = await app.request(
      `/api/v1/accounts/${created.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "crypto" }),
      },
      env,
    );

    expect(res.status).toBe(400);

    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Validation failed");
  }, 30_000);

  it("soft-deletes an account", async () => {
    const { token } = await login();

    const createdRes = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Disposable Account",
          type: "ewallet",
          currency: "IDR",
          initial_balance: "10",
        }),
      },
      env,
    );

    const created = accountSchema.parse(await createdRes.json());

    const deleteRes = await app.request(
      `/api/v1/accounts/${created.id}`,
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
      .from(schema.accounts)
      .where(eq(schema.accounts.id, created.id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_active).toBe(0);

    const listRes = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(listRes.status).toBe(200);

    const listBody = accountListResponseSchema.parse(await listRes.json());
    expect(listBody.items.find((item) => item.id === created.id)).toBeUndefined();
  }, 30_000);

  it("returns 404 when deleting non-existent account", async () => {
    const { token } = await login();

    const res = await app.request(
      "/api/v1/accounts/nonexistent-id",
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
        message: "Account not found",
      },
    });
  }, 30_000);

  it("restores a soft-deleted account via put is_active true", async () => {
    const { token } = await login();

    const createdRes = await app.request(
      "/api/v1/accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Restorable Account",
          type: "credit_card",
          currency: "IDR",
          initial_balance: "-250",
        }),
      },
      env,
    );

    const created = accountSchema.parse(await createdRes.json());

    const deleteRes = await app.request(
      `/api/v1/accounts/${created.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(deleteRes.status).toBe(204);

    const restoreRes = await app.request(
      `/api/v1/accounts/${created.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_active: true }),
      },
      env,
    );

    expect(restoreRes.status).toBe(200);

    const restored = accountSchema.parse(await restoreRes.json());
    expect(restored.is_active).toBe(true);

    const listRes = await app.request(
      "/api/v1/accounts",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env,
    );

    expect(listRes.status).toBe(200);

    const listBody = accountListResponseSchema.parse(await listRes.json());
    expect(listBody.items.find((item) => item.id === created.id)).toBeDefined();
  }, 30_000);

  it("requires auth on create, list, get, update, and delete", async () => {
    const cases = [
      {
        path: "/api/v1/accounts",
        options: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Unauthorized Create",
            type: "bank",
            currency: "IDR",
            initial_balance: "0",
          }),
        },
      },
      {
        path: "/api/v1/accounts",
        options: {},
      },
      {
        path: "/api/v1/accounts/nonexistent-id",
        options: {},
      },
      {
        path: "/api/v1/accounts/nonexistent-id",
        options: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Unauthorized Update" }),
        },
      },
      {
        path: "/api/v1/accounts/nonexistent-id",
        options: {
          method: "DELETE",
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
