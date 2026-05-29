import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import type { InferInsertModel } from "drizzle-orm";
import * as schema from "../src/db/schema/index";
import { userFactory } from "./fixtures/factories";

type UserInsert = InferInsertModel<typeof schema.users>;

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

  const migrationFiles = Object.entries(
    import.meta.glob("../src/db/migrations/*.sql", {
      eager: true,
      query: "?raw",
      import: "default",
    }),
  ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  for (const [, migrationSql] of migrationFiles) {
    // Split on Drizzle's statement-breakpoint marker rather than bare `;`
    // so that future migrations with semicolons inside string literals are safe.
    const statements: string[] = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

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
  }
};

/**
 * Seeds a user row into the database using the userFactory defaults.
 * Accepts optional field overrides. Returns the inserted user object.
 */
export const seedUser = async (
  db: ReturnType<typeof drizzle>,
  overrides?: Partial<UserInsert>,
) => {
  const user = userFactory(overrides);
  await db.insert(schema.users).values(user);
  return user;
};
