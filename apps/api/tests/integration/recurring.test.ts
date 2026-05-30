import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { loginResponseSchema } from "../../src/schemas/auth.schema";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import {
  recurringListResponseSchema,
  recurringTemplateSchema,
} from "../../src/schemas/recurring.schema";
import { accountFactory, categoryFactory } from "../fixtures/factories";
import { applyMigrations } from "../setup";

describe("recurring routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM recurring_occurrences").run();
    await env.DB.prepare("DELETE FROM recurring_templates").run();
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
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: env.INITIAL_PASSWORD }) },
      env,
    );
    expect(res.status).toBe(200);
    const { token } = loginResponseSchema.parse(await res.json());
    const users = await db.select().from(schema.users).limit(1);
    return { token, userId: users[0]?.id ?? "" };
  };

  const seedAccountAndCategory = async (userId: string) => {
    const account = accountFactory({ created_by: userId, updated_by: userId });
    const category = categoryFactory({ created_by: userId, updated_by: userId, type: "expense" });
    await db.insert(schema.accounts).values(account);
    await db.insert(schema.categories).values(category);
    return { account, category };
  };

  const createRecurring = async (token: string, body: Record<string, unknown>) => {
    return app.request(
      "/api/v1/recurring",
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      env,
    );
  };

  describe("POST /api/v1/recurring", () => {
    it("creates a recurring template and returns 201", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const res = await createRecurring(token, {
        type: "expense",
        amount: "150000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
        payee: "Internet Provider",
        notes: "Home internet",
      });

      expect(res.status).toBe(201);
      const body = recurringTemplateSchema.parse(await res.json());
      expect(body).toMatchObject({
        type: "expense",
        amount: "150000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
        payee: "Internet Provider",
        notes: "Home internet",
        is_active: true,
        created_by: userId,
      });
      expect(body.id).toBeDefined();
      expect(body.created_at).toBeDefined();
    });

    it("returns 400 for invalid frequency", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const res = await createRecurring(token, {
        type: "expense",
        amount: "100.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "quarterly",
        start_date: "2026-06-01",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid amount", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const res = await createRecurring(token, {
        type: "expense",
        amount: "0.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing required fields", async () => {
      const { token } = await login();

      const res = await createRecurring(token, { type: "expense" });
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent account_id", async () => {
      const { token, userId } = await login();
      const { category } = await seedAccountAndCategory(userId);

      const res = await createRecurring(token, {
        type: "expense",
        amount: "100.00",
        account_id: "non-existent-id",
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });

      expect(res.status).toBe(404);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("ACCOUNT_NOT_FOUND");
    });

    it("returns 404 for non-existent category_id", async () => {
      const { token, userId } = await login();
      const { account } = await seedAccountAndCategory(userId);

      const res = await createRecurring(token, {
        type: "expense",
        amount: "100.00",
        account_id: account.id,
        category_id: "non-existent-id",
        frequency: "monthly",
        start_date: "2026-06-01",
      });

      expect(res.status).toBe(404);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("CATEGORY_NOT_FOUND");
    });

    it("returns 400 for inactive account", async () => {
      const { token, userId } = await login();
      const { category } = await seedAccountAndCategory(userId);
      const inactiveAccount = accountFactory({ created_by: userId, updated_by: userId, is_active: 0 });
      await db.insert(schema.accounts).values(inactiveAccount);

      const res = await createRecurring(token, {
        type: "expense",
        amount: "100.00",
        account_id: inactiveAccount.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });

      expect(res.status).toBe(400);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("ACCOUNT_INACTIVE");
    });

    it("returns 401 without auth", async () => {
      const res = await app.request(
        "/api/v1/recurring",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
        env,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/recurring", () => {
    it("returns active templates with next_due_date", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });

      const res = await app.request(
        "/api/v1/recurring",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = recurringListResponseSchema.parse(await res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.next_due_date).toBeDefined();
      expect(body.items[0]?.is_active).toBe(true);
    });

    it("excludes deactivated templates", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      await app.request(
        `/api/v1/recurring/${created.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      const res = await app.request(
        "/api/v1/recurring",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = recurringListResponseSchema.parse(await res.json());
      expect(body.items).toHaveLength(0);
    });
  });

  describe("GET /api/v1/recurring/:id", () => {
    it("returns template by id", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "income",
        amount: "5000000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
        payee: "Employer",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = recurringTemplateSchema.parse(await res.json());
      expect(body.id).toBe(created.id);
      expect(body.payee).toBe("Employer");
    });

    it("returns 404 for non-existent id", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/recurring/non-existent",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/v1/recurring/:id", () => {
    it("updates template fields", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "100000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ amount: "200000.00", frequency: "weekly", payee: "Updated Payee" }),
        },
        env,
      );

      expect(res.status).toBe(200);
      const body = recurringTemplateSchema.parse(await res.json());
      expect(body.amount).toBe("200000.00");
      expect(body.frequency).toBe("weekly");
      expect(body.payee).toBe("Updated Payee");
      expect(body.updated_at).not.toBe(created.updated_at);
    });

    it("returns 404 for non-existent template", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/recurring/non-existent",
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ amount: "200000.00" }),
        },
        env,
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent category_id in update", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "100000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ category_id: "non-existent" }),
        },
        env,
      );

      expect(res.status).toBe(404);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("CATEGORY_NOT_FOUND");
    });
  });

  describe("DELETE /api/v1/recurring/:id", () => {
    it("deactivates template and returns 204", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "100000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(204);

      // Verify deactivated
      const getRes = await app.request(
        `/api/v1/recurring/${created.id}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );
      const body = recurringTemplateSchema.parse(await getRes.json());
      expect(body.is_active).toBe(false);
    });

    it("returns 404 for non-existent template", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/recurring/non-existent",
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("next_due_date computation", () => {
    it("computes next_due_date excluding posted occurrences", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      // Insert a posted occurrence for 2026-06-01
      await db.insert(schema.recurringOccurrences).values({
        id: crypto.randomUUID(),
        template_id: created.id,
        due_date: "2026-06-01",
        status: "posted",
        transaction_id: null,
        created_at: new Date().toISOString(),
      });

      const res = await app.request(
        "/api/v1/recurring",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = recurringListResponseSchema.parse(await res.json());
      expect(body.items[0]?.next_due_date).toBe("2026-07-01");
    });
  });

  describe("GET /api/v1/recurring/:id/upcoming", () => {
    it("returns upcoming occurrences for a monthly template", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "100000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=3`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { id: string; due_date: string; status: string }[] } = await res.json();
      expect(body.items).toHaveLength(3);
      expect(body.items[0]?.due_date).toBe("2026-06-01");
      expect(body.items[1]?.due_date).toBe("2026-07-01");
      expect(body.items[2]?.due_date).toBe("2026-08-01");
      expect(body.items[0]?.status).toBe("pending");
    });

    it("returns weekly occurrences with 7-day intervals", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "weekly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=4`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { due_date: string }[] } = await res.json();
      expect(body.items[0]?.due_date).toBe("2026-06-01");
      expect(body.items[1]?.due_date).toBe("2026-06-08");
      expect(body.items[2]?.due_date).toBe("2026-06-15");
      expect(body.items[3]?.due_date).toBe("2026-06-22");
    });

    it("returns biweekly occurrences with 14-day intervals", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "75000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "biweekly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=3`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { due_date: string }[] } = await res.json();
      expect(body.items[0]?.due_date).toBe("2026-06-01");
      expect(body.items[1]?.due_date).toBe("2026-06-15");
      expect(body.items[2]?.due_date).toBe("2026-06-29");
    });

    it("clamps month-end dates (Jan 31 → Feb 28)", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "200000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-01-31",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=3`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { due_date: string }[] } = await res.json();
      expect(body.items[0]?.due_date).toBe("2026-01-31");
      expect(body.items[1]?.due_date).toBe("2026-02-28");
      expect(body.items[2]?.due_date).toBe("2026-03-28");
    });

    it("handles yearly with leap year (Feb 29 → Feb 28 in non-leap year)", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "1000000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "yearly",
        start_date: "2024-02-29",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=3`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { due_date: string }[] } = await res.json();
      expect(body.items[0]?.due_date).toBe("2024-02-29");
      expect(body.items[1]?.due_date).toBe("2025-02-28");
      expect(body.items[2]?.due_date).toBe("2026-02-28");
    });

    it("does not generate occurrences past end_date", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
        end_date: "2026-08-15",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=12`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { due_date: string }[] } = await res.json();
      expect(body.items).toHaveLength(3);
      expect(body.items[2]?.due_date).toBe("2026-08-01");
    });

    it("merges existing DB occurrences with computed ones", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const occId = crypto.randomUUID();
      await db.insert(schema.recurringOccurrences).values({
        id: occId,
        template_id: created.id,
        due_date: "2026-06-01",
        status: "posted",
        transaction_id: null,
        created_at: new Date().toISOString(),
      });

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming?limit=3`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { id: string; due_date: string; status: string; transaction_id: string | null }[] } = await res.json();
      expect(body.items[0]?.id).toBe(occId);
      expect(body.items[0]?.status).toBe("posted");
      expect(body.items[0]?.transaction_id).toBeNull();
      expect(body.items[1]?.status).toBe("pending");
      expect(body.items[1]?.id).toBe("2026-07-01");
    });

    it("returns 404 for non-existent template", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/recurring/non-existent/upcoming",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
    });

    it("defaults to 12 occurrences when no limit specified", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/upcoming`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: unknown[] } = await res.json();
      expect(body.items).toHaveLength(12);
    });
  });

  describe("POST /api/v1/recurring/:id/occurrences/:occId/confirm", () => {
    it("creates a transaction and marks occurrence as posted", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "150000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
        payee: "Internet Provider",
        notes: "Monthly internet",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { occurrence: { status: string; transaction_id: string }; transaction: { id: string; type: string; amount: string; date: string; payee: string; notes: string } } = await res.json();
      expect(body.occurrence.status).toBe("posted");
      expect(body.occurrence.transaction_id).toBe(body.transaction.id);
      expect(body.transaction.type).toBe("expense");
      expect(body.transaction.amount).toBe("150000.00");
      expect(body.transaction.date).toBe("2026-06-01");
      expect(body.transaction.payee).toBe("Internet Provider");
      expect(body.transaction.notes).toBe("Monthly internet");
    });

    it("updates account balance after confirm", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "100000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      // Check account balance reflects the expense
      const accountRes = await app.request(
        "/api/v1/accounts",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );
      expect(accountRes.status).toBe(200);
      const accountBody: { items: { id: string; current_balance: string }[] } = await accountRes.json();
      const acct = accountBody.items.find((a) => a.id === account.id);
      expect(acct?.current_balance).toBe("-100000.00");
    });

    it("returns 409 for already-posted occurrence", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      // First confirm
      await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      // Second confirm → 409
      const res = await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(409);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("OCCURRENCE_ALREADY_PROCESSED");
    });

    it("returns 404 for non-existent template", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/recurring/non-existent/occurrences/2026-06-01/confirm",
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 for invalid occurrence id format", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/occurrences/invalid-format/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/recurring/:id/occurrences/:occId/skip", () => {
    it("marks occurrence as skipped without creating transaction", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      const res = await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/skip`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { status: string; transaction_id: string | null } = await res.json();
      expect(body.status).toBe("skipped");
      expect(body.transaction_id).toBeNull();
    });

    it("does not affect account balance", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/skip`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      const accountRes = await app.request(
        "/api/v1/accounts",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );
      expect(accountRes.status).toBe(200);
      const accountBody: { items: { id: string; current_balance: string }[] } = await accountRes.json();
      const acct = accountBody.items.find((a) => a.id === account.id);
      expect(acct?.current_balance).toBe("0");
    });

    it("returns 409 for already-skipped occurrence", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/skip`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      const res = await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/skip`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(409);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("OCCURRENCE_ALREADY_PROCESSED");
    });

    it("returns 409 when trying to skip a posted occurrence", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      const createRes = await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });
      const created = recurringTemplateSchema.parse(await createRes.json());

      await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      const res = await app.request(
        `/api/v1/recurring/${created.id}/occurrences/2026-06-01/skip`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent template", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/recurring/non-existent/occurrences/2026-06-01/skip",
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/recurring?upcoming_days=N", () => {
    it("returns consolidated upcoming across all templates", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      // Create a template with start_date in the past so occurrences fall within upcoming_days
      const today = new Date().toISOString().slice(0, 10);
      await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "daily",
        start_date: today,
        payee: "Daily Coffee",
      });

      const res = await app.request(
        "/api/v1/recurring?upcoming_days=7",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body: { items: { template_payee: string; template_amount: string; due_date: string; account_id: string }[] } = await res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0]?.template_payee).toBe("Daily Coffee");
      expect(body.items[0]?.template_amount).toBe("50000.00");
      expect(body.items[0]?.account_id).toBeDefined();
    });

    it("returns regular template list when upcoming_days is not provided", async () => {
      const { token, userId } = await login();
      const { account, category } = await seedAccountAndCategory(userId);

      await createRecurring(token, {
        type: "expense",
        amount: "50000.00",
        account_id: account.id,
        category_id: category.id,
        frequency: "monthly",
        start_date: "2026-06-01",
      });

      const res = await app.request(
        "/api/v1/recurring",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = recurringListResponseSchema.parse(await res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.next_due_date).toBeDefined();
    });
  });
});
