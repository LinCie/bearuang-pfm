# Story 1.2: Database Schema & Migration Workflow

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the foundational database tables (users, settings) created via Drizzle with a repeatable migration workflow,
so that all subsequent epics can follow the same pattern for schema changes.

## Acceptance Criteria

1. **AC-1 users table schema:** `src/db/schema/users.ts` defines the `users` table with columns: `id` (TEXT UUID PK), `display_name` (TEXT NOT NULL), `password_hash` (TEXT NOT NULL), `role` (TEXT: `'primary' | 'partner'`, NOT NULL), `is_active` (INTEGER default 1, NOT NULL), `created_at` (TEXT ISO 8601, NOT NULL). All column names are `snake_case`. [Source: epics.md#Story-1.2]

2. **AC-2 settings table schema:** `src/db/schema/settings.ts` defines the `settings` table with columns: `key` (TEXT PK), `value` (TEXT NOT NULL), `updated_at` (TEXT ISO 8601, NOT NULL). [Source: epics.md#Story-1.2]

3. **AC-3 Barrel export:** `src/db/schema/index.ts` re-exports all table definitions from `users.ts` and `settings.ts`. Subsequent epics add their schema files here. [Source: epics.md#Story-1.2, architecture.md#Project-Structure]

4. **AC-4 Migration generated:** `bun run db:generate` (runs `drizzle-kit generate`) produces a numbered SQL migration file in `src/db/migrations/` (e.g., `0001_initial_schema.sql`). The SQL must create both `users` and `settings` tables. [Source: epics.md#Story-1.2, architecture.md#Data-Architecture]

5. **AC-5 Migration applies locally:** `bun run db:migrate:local` (runs `wrangler d1 migrations apply DB --local`) applies the migration successfully against the local Miniflare D1 instance. [Source: epics.md#Story-1.2]

6. **AC-6 Migration workflow documented:** A brief comment block at the top of `src/db/schema/index.ts` (or a `src/db/README.md`) documents the four-step workflow: `db:generate` → review SQL → `db:migrate:local` → `db:migrate:remote`. [Source: epics.md#Story-1.2, architecture.md#Data-Architecture]

7. **AC-7 Test verifies migration:** An integration test in `tests/integration/schema.test.ts` proves the migration applied cleanly by inserting a row into `users` and a row into `settings` and reading them back. The test uses the pool-workers harness (real D1 binding). [Source: epics.md#Story-1.2]

8. **AC-8 Type-check and lint pass:** `bun run check-types` and `bun run lint` both exit 0 after all changes. [Source: architecture.md#Implementation-Patterns]

## Tasks / Subtasks

- [x] **Task 1: Define users schema** (AC: 1)
  - [x] 1.1 Create `apps/api/src/db/schema/users.ts` with the `users` table definition using `sqliteTable` from `drizzle-orm/sqlite-core`
  - [x] 1.2 Use `text('id').primaryKey()` for the UUID PK (TEXT, not integer autoincrement — client-generated UUIDs per architecture)
  - [x] 1.3 Use `text('display_name').notNull()`, `text('password_hash').notNull()`, `text('role').notNull()`, `integer('is_active').notNull().default(1)`, `text('created_at').notNull()`
  - [x] 1.4 Export the table as a named export: `export const users = sqliteTable(...)`

- [x] **Task 2: Define settings schema** (AC: 2)
  - [x] 2.1 Create `apps/api/src/db/schema/settings.ts` with the `settings` table definition
  - [x] 2.2 Use `text('key').primaryKey()`, `text('value').notNull()`, `text('updated_at').notNull()`
  - [x] 2.3 Export the table as a named export: `export const settings = sqliteTable(...)`

- [x] **Task 3: Update barrel export** (AC: 3, 6)
  - [x] 3.1 Replace `export {}` in `src/db/schema/index.ts` with named re-exports from both schema files
  - [x] 3.2 Add a comment block documenting the migration workflow (generate → review → apply local → apply remote)

- [x] **Task 4: Generate migration** (AC: 4)
  - [x] 4.1 From `apps/api/`, run `bun run db:generate`
  - [x] 4.2 Verify a numbered SQL file is created in `src/db/migrations/` (e.g., `0001_initial_schema.sql`)
  - [x] 4.3 Review the generated SQL: confirm `CREATE TABLE users (...)` and `CREATE TABLE settings (...)` are present with correct column types
  - [x] 4.4 Commit the generated migration file (it is source-controlled)

- [x] **Task 5: Apply migration locally** (AC: 5)
  - [x] 5.1 From `apps/api/`, run `bun run db:migrate:local`
  - [x] 5.2 Confirm the command exits 0 and reports the migration as applied

- [x] **Task 6: Write migration test** (AC: 7)
  - [x] 6.1 Create `apps/api/tests/integration/schema.test.ts` (the `tests/integration/` directory already exists from Story 1.1 scaffold — do not recreate it)
  - [x] 6.2 Import `env` from `cloudflare:test` and `drizzle` from `drizzle-orm/d1`
  - [x] 6.3 Import `users` and `settings` from `../../src/db/schema/index`
  - [x] 6.4 Write a test that inserts a row into `users` (with a UUID id, display_name, password_hash, role `'primary'`, is_active `1`, created_at ISO string) and reads it back — assert the returned row matches
  - [x] 6.5 Write a test that inserts a row into `settings` (key, value, updated_at) and reads it back
  - [x] 6.6 Run `bun run test --run` from `apps/api/`; both tests must pass
  - [x] 6.7 **If tests fail with "no such table: users"**: the pool-workers harness is not auto-applying migrations. Add a `beforeAll` to the test file that reads and executes the migration SQL directly:
    ```typescript
    import { readFileSync } from "fs";
    import { resolve } from "path";
    beforeAll(async () => {
      const sql = readFileSync(resolve(__dirname, "../../src/db/migrations/0000_initial_schema.sql"), "utf-8");
      await env.DB.exec(sql);
    });
    ```
    Adjust the filename to match the actual generated migration file name.

- [x] **Task 7: Update factories and seed helper** (AC: 7)
  - [x] 7.1 **Replace** the entire contents of `tests/fixtures/factories.ts` with properly typed factories. The current stub has a wrong shape (`email` field, no `display_name`, no `password_hash`) — it must be fully replaced, not appended to. See the "Factory Updates" section in Dev Notes for the correct implementation.
  - [x] 7.2 Add a `settingsFactory()` that returns a valid `settings` row shape (see Dev Notes)
  - [x] 7.3 Update `seedUser()` in `tests/setup.ts` to compose with `userFactory()` and actually insert the row into D1. Replace the current stub return with a real DB insert:
    ```typescript
    import { drizzle } from "drizzle-orm/d1";
    import * as schema from "../src/db/schema/index";
    import { userFactory } from "./fixtures/factories";

    export const seedUser = async (db: ReturnType<typeof drizzle>) => {
      const user = userFactory();
      await db.insert(schema.users).values(user);
      return user;
    };
    ```
    Update any existing callers of `seedUser()` to pass the `db` instance.

- [x] **Task 8: Verification gate** (AC: 8)
  - [x] 8.1 `bun run check-types` from repo root — must exit 0
  - [x] 8.2 `bun run lint` from repo root — must exit 0
  - [x] 8.3 `bun run test --run` from `apps/api/` — all tests pass (including the KV smoke test from Story 1.1)
  - [x] 8.4 Update Dev Agent Record with file list and any deviations

## Dev Notes

### Critical Architecture Constraints

**UUID primary keys (not autoincrement):**
The architecture mandates client-generated UUID v4 TEXT primary keys on all tables. Do NOT use `integer('id').primaryKey({ autoIncrement: true })`. Use `text('id').primaryKey()`. The `users` table is no exception — Story 1.4 will generate UUIDs via `crypto.randomUUID()` when creating the first user.

**Amount storage (not relevant here, but establish the pattern):**
All monetary amounts in future tables must be `text()` (string decimal), never `real()` or `integer()`. This story doesn't have amounts, but the pattern starts here.

**ISO 8601 dates as TEXT:**
All date/time columns are `text()` storing ISO 8601 strings (e.g., `"2026-05-28T07:00:00Z"`). SQLite has no native date type. Never use `integer()` for timestamps.

**Boolean as INTEGER:**
SQLite has no boolean type. `is_active` is `integer().notNull().default(1)` — `1` = true, `0` = false. This is the pattern for all boolean columns in the project.

**role column:**
The `role` column is `text('role').notNull()` with values `'primary'` or `'partner'`. Do NOT use a Drizzle enum — use a plain `text()` column and enforce the constraint at the application layer (Zod schema in Story 1.4). This keeps the SQLite schema simple and avoids drizzle-kit enum migration complexity.

### Drizzle ORM API (v0.36.4 with drizzle-kit v0.31.10)

**Schema definition pattern:**
```typescript
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  display_name: text("display_name").notNull(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull(), // 'primary' | 'partner' enforced in app layer
  is_active: integer("is_active").notNull().default(1),
  created_at: text("created_at").notNull(),
});
```

**D1 database connection in tests:**
```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema/index";

const db = drizzle(env.DB, { schema });
```

**Insert and select:**
```typescript
await db.insert(schema.users).values({ id: "...", display_name: "...", ... });
const rows = await db.select().from(schema.users).where(eq(schema.users.id, "..."));
```

**Migration generation:**
`bun run db:generate` calls `drizzle-kit generate`. The `drizzle.config.ts` already points to `./src/db/schema/index.ts` and outputs to `./src/db/migrations`. No driver config is needed for local generate-only flow (confirmed in Story 1.1 dev notes).

**Migration naming:**
drizzle-kit generates files like `0000_<hash>.sql` or `0001_<name>.sql`. The exact name is auto-generated — do not rename it. The file must be committed to source control.

### Test Pattern (pool-workers)

The test harness from Story 1.1 uses `@cloudflare/vitest-pool-workers` v0.16.10. Tests run inside the actual Workers runtime with real D1 bindings. The migration must be applied before tests run — the pool-workers harness applies migrations automatically if `wrangler.toml` has `migrations_dir` set (which it does: `src/db/migrations`).

**If tests fail with "no such table: users"**: the harness is not auto-applying migrations in this version. Add a `beforeAll` to the test file that reads and executes the migration SQL directly (see Task 6.7 for the exact snippet). The preferred approach is to rely on harness auto-apply first — only add the `beforeAll` if the first test run fails.

**Test file structure:**
```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema/index";

describe("schema migration", () => {
  const db = drizzle(env.DB, { schema });

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
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.display_name).toBe("Test User");
    expect(rows[0]?.role).toBe("primary");
  });

  it("inserts and reads a settings row", async () => {
    await db.insert(schema.settings).values({
      key: "test_key",
      value: "test_value",
      updated_at: new Date().toISOString(),
    });
    const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, "test_key"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("test_value");
  });
});
```

### Barrel Export Pattern

The `src/db/schema/index.ts` barrel is the single import point for all schema tables. Every subsequent epic adds its schema file here. Keep it as named re-exports (not `export * from`), so tree-shaking works and imports are explicit:

```typescript
// src/db/schema/index.ts
// Migration workflow:
//   1. bun run db:generate   — generates SQL in src/db/migrations/
//   2. Review the generated SQL file
//   3. bun run db:migrate:local  — applies to local Miniflare D1
//   4. bun run db:migrate:remote — applies to production D1 (after deploy)

export { users } from "./users";
export { settings } from "./settings";
// Epic 2+: export { accounts } from "./accounts"; etc.
```

### Factory Updates

The current `tests/fixtures/factories.ts` has a stub with the wrong shape (`email` field, no `display_name`, no `password_hash`). **Replace the entire file** with properly typed factories that match the actual DB schema:

```typescript
import type { InferInsertModel } from "drizzle-orm";
import * as schema from "../src/db/schema/index";

type UserInsert = InferInsertModel<typeof schema.users>;
type SettingsInsert = InferInsertModel<typeof schema.settings>;

export const userFactory = (overrides?: Partial<UserInsert>): UserInsert => ({
  id: crypto.randomUUID(),
  display_name: "Test User",
  password_hash: "placeholder_hash_not_real",
  role: "primary",
  is_active: 1,
  created_at: new Date().toISOString(),
  ...overrides,
});

export const settingsFactory = (overrides?: Partial<SettingsInsert>): SettingsInsert => ({
  key: `test_key_${Date.now()}`,
  value: "test_value",
  updated_at: new Date().toISOString(),
  ...overrides,
});
```

Notes:
- `InferInsertModel` is the Drizzle utility type for the insert shape of a table — keeps factories type-safe without duplicating column definitions.
- Use `crypto.randomUUID()` directly (global in Workers runtime with `nodejs_compat`) — no import needed.
- `role` is typed as `string` by Drizzle (plain `text()` column) — the `"primary"` literal is valid without `as const`.

### Deferred Work from Story 1.1

From `deferred-work.md`:
- `seedUser()` in `tests/setup.ts` duplicates stub instead of composing with `userFactory`. **Resolved in Task 7.3**: update `seedUser()` to call `userFactory()` and insert into D1.
- No `scheduled()` handler — out of scope, deferred to backup story.
- No global error handler — out of scope, Story 1.3.

### Project Structure Notes

Files to create (all under `apps/api/`):
- `src/db/schema/users.ts` — NEW
- `src/db/schema/settings.ts` — NEW
- `src/db/migrations/0001_<generated_name>.sql` — NEW (generated, committed)
- `tests/integration/schema.test.ts` — NEW

Files to update:
- `src/db/schema/index.ts` — replace `export {}` with named re-exports + workflow comment
- `tests/fixtures/factories.ts` — **replace** stub with real `userFactory` and `settingsFactory` using `InferInsertModel` types (current stub has wrong shape: `email` field, no DB columns)
- `tests/setup.ts` — update `seedUser()` to accept a `db` parameter, compose with `userFactory()`, and insert into D1

No changes to `src/index.ts`, `wrangler.toml`, `package.json`, or `drizzle.config.ts` — those are correct from Story 1.1.

**Architecture variance to note:** The architecture document lists `db/schema.ts` (single file) in one section but `db/schema/` (per-domain) in the detailed structure. Story 1.1 confirmed the per-domain approach (`db/schema/` directory). This story follows that confirmed pattern.

### Anti-Patterns to Avoid

- ❌ `integer('id').primaryKey({ autoIncrement: true })` — use `text('id').primaryKey()` (client UUID)
- ❌ `real('amount')` — not applicable here, but never use real for money in future tables
- ❌ `text('created_at').default(sql`CURRENT_TIMESTAMP`)` — store ISO strings explicitly from app layer, not SQL defaults (keeps timezone handling consistent)
- ❌ `export * from "./users"` — use named re-exports for explicit imports
- ❌ Renaming the generated migration file — drizzle-kit tracks migrations by filename; renaming breaks the migration journal

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.2-Database-Schema-Migration-Workflow]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data-Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries#Complete-Project-Directory-Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation-Patterns-&-Consistency-Rules#Naming-Patterns]
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffold-infrastructure-configuration.md#Dev-Agent-Record]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- [Source: AGENTS.md (bun package manager rules)]

## Latest Tech Information

Verified against installed versions (2026-05-28):

- **drizzle-orm v0.36.4**: `sqliteTable` from `drizzle-orm/sqlite-core`. D1 driver: `drizzle` from `drizzle-orm/d1`. `$inferInsert` and `$inferSelect` utility types available on table objects.
- **drizzle-kit v0.31.10**: `bun run db:generate` uses `drizzle-kit generate` (not `generate:sqlite` — that was an older API). The `drizzle.config.ts` `dialect: "sqlite"` with no `driver` is correct for local generate-only flow.
- **zod v4.4.3**: Installed (bumped from ^3.x in Story 1.1 to satisfy `@hono/zod-openapi@1.4.0` peer dep). This story doesn't use Zod directly, but Story 1.4 will use Zod 4 API for schema validation — note that Zod 4 has breaking changes from Zod 3 (e.g., `.email()` is now `.email()` but error message format changed). Use Zod 4 API going forward.
- **@cloudflare/vitest-pool-workers v0.16.10**: Pool-workers harness applies D1 migrations automatically when `migrations_dir` is set in `wrangler.toml`. Verify this in the test run — if tables are missing, apply migrations manually in `beforeAll`.

## Review Findings

- [x] [Review][Decision] Role constraint enforcement level — app-layer only (Zod in Story 1.4); no DB-level CHECK needed. Resolved: option 1.
- [x] [Review][Patch] `beforeAll` migration errors swallowed silently — wrapped `env.DB.prepare().run()` in try/catch; re-throws with descriptive message unless "already exists" [tests/integration/schema.test.ts:beforeAll]
- [x] [Review][Patch] `seedUser` has no migration guard — extracted `applyMigrations()` helper in `tests/setup.ts` for safe reuse by future test files [tests/setup.ts]
- [x] [Review][Patch] `createTestEnv` is a misleading no-op — renamed to `getTestEnv` with a clarifying JSDoc comment [tests/setup.ts]
- [x] [Review][Patch] `seedUser` returns locally-constructed object, not confirmed persisted row — added JSDoc noting the pattern; insert errors propagate correctly via Drizzle [tests/setup.ts]
- [x] [Review][Defer] No DB-level constraints on `is_active`, `display_name`, date column formats — pre-existing design decision; enforced at app layer (Zod, Story 1.4) [src/db/schema/users.ts]
- [x] [Review][Defer] `settings` table has no `created_at` audit column — spec-level design choice, not an implementation deviation [src/db/schema/settings.ts]
- [x] [Review][Defer] No CI enforcement of schema/migration drift — `drizzle-kit check` step in CI would catch drift; out of scope for this story [src/db/migrations/]

## Dev Agent Record

### Agent Model Used

GPT-5.3 Codex (CLI agent)

### Debug Log References

- `cd apps/api && bun run db:generate`
- `cd apps/api && bun run db:migrate:local`
- `cd apps/api && bun run test --run`
- `cd /home/hebot/bearuang && bun run check-types`
- `cd /home/hebot/bearuang && bun run lint`

### Completion Notes List

- Implemented Drizzle schema tables for `users` and `settings` with required column shapes and constraints.
- Updated schema barrel exports and documented the migration workflow (`generate` → review SQL → local migrate → remote migrate).
- Generated and committed migration `src/db/migrations/0000_fast_johnny_storm.sql`; verified it creates both tables.
- Added integration migration test that inserts/selects `users` and `settings` rows against D1 pool-workers runtime.
- Pool-workers did not auto-apply migrations in test runtime (`no such table`), so a `beforeAll` migration apply fallback was added by importing SQL as raw text and executing statements via `env.DB.prepare(...).run()`.
- Replaced stub factories with typed Drizzle insert factories and updated `seedUser()` to insert real user rows via DB.
- Verification gates passed: `bun run test --run` (apps/api), `bun run check-types` (repo root), `bun run lint` (repo root).

### File List

- `apps/api/src/db/schema/users.ts` (new)
- `apps/api/src/db/schema/settings.ts` (new)
- `apps/api/src/db/schema/index.ts` (updated)
- `apps/api/src/db/migrations/0000_fast_johnny_storm.sql` (new)
- `apps/api/src/db/migrations/meta/0000_snapshot.json` (new)
- `apps/api/src/db/migrations/meta/_journal.json` (new)
- `apps/api/tests/integration/schema.test.ts` (new)
- `apps/api/tests/fixtures/factories.ts` (updated)
- `apps/api/tests/setup.ts` (updated)
- `apps/api/tests/sql-raw.d.ts` (new)

### Change Log

- 2026-05-28: Implemented Story 1.2 end-to-end; all tasks complete, validation gates passing, status moved to `review`.
