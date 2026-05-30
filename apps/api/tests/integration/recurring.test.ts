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
});
