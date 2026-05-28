import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema/index";
import migrationSql from "../src/db/migrations/0000_fast_johnny_storm.sql?raw";
import { userFactory } from "./fixtures/factories";

/** Returns the shared Cloudflare test environment. */
export const getTestEnv = (): typeof env => env;

const isD1Database = (value: unknown): value is D1Database =>
  !!value && typeof value === "object" && "prepare" in value && typeof value.prepare === "function";

/**
 * Applies all committed migrations to the given D1 binding.
 * Safe to call multiple times — "table already exists" errors are ignored.
 */
export const applyMigrations = async (db: unknown) => {
  if (!isD1Database(db)) {
    throw new Error("Invalid D1 database binding");
  }

  const rawStatements: string[] = migrationSql
    .replaceAll("--> statement-breakpoint", "")
    .split(";");
  const statements: string[] = [];

  for (const rawStatement of rawStatements) {
    const statement = rawStatement.trim();
    if (statement.length > 0) {
      statements.push(statement);
    }
  }

  for (const statement of statements) {
    try {
      await db.prepare(statement).run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("already exists")) {
        throw new Error(`Migration failed on statement:\n${statement}\n\nCause: ${message}`);
      }
    }
  }
};

/**
 * Seeds a user row into the database using the userFactory defaults.
 * Returns the inserted user object.
 */
export const seedUser = async (db: ReturnType<typeof drizzle>) => {
  const user = userFactory();
  await db.insert(schema.users).values(user);
  return user;
};
