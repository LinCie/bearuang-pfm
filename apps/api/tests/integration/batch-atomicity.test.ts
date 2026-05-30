import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { accountFactory } from "../fixtures/factories";
import { applyMigrations, seedUser } from "../setup";

describe("db.batch() atomicity verification", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM transactions").run();
    await env.DB.prepare("DELETE FROM accounts").run();
    await env.DB.prepare("DELETE FROM categories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM settings").run();
  });

  it("verifies whether db.batch() rolls back all statements on partial failure", async () => {
    const user = await seedUser(db);
    const account = accountFactory({ created_by: user.id, updated_by: user.id });
    await db.insert(schema.accounts).values(account);

    // Insert a known row so we can trigger a UNIQUE constraint violation
    const existingId = "atomicity-probe-existing";
    const now = new Date().toISOString();
    await db.insert(schema.transactions).values({
      id: existingId,
      type: "expense",
      amount: "100.00",
      account_id: account.id,
      destination_account_id: null,
      category_id: null,
      payee: null,
      notes: null,
      date: "2026-01-01",
      created_by: user.id,
      updated_by: user.id,
      is_deleted: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });

    // Attempt a batch: stmt1 should succeed, stmt2 should fail (duplicate PK)
    const newId = "atomicity-probe-new";
    const stmt1 = db.insert(schema.transactions).values({
      id: newId,
      type: "expense",
      amount: "200.00",
      account_id: account.id,
      destination_account_id: null,
      category_id: null,
      payee: null,
      notes: null,
      date: "2026-01-02",
      created_by: user.id,
      updated_by: user.id,
      is_deleted: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
    const stmt2 = db.insert(schema.transactions).values({
      id: existingId, // duplicate — will fail
      type: "expense",
      amount: "300.00",
      account_id: account.id,
      destination_account_id: null,
      category_id: null,
      payee: null,
      notes: null,
      date: "2026-01-03",
      created_by: user.id,
      updated_by: user.id,
      is_deleted: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });

    let batchFailed = false;
    try {
      await db.batch([stmt1, stmt2]);
    } catch {
      batchFailed = true;
    }

    expect(batchFailed).toBe(true);

    // Check if stmt1's row was committed (NOT atomic) or rolled back (atomic)
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, newId));

    // VERIFIED: db.batch() IS atomic — stmt1 rolled back when stmt2 failed.
    // This is a permanent regression guard. If D1/Miniflare changes behavior,
    // this test will catch it and we must revisit transfer implementation.
    expect(rows).toHaveLength(0);
  });
});
