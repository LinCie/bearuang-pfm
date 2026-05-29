import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema/index";
import { applyMigrations } from "../setup";

describe("schema migration", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it("inserts and reads a user row", async () => {
    const id = crypto.randomUUID();

    await db.insert(schema.users).values({
      id,
      display_name: "Test User",
      password_hash: "placeholder_hash",
      role: "primary",
      is_active: 1,
      created_at: new Date().toISOString(),
    });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      display_name: "Test User",
      password_hash: "placeholder_hash",
      role: "primary",
      is_active: 1,
    });
    expect(rows[0]?.created_at).toBeTypeOf("string");
  });

  it("inserts and reads a settings row", async () => {
    const updatedAt = new Date().toISOString();
    const key = `test_key_${crypto.randomUUID()}`;

    await db.insert(schema.settings).values({
      key,
      value: "test_value",
      updated_at: updatedAt,
    });

    const rows = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      key,
      value: "test_value",
      updated_at: updatedAt,
    });
  });
});
