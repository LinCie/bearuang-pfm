import { env } from "cloudflare:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema/index";
import { userFactory } from "./fixtures/factories";

/** Returns the shared Cloudflare test environment. */
export const getTestEnv = (): typeof env => env;

/**
 * Applies all committed migrations to the given D1 binding.
 * Safe to call multiple times — "table already exists" errors are ignored.
 */
export const applyMigrations = async (db: D1Database) => {
  const migrationSql: string = readFileSync(
    resolve(__dirname, "../src/db/migrations/0000_fast_johnny_storm.sql"),
    "utf-8",
  );
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
