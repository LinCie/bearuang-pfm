# Story 3.1: Expense & Income Transactions

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the app owner,
I want to record expense and income transactions with category, payee, and notes,
so that I have a complete record of where my money goes and comes from.

## Acceptance Criteria

1. **AC-1 `transactions` table created via migration.** A new Drizzle table `transactions` (in `src/db/schema/transactions.ts`, re-exported from `src/db/schema/index.ts`) plus a generated migration (`src/db/migrations/0003_*.sql`) create a `transactions` table with columns: `id` (TEXT PK, client- or server-generated UUID), `type` (TEXT — `'expense' | 'income' | 'transfer'`), `amount` (TEXT string decimal), `account_id` (TEXT FK → accounts.id), `destination_account_id` (TEXT nullable, transfers only), `category_id` (TEXT nullable FK → categories.id), `payee` (TEXT nullable), `notes` (TEXT nullable), `date` (TEXT ISO 8601 date-only), `created_by` (TEXT FK → users.id), `updated_by` (TEXT FK → users.id), `is_deleted` (INTEGER 0/1 default 0), `deleted_at` (TEXT nullable), `created_at` (TEXT ISO 8601), `updated_at` (TEXT ISO 8601). The migration is generated with `bun run db:generate` (never hand-written). [Source: epics.md#Story-3.1, architecture.md#Data-Architecture, architecture.md#Database-Naming-Conventions, prd.md#Section-5-transactions]

2. **AC-2 Create expense.** Given a valid session and an existing account and category, `POST /api/v1/transactions` with `{ "id": "client-uuid-123", "type": "expense", "amount": "50000.00", "account_id": "...", "category_id": "...", "date": "2026-05-28", "payee": "Warung Makan", "notes": "Lunch" }` creates an expense transaction using the **client-provided UUID** as primary key; `created_by` and `updated_by` are set to the authenticated user's ID; the full transaction object is returned with status **201**. [Source: epics.md#Story-3.1]

3. **AC-3 Create income + server-generated UUID.** `POST /api/v1/transactions` with `{ "type": "income", "amount": "15000000.00", "account_id": "...", "category_id": "...", "date": "2026-05-01" }` creates an income transaction with status **201**; when no `id` is provided, the server generates a UUID v4 (`crypto.randomUUID()`). [Source: epics.md#Story-3.1]

4. **AC-4 Idempotent creation by client UUID.** Given a transaction with a specific client-generated UUID already exists, a subsequent `POST /api/v1/transactions` with the **same `id`** returns the **existing transaction unchanged** (the request body is ignored — the stored record is returned as-is, NOT updated) with status **200** (not 201). This implements offline-retry-safety (FR-TXN-10 / NFR-REL-01). [Source: epics.md#Story-3.1, prd.md#FR-TXN-10, prd.md#NFR-REL-01]

5. **AC-5 Category usage_count increment.** When a transaction is successfully created (a genuinely new row, NOT an idempotent replay) with a valid `category_id`, that category's `usage_count` is incremented by 1. An idempotent replay (AC-4) does NOT increment again. A transaction created without a `category_id` (allowed for transfers in later stories; for this story expense/income require a category — see AC-8) does not touch any category. [Source: epics.md#Story-3.1, prd.md#Section-5-categories (usage_count)]

6. **AC-6 Get single transaction with names.** Given a valid session and an existing transaction, `GET /api/v1/transactions/:id` returns the full transaction details **including `account_name` (the account's name) and `category_name` (the category's name, or `null` when `category_id` is null)** with status **200**. [Source: epics.md#Story-3.1]

7. **AC-7 Validation error on missing required fields.** Given a request missing required fields (`amount`, `account_id`, or `type`), `POST /api/v1/transactions` returns a validation error `{ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: [...] } }` with status **400** (produced by the router `defaultHook`, same as accounts/categories). [Source: epics.md#Story-3.1, architecture.md#Validation-Pattern, src/routes/accounts.ts (defaultHook)]

8. **AC-8 Domain 404 for missing account/category.** Given a request referencing a non-existent (or soft-deleted, `is_active = 0`) `account_id`, or a non-existent `category_id`, `POST /api/v1/transactions` returns `{ error: { code: "ACCOUNT_NOT_FOUND", message: "..." } }` or `{ error: { code: "CATEGORY_NOT_FOUND", message: "..." } }` respectively, with status **404**. These are **domain-specific error codes**, not the generic `NOT_FOUND` — see Dev Notes "Domain error codes" for the required error-handler change. For this story, expense and income transactions require a valid `category_id`. [Source: epics.md#Story-3.1, architecture.md#Error-Codes]

9. **AC-9 Date defaults to today.** When no `date` is provided, the transaction's `date` defaults to today in ISO 8601 **date-only** format (`YYYY-MM-DD`, e.g. `"2026-05-28"`), derived from `new Date().toISOString().slice(0, 10)`. When a `date` IS provided it must be a valid `YYYY-MM-DD` string (Zod `z.iso.date()`); an invalid date is a 400 validation error. [Source: epics.md#Story-3.1, architecture.md#Date-Time-Format]

10. **AC-10 Transfer type rejected this story (scope guard).** `type: "transfer"` is a valid enum value in the schema (the column and union must exist per AC-1), but transfer **creation logic** is Story 3.2. For this story, `POST /api/v1/transactions` with `type: "transfer"` returns `{ error: { code: "NOT_IMPLEMENTED", message: "Transfers are not yet supported" } }` with status **501**. Do NOT implement debit/credit balance movement, `destination_account_id` handling, or `db.batch()` here — that is Story 3.2. [Source: epics.md#Story-3.2 (transfer scope), architecture.md#Implementation-Sequence (transfers are step 5, after core CRUD)]

11. **AC-11 Balance derivation wired to real transaction sums.** `GET /api/v1/accounts` now reflects transactions: an account's `current_balance` = `initial_balance` + (sum of `+amount` for `income` and `−amount` for `expense` non-deleted transactions on that account). The forward-compatible `getTransactionDeltas` seam in `account.service.ts` (left empty by Story 2.3) is filled in: it queries non-deleted transactions grouped per `account_id`, computes each account's signed delta with `src/lib/decimal.ts` (`add`/`subtract` — never SQL `SUM`, never float), and returns the `Map<account_id, deltaString>`. Transfers contribute nothing this story (none can be created yet). [Source: epics.md#Story-3.1, 2-3-...md (getTransactionDeltas seam), architecture.md#Data-Architecture (TypeScript aggregation, no SQL SUM)]

12. **AC-12 Soft-deleted transactions excluded from balance.** Balance derivation (AC-11) counts only rows where `is_deleted = 0`. Rows with `is_deleted = 1` are ignored (full soft-delete/trash endpoints are Story 3.3; this story only ensures the balance query already filters `is_deleted = 0`). [Source: epics.md#Story-3.1, epics.md#Story-3.3]

13. **AC-13 Type-check, lint, and tests pass.** `bun run check-types`, `bun run lint`, and `bun run test --run` (from `apps/api/`) all exit 0. New tests: `tests/integration/transactions.test.ts` (covers AC-2 through AC-12) and balance-derivation coverage added to `tests/integration/accounts.test.ts` (an account with seeded income + expense transactions shows the correct `current_balance` and `summary`). No regressions in any existing suite. The pre-existing environmental argon2/Miniflare timeout in `auth.test.ts`, if it occurs, is unrelated to this story. [Source: architecture.md#Test-Organization, 2-3-...md#Verification-gate]

## Tasks / Subtasks

- [x] **Task 1: Create the `transactions` Drizzle table + migration** (AC: 1)
  - [x] 1.1 Create `src/db/schema/transactions.ts` mirroring the style of `src/db/schema/accounts.ts` (import `integer, sqliteTable, text` from `drizzle-orm/sqlite-core`; import `users`, `accounts`, `categories` for FK references). Columns exactly per AC-1. Use `.references(() => users.id)` for `created_by`/`updated_by`, `.references(() => accounts.id)` for `account_id`, and nullable FK refs for `destination_account_id` (→ accounts.id) and `category_id` (→ categories.id). `is_deleted`: `integer("is_deleted").notNull().default(0)`. `deleted_at`/`destination_account_id`/`category_id`/`payee`/`notes`: nullable `text(...)` (no `.notNull()`). Add indexes via the table-extras callback (like `categories.ts`): `idx_transactions_account_date` on `(account_id, date)` and `idx_transactions_is_deleted` on `(is_deleted)` — use `index(...)` from `drizzle-orm/sqlite-core` (NOT `uniqueIndex` — transactions have no unique business key beyond the PK). [Source: architecture.md#Database-Naming-Conventions (idx_transactions_account_date, idx_transactions_is_deleted_date), src/db/schema/accounts.ts, src/db/schema/categories.ts]
  - [x] 1.2 Add `export { transactions } from "./transactions";` to `src/db/schema/index.ts` (append after the `accounts` export — keep the existing migration-workflow comment block).
  - [x] 1.3 Run `bun run db:generate` from `apps/api/`. This produces `src/db/migrations/0003_*.sql` and updates `src/db/migrations/meta/`. **Review the generated SQL** before committing — confirm the table, FKs, and indexes match AC-1 and that it is migration `0003` (next after `0002`). Do NOT hand-edit the SQL; if wrong, fix the schema file and regenerate. Do NOT run `db:migrate:remote` (no remote credentials in this environment).
  - [x] 1.4 Verify the migration applies in tests: `tests/setup.ts#applyMigrations` auto-discovers `*.sql` via `import.meta.glob` and runs them in filename order, so `0003` is picked up automatically — no change to `setup.ts` needed.

- [x] **Task 2: Transaction Zod schemas** (AC: 1, 2, 3, 6, 7, 9, 10)
  - [x] 2.1 Create `src/schemas/transaction.schema.ts` with `import { z } from "zod";` (match the existing schema files — do NOT import `z` from `@hono/zod-openapi`). Reuse the same `decimalStringSchema` shape as `account.schema.ts` (trim, max 30, regex `/^-?\d+(\.\d+)?$/`). Define:
    - `transactionTypeSchema = z.enum(["expense", "income", "transfer"])`.
    - `transactionSchema` (full entity, all AC-1 columns; `is_deleted` exposed as `z.boolean()`, `deleted_at`/`destination_account_id`/`category_id`/`payee`/`notes` as `z.string().nullable()`). This is the create/replay response shape.
    - `transactionDetailSchema = transactionSchema.extend({ account_name: z.string(), category_name: z.string().nullable() })` — the `GET /:id` response (AC-6).
    - `createTransactionRequestSchema`: `id` optional UUID-ish string (`z.string().trim().min(1).optional()` — accept client UUID; server generates if absent), `type` required, `amount` required `decimalStringSchema`, `account_id` required non-empty string, `category_id` `z.string().trim().min(1).optional()`, `destination_account_id` optional string, `payee`/`notes` `z.string().trim().max(...).optional()`, `date` `z.iso.date().optional()` (Zod v4 ISO date validator — verified present; defaults applied in the service, NOT via `.default()`, so "today" is computed at request time). Keep required fields un-`.optional()` so AC-7 (missing `amount`/`account_id`/`type`) yields a 400 from the `defaultHook`.
    - `transactionIdParamsSchema = z.object({ id: z.string().min(1) })`.
    - Export types: `TransactionType`, `Transaction`, `TransactionDetail`.
  - [x] 2.2 Do NOT add a list/pagination schema here — listing/search is Story 3.4. Only the create + get-by-id shapes belong to this story.

- [x] **Task 3: Transaction service** (AC: 2, 3, 4, 5, 6, 8, 9, 10)
  - [x] 3.1 Create `src/services/transaction.service.ts` following `account.service.ts`/`category.service.ts` conventions: pure functions taking `(db, ...)`; throw `HTTPException` for expected errors; a private `toTransaction(row)` mapper converting `is_deleted: number → boolean`. Import `{ eq, and, sql }` from `drizzle-orm`, `DrizzleD1Database` type, `HTTPException`, the schema tables (`transactions`, `accounts`, `categories`), and the domain error helper (see Task 5 / Dev Notes).
  - [x] 3.2 `createTransaction(db, input, userId)`:
    - **Transfer guard (AC-10):** if `input.type === "transfer"`, throw the domain error `NOT_IMPLEMENTED` at status **501** (`new ApiError(501, "NOT_IMPLEMENTED", "Transfers are not yet supported")` — see Dev Notes). Do this BEFORE any DB work.
    - **Idempotency (AC-4):** if `input.id` is provided, `SELECT` the existing row by `id` first. If found, return `toTransaction(existing)` and signal "replayed" so the route returns **200** (see Dev Notes "Returning 200 vs 201"). Do NOT update it, do NOT re-increment usage_count.
    - **Validate references (AC-8):** load the account by `account_id` filtered to `is_active = 1`; if missing → `ApiError(404, "ACCOUNT_NOT_FOUND", ...)`. Load the category by `category_id` (required for expense/income this story); if missing → `ApiError(404, "CATEGORY_NOT_FOUND", ...)`.
    - **Insert (AC-2, AC-3, AC-9):** `id = input.id ?? crypto.randomUUID()`; `date = input.date ?? new Date().toISOString().slice(0, 10)`; `now = new Date().toISOString()`; set `type`, `amount`, `account_id`, `destination_account_id: null`, `category_id`, `payee ?? null`, `notes ?? null`, `is_deleted: 0`, `deleted_at: null`, `created_by`/`updated_by = userId`, `created_at`/`updated_at = now`. Use a guarded insert that tolerates a race on the client UUID PK: wrap the insert in try/catch and on `UNIQUE constraint failed` (PK collision from a concurrent identical request) fall back to returning the existing row as a replay (200) — mirrors `category.service.ts`'s UNIQUE-catch pattern.
    - **Increment usage_count (AC-5):** only for a genuinely new row with a `category_id`: `await db.update(categories).set({ usage_count: sql\`${categories.usage_count} + 1\` }).where(eq(categories.id, category_id))`. (Atomic SQL increment — do not read-modify-write.)
    - **Select-back:** re-`SELECT` the inserted row by `id` and return via `toTransaction` (the `.returning()`-is-unreliable-on-D1 learning from Stories 2.1–2.2 applies — always select back).
  - [x] 3.3 `getTransaction(db, id)` (AC-6): `SELECT` the transaction by `id`; if missing → `ApiError(404, "NOT_FOUND", "Transaction not found")` (generic NOT_FOUND is correct here — the epic only specifies domain codes for the create-reference case). Join/lookup the account name and category name (two simple selects, or a single left-join select listing only needed columns — `SELECT *` is an anti-pattern). Return `TransactionDetail` with `account_name` and `category_name` (null when `category_id` is null). Include soft-deleted transactions here (a get-by-id has no `is_deleted` filter — trash/restore is Story 3.3).
  - [x] 3.4 Export a `getTransactionDeltas`-style helper for the account service to consume, OR implement the delta query inside `account.service.ts` directly (Task 4 decides). Prefer keeping the signed-sum logic in `transaction.service.ts` as `export const getAccountDeltas = async (db): Promise<Map<string, string>> => {...}` so transaction-domain logic lives in the transaction service, and `account.service.ts` imports it. **Do NOT** import `account.service.ts` from `transaction.service.ts` or vice-versa in a cycle — `account.service.ts` importing one helper from `transaction.service.ts` is fine (services may depend on services; only `lib/` is import-restricted). [Source: architecture.md#Service-Boundary, eslint.config.mjs (only lib/ is restricted)]

- [x] **Task 4: Wire real balance derivation into the account service** (AC: 11, 12)
  - [x] 4.1 Replace the empty body of `getTransactionDeltas` in `src/services/account.service.ts` (currently returns `new Map()` after the `sqlite_master` probe) with real per-account signed summation. Keep tolerating the missing-`transactions`-table case (the probe already does this; or wrap in the run-and-catch on `no such table` like `category.service.ts`) so any test DB without the table still returns an empty map instead of throwing. Recommended: import `getAccountDeltas` from `transaction.service.ts` (Task 3.4) and delegate, keeping the probe/guard for the table-missing case.
  - [x] 4.2 The delta computation: select `account_id, type, amount` from `transactions` where `is_deleted = 0` (AC-12). Fold per account: start each account at `"0"`; for `income` rows `delta = add(delta, amount)`; for `expense` rows `delta = subtract(delta, amount)`; ignore `transfer` rows this story. Use `src/lib/decimal.ts` (`add`/`subtract`) — never SQL `SUM`, never `parseFloat`/`Number`/`+` on amounts (architecture anti-pattern; see 2-3 Dev Notes "Why NOT big.js"). Return `Map<account_id, deltaString>`.
  - [x] 4.3 `listAccounts` already computes `current_balance = add(initial_balance, deltas.get(id) ?? "0")` and the summary from those balances — no further change needed there once the map is populated. Verify `check-types` stays green (the map type is unchanged: `Map<string, string>`).
  - [x] 4.4 Do NOT add a stored running-balance column. Do NOT change `createAccount`/`getAccount`/`updateAccount`/`deleteAccount`/`classifyAccountType`. Balances stay derived at request time (architecture: TypeScript aggregation).

- [x] **Task 5: Domain error codes (`ACCOUNT_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `NOT_IMPLEMENTED`)** (AC: 8, 10)
  - [x] 5.1 The current `error-handler.ts` maps every 404 to the generic code `NOT_FOUND` and every 501 to `INTERNAL_ERROR`-or-`CLIENT_ERROR`, so a plain `new HTTPException(404, { message })` CANNOT produce `ACCOUNT_NOT_FOUND`. Introduce a small domain-error carrier so the handler can emit a specific code. Implement ONE of these (prefer A):
    - **(A — preferred) `src/lib/api-error.ts`**: a tiny `ApiError extends HTTPException` that stores a `code` string. `error-handler.ts` checks `if (err instanceof ApiError) → use err.code` else falls back to the existing `deriveCode(status)` switch. This keeps all existing behavior (generic codes for plain `HTTPException`) and lets services throw precise codes. Constructor: `new ApiError(status, code, message)`. Place it in `lib/` (it must not import services/routes — it only imports `HTTPException` from `hono/http-exception`, which is allowed). Import the status type with `import type { ContentfulStatusCode } from "hono/utils/http-status"` if a precise status type is wanted, or accept `number` and cast — verify `check-types` passes either way.
    - **(B) Pre-built `res` on `HTTPException`**: services build the JSON `Response` themselves and pass it as `new HTTPException(status, { res })`. Hono returns `err.getResponse()` verbatim when `res` is set — BUT the current `errorHandler` ignores `res` and rebuilds the body, so choosing (B) also requires teaching `errorHandler` to honor `err.res`. (A) is cleaner; use it.
  - [x] 5.2 Update `src/middleware/error-handler.ts`: at the top of the `err instanceof HTTPException` branch, if `err instanceof ApiError`, set `code = err.code`; otherwise `code = deriveCode(err.status)`. Everything else (message passthrough, `errorResponseSchema.safeParse`, status) stays identical. This is backward-compatible: existing 404s that throw plain `HTTPException` (accounts/categories "not found") keep emitting `NOT_FOUND`, so `accounts.test.ts`/`categories.test.ts` 404 assertions still pass. Confirm by re-running those suites.
  - [x] 5.3 In `transaction.service.ts`, throw `ApiError` for the three specific cases: `ACCOUNT_NOT_FOUND` (404), `CATEGORY_NOT_FOUND` (404), `NOT_IMPLEMENTED` (501). Keep using plain `HTTPException(404, ...)` (→ `NOT_FOUND`) for the generic "transaction not found" in `getTransaction`.

- [x] **Task 6: Transactions route module** (AC: 2, 3, 4, 6, 7, 8, 9, 10)
  - [x] 6.1 Create `src/routes/transactions.ts` modeled on `routes/accounts.ts`: an `OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>` named `transactionsRouter` with the SAME `defaultHook` (returns `VALIDATION_ERROR`/400 on Zod failure — copy verbatim from accounts.ts). Register `authMiddleware` on the two paths: `transactionsRouter.use("/api/v1/transactions", authMiddleware)` and `transactionsRouter.use("/api/v1/transactions/:id", authMiddleware)`.
  - [x] 6.2 `createTransactionRoute` (POST `/api/v1/transactions`): request body `createTransactionRequestSchema`. Responses: `201` (transactionSchema), `200` (transactionSchema — idempotent replay, AC-4), `400`, `401`, `404` (errorResponseSchema), `501` (errorResponseSchema). Handler: `const result = await createTransaction(db, input, userId); return c.json(result.transaction, result.replayed ? 200 : 201);` (see Dev Notes for the `{ transaction, replayed }` return shape; the route picks the status). **OpenAPIHono requires the returned status be one of the declared response codes — declare both 200 and 201.**
  - [x] 6.3 `getTransactionRoute` (GET `/api/v1/transactions/{id}`): params `transactionIdParamsSchema`. Responses: `200` (transactionDetailSchema), `401`, `404` (errorResponseSchema). Handler calls `getTransaction(db, id)` and returns `c.json(detail, 200)`.
  - [x] 6.4 Do NOT add PUT/DELETE/trash/restore/list routes — those are Stories 3.3 and 3.4. Only POST (create) and GET-by-id this story.
  - [x] 6.5 Mount the router in `src/index.ts`: `import { transactionsRouter } from "./routes/transactions";` and `app.route("/", transactionsRouter);` after `accountsRouter`.

- [x] **Task 7: Integration tests** (AC: 2–12, 13)
  - [x] 7.1 Create `tests/integration/transactions.test.ts` modeled on `accounts.test.ts`: `drizzle(env.DB, { schema })`; `beforeAll(applyMigrations(env.DB))` + assert the `transactions` table exists; `beforeEach` clears tables in **FK-safe order** (the test DB enforces foreign keys — see Dev Notes "Foreign keys ARE enforced"): `DELETE FROM transactions` FIRST, then `DELETE FROM accounts`, `DELETE FROM categories`, `DELETE FROM users`, `DELETE FROM settings`, then KV sessions and `rate_limit:login:global`. Deleting a parent (accounts/categories/users) while child transaction rows still reference it throws `FOREIGN KEY constraint failed`. Reuse the `login()` helper verbatim. Add `30_000` ms timeout to every test that calls `login()` (argon2 in Miniflare is slow — Stories 2.1–2.3 learning).
  - [x] 7.2 Seed prerequisite account + category per test using `accountFactory`/`categoryFactory` with `created_by/updated_by = userId` (direct `db.insert`), then exercise the API. Because FKs are enforced, seeded accounts/categories AND any directly-inserted transaction MUST use the real logged-in `userId` for `created_by/updated_by` (the placeholder UUID in the factories will violate the `users` FK unless a user with that id exists — always override with `userId` from `login()`). A transaction's `account_id`/`category_id` must point to rows you actually seeded.
  - [x] 7.3 Cover: create expense with client UUID returns 201 and echoes the client id, `created_by/updated_by = userId` (AC-2); create income without id returns 201 with a server UUID (AC-3); **idempotent replay** — POST same id twice, second returns 200 with the original body unchanged and only ONE row in DB, usage_count incremented only once (AC-4, AC-5); usage_count increments on create (AC-5); GET `/:id` returns `account_name` + `category_name` (AC-6); missing `amount`/`account_id`/`type` → 400 `VALIDATION_ERROR` (AC-7); unknown `account_id` → 404 `ACCOUNT_NOT_FOUND`, unknown `category_id` → 404 `CATEGORY_NOT_FOUND` (AC-8); omitted `date` defaults to today `YYYY-MM-DD`, invalid `date` → 400 (AC-9); `type: "transfer"` → 501 `NOT_IMPLEMENTED` (AC-10); auth required on POST and GET (401, mirror the accounts `requires auth` test).
  - [x] 7.4 Add balance-derivation coverage to `tests/integration/accounts.test.ts`: seed an account (`initial_balance "1000.00"`) plus an income transaction `"500.00"` and an expense transaction `"200.00"` for that account (direct `db.insert` into `schema.transactions` with `is_deleted: 0`, `account_id` = the seeded account's id, `category_id` = a seeded category's id, `created_by/updated_by = userId`), then `GET /api/v1/accounts` and assert `current_balance === "1300.00"` and `summary.total_assets`/`net_worth` reflect it (AC-11). Add a case with one `is_deleted: 1` transaction and assert it is excluded from the balance (AC-12). Import `schema.transactions`; these tests need `applyMigrations` (already in `beforeAll`) to have created the table (it now will, via `0003`). **Add `DELETE FROM transactions` as the FIRST statement in the accounts.test.ts `beforeEach`** (before `DELETE FROM accounts`/`users`) — FKs are enforced, so clearing accounts/users while transaction rows reference them throws. This `beforeEach` change is REQUIRED even for the existing accounts tests, because once `0003` lands and `getTransactionDeltas` runs a real query, leftover transaction rows from a prior test would otherwise skew balances and block parent deletes.
  - [x] 7.5 Add `transactions` to the `tests/fixtures/factories.ts` with a `transactionFactory(overrides)` returning an `InferInsertModel<typeof schema.transactions>` (defaults: random id, `type: "expense"`, `amount: "0"`, a placeholder `account_id`, `category_id`, today's `date`, `is_deleted: 0`, `deleted_at: null`, `destination_account_id: null`, `created_by/updated_by` placeholder UUID, timestamps) — mirror `accountFactory`. Tests MUST override `account_id`/`category_id`/`created_by`/`updated_by` with real seeded ids (FKs are enforced — see Dev Notes "Foreign keys ARE enforced"); `amount`/`type` as needed.

- [x] **Task 8: Verification gate** (AC: 13)
  - [x] 8.1 `bun run check-types` from `apps/api/` — exit 0.
  - [x] 8.2 `bun run lint` from `apps/api/` — exit 0.
  - [x] 8.3 `bun run test --run` from `apps/api/` — all suites green (new `transactions` + updated `accounts` + existing `categories`, `auth`, `health`, `middleware`, `schema`, `settings`, `setup`). If `auth.test.ts` hits the known environmental argon2/Miniflare timeout, that is pre-existing and unrelated (this story touches no auth code).
  - [x] 8.4 Update the Dev Agent Record below: File List and any deviations from this plan.

## Dev Notes

### Critical scope boundary — what this story is and is NOT

This story is the FIRST in Epic 3 and creates the `transactions` table that Stories 3.2–3.4 build on. It delivers ONLY:

- ✅ `transactions` Drizzle table + migration `0003` (AC-1).
- ✅ `POST /api/v1/transactions` for **expense** and **income** only, with client-UUID idempotency (AC-2–AC-5, AC-7–AC-9).
- ✅ `GET /api/v1/transactions/:id` with account/category names (AC-6).
- ✅ Filling the Story 2.3 `getTransactionDeltas` seam so account balances finally reflect real income/expense (AC-11, AC-12).
- ✅ Domain error codes `ACCOUNT_NOT_FOUND`/`CATEGORY_NOT_FOUND`/`NOT_IMPLEMENTED` via a small `ApiError` (AC-8, AC-10).

This story MUST NOT:

- ❌ Implement transfers (debit/credit, `destination_account_id`, `db.batch()` atomicity) — Story 3.2. Return **501 `NOT_IMPLEMENTED`** for `type: "transfer"` (AC-10).
- ❌ Implement `PUT` (update), `DELETE` (soft-delete), `GET /trash`, `POST /:id/restore`, or `POST /trash/purge` — Story 3.3.
- ❌ Implement listing, pagination, cursors, filters, or `?q=` search — Story 3.4.
- ❌ Add `current_balance` to create/get/update **account** responses — list endpoint only (Story 2.3 boundary still holds).
- ❌ Use SQL `SUM(amount)` or any float math for balances — string-decimal aggregation in TypeScript via `lib/decimal.ts`.

[Source: epics.md#Epic-3 (story split 3.1–3.4), architecture.md#Implementation-Sequence, 2-3-...md#Critical-scope-boundary]

### Domain error codes — the single biggest non-obvious task

The epic ACs demand `ACCOUNT_NOT_FOUND` and `CATEGORY_NOT_FOUND` (404) and (per the 3.2 scope guard chosen here) `NOT_IMPLEMENTED` (501). The current `src/middleware/error-handler.ts` derives the error **code from the status** (`deriveCode(status)`) — so every 404 it sees becomes `NOT_FOUND`, regardless of message. A plain `throw new HTTPException(404, { message: "Account not found" })` would therefore emit `{ code: "NOT_FOUND" }` and FAIL AC-8.

Fix (preferred — option A): add `src/lib/api-error.ts`:

```typescript
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends HTTPException {
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(status, { message });
    this.code = code;
  }
}
```

Then in `error-handler.ts`, inside the `err instanceof HTTPException` branch:

```typescript
const code = err instanceof ApiError ? err.code : deriveCode(err.status);
```

(replace the single `deriveCode(err.status)` use that builds the body). Everything else stays the same — plain `HTTPException` keeps mapping by status, so the existing `accounts`/`categories` 404 tests (which expect generic `NOT_FOUND`) keep passing. `ApiError` lives in `lib/`; it only imports from `hono/...`, which the `no-restricted-imports` rule allows (the rule only blocks `services/` and `routes/`). Verify `hono/utils/http-status` resolves under `moduleResolution: "bundler"`; if `check-types` complains, fall back to `status: number` and `super(status as ContentfulStatusCode, ...)` or just `extends Error`-style — but `ApiError extends HTTPException` is best so Hono's `onError` still catches it. [Source: src/middleware/error-handler.ts, hono/http-exception (res/status), architecture.md#Error-Codes]

### Idempotency contract (AC-4) — exact semantics

`POST /api/v1/transactions` with an `id` that already exists returns the **stored row as-is** (body ignored), status **200**. This is offline-retry-safety (FR-TXN-10 / NFR-REL-01), NOT an upsert — do not merge or update fields. Implementation: look up by `id` first; if present, return it as a "replay". Also guard the insert itself against a `UNIQUE constraint failed` PK collision (two concurrent identical retries) by catching and re-selecting — same defensive pattern `category.service.ts` uses for its unique index. Critically, **usage_count must NOT be incremented on a replay** (AC-5) — only on a genuinely new insert.

### Returning 200 vs 201 from the route

`@hono/zod-openapi` validates that `c.json(body, status)` uses a declared response status. The create route must declare BOTH `200` and `201`. Recommended service return shape so the route picks the status:

```typescript
// transaction.service.ts
export const createTransaction = async (
  db, input, userId,
): Promise<{ transaction: Transaction; replayed: boolean }> => { ... }
// route
const { transaction, replayed } = await createTransaction(db, input, userId);
return c.json(transaction, replayed ? 200 : 201);
```

Both response schemas are `transactionSchema` (the replay returns the same entity shape). [Source: src/routes/accounts.ts (createAccountRoute 201 pattern), @hono/zod-openapi status discipline]

### Balance derivation — filling the Story 2.3 seam (AC-11, AC-12)

Story 2.3 left `getTransactionDeltas(db)` in `account.service.ts` returning an empty `Map` after a `sqlite_master` probe, with this exact comment: *"Epic 3 (Story 3.1+) implements per-account transaction summation here."* This is that moment. The sign convention:

- `income` → `+amount` (increases balance)
- `expense` → `−amount` (decreases balance)
- `transfer` → ignored this story (none exist yet; Story 3.2 defines transfer's debit-source/credit-destination effect)

Compute with `lib/decimal.ts`:

```typescript
// transaction.service.ts (consumed by account.service.ts)
import { add, subtract } from "../lib/decimal";

export const getAccountDeltas = async (
  db: DrizzleD1Database,
): Promise<Map<string, string>> => {
  const rows = await db
    .select({ account_id: transactions.account_id, type: transactions.type, amount: transactions.amount })
    .from(transactions)
    .where(eq(transactions.is_deleted, 0));
  const deltas = new Map<string, string>();
  for (const row of rows) {
    const current = deltas.get(row.account_id) ?? "0";
    if (row.type === "income") deltas.set(row.account_id, add(current, row.amount));
    else if (row.type === "expense") deltas.set(row.account_id, subtract(current, row.amount));
    // transfer: no-op this story
  }
  return deltas;
};
```

`account.service.ts#getTransactionDeltas` keeps its missing-table guard (the `sqlite_master` probe, or a `try/catch` on `no such table` like `category.service.ts`) and, when the table exists, delegates to `getAccountDeltas`. The integration test DB always has the table now (migration `0003`), but the guard keeps unit-level robustness and matches AC-6 of Story 2.3 ("MUST NOT throw when no transactions table is present"). Never use SQL `SUM` (string amounts can't be summed in SQLite) and never `parseFloat` — see 2-3 Dev Notes "Why NOT big.js". [Source: src/services/account.service.ts (getTransactionDeltas seam), 2-3-...md, architecture.md#Data-Architecture]

### Foreign keys ARE enforced in the test environment (verified)

Confirmed at story-creation time by probing the `@cloudflare/vitest-pool-workers` D1 environment: `PRAGMA foreign_keys` returns `1`, and inserting a row with a dangling FK fails with `D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY`. Consequences for this story:

1. **Schema FK columns must reference real rows.** `account_id` (→ accounts), `category_id` (→ categories, nullable), `destination_account_id` (→ accounts, nullable), `created_by`/`updated_by` (→ users) all enforce. A nullable FK (`category_id`, `destination_account_id`, `deleted_at`) accepts `NULL` fine, but a non-null value must match an existing parent.
2. **Test seeding must use the real `userId`.** `accountFactory`/`categoryFactory`/`transactionFactory` default `created_by/updated_by` to a placeholder UUID (`00000000-...`). That placeholder user does NOT exist after `login()` provisions the real user, so inserts using the default will throw a FK error. **Always override `created_by`/`updated_by` with the `userId` returned by `login()`** when seeding (the existing accounts/categories tests already do this — follow the same pattern). Likewise a seeded transaction's `account_id`/`category_id` must be ids you actually inserted.
3. **`beforeEach` delete order matters.** Delete children before parents: `transactions` → `accounts` → `categories` → `users` → `settings`. Deleting a parent that still has referencing transaction rows throws. The existing accounts/categories `beforeEach` blocks worked only because no `transactions` table existed; once `0003` lands they MUST clear `transactions` first.
4. **The `accounts` ON DELETE is `no action`** (Drizzle's default, see `0002_*.sql`). There is no cascade — you cannot delete an account/category/user with referencing transactions; the app's soft-delete model (Story 3.3) sidesteps this for real usage, but tests must clean up in order.

[Source: empirical probe of the vitest-pool-workers D1 binding; src/db/migrations/0002_slippery_viper.sql (ON DELETE no action); tests/integration/accounts.test.ts (beforeEach pattern)]

### `.returning()` is unreliable on D1 — always select back

Stories 2.1–2.2 established that Drizzle `.returning()` is unreliable on D1: insert, then `SELECT ... WHERE id = ?` to load the row you return. `createTransaction` and `createAccount` both follow this. Do the same here. [Source: 2-3-...md#Previous-Story-Learnings, src/services/account.service.ts#createAccount]

### Existing code state & conventions to mirror (Stories 1.1–2.3)

- **Schema files** (`src/db/schema/*.ts`): one table per file, `sqliteTable`, snake_case columns, FK via `.references(() => other.id)`, indexes in the table-extras callback. `index.ts` is a barrel re-export. Booleans are `integer` 0/1 with a `.default(...)`; the service mapper converts to JS `boolean`. [accounts.ts, categories.ts]
- **Service files**: pure functions `(db, input, userId)`; private `toX(row)` mapper; `HTTPException`/`ApiError` for errors; select-back after insert/update; atomic SQL increment for counters (`sql\`${col} + 1\``). [account.service.ts, category.service.ts]
- **Route files**: `OpenAPIHono` with the shared `defaultHook` (VALIDATION_ERROR/400); `createRoute` per endpoint declaring every response status; `authMiddleware` registered per path; thin handlers (`drizzle(c.env.DB)` → `c.get("userId")` → `c.req.valid(...)` → service → `c.json`). [accounts.ts, categories.ts]
- **Schema (Zod) files**: `import { z } from "zod"` (NOT `@hono/zod-openapi`); `decimalStringSchema` regex `/^-?\d+(\.\d+)?$/` max 30; export inferred types. [account.schema.ts]
- **Tests**: `drizzle(env.DB, { schema })`; `applyMigrations` in `beforeAll`; `beforeEach` clears tables + KV; `login()` helper provisions the user via `INITIAL_PASSWORD`; `app.request(path, options, env)` with `env` third; `30_000` timeout on any test that logs in; assert raw JSON when checking for ABSENCE of a key, parse with the Zod schema when asserting presence/values. [accounts.test.ts, categories.test.ts]
- **Migrations**: `0000` settings+users, `0001` categories, `0002` accounts. This story adds `0003` transactions. `applyMigrations` auto-discovers via `import.meta.glob` and runs in filename order. The D1 binding is `DB`; KV is `SESSIONS`; R2 is `RECEIPTS`. [_journal.json, wrangler.toml, tests/setup.ts]

### Project Structure Notes

Maps 1:1 onto the architecture's mandated structure (architecture.md#Requirements-to-Structure-Mapping: `FR-TXN-* → routes/transactions.ts + services/transaction.service.ts + schemas/transaction.schema.ts`). New files: `src/db/schema/transactions.ts`, `src/schemas/transaction.schema.ts`, `src/services/transaction.service.ts`, `src/routes/transactions.ts`, `src/lib/api-error.ts`, `tests/integration/transactions.test.ts`. The `src/lib/api-error.ts` addition is a new infrastructure helper (allowed in `lib/`); it is the cleanest way to satisfy the epic's domain error codes and will be reused by every later domain (transfers, receipts, collaboration). No structural variance from the architecture. [Source: architecture.md#Project-Structure-and-Boundaries, architecture.md#Requirements-to-Structure-Mapping]

### Latest Tech Information

Verified against installed versions (`apps/api/package.json`, locked via `bun.lock`, 2026-05-30):

- **zod ^4.4.3** — `z.iso.date()` exists and validates `YYYY-MM-DD` (confirmed at story-creation time by executing `z.iso.date().parse("2026-05-28")`). Use it for the optional `date` field; compute the "today" default in the service (`new Date().toISOString().slice(0, 10)`), NOT via Zod `.default()`, so the default is request-time-fresh.
- **drizzle-orm ^0.36.4** — `index(...)` / `uniqueIndex(...)` from `drizzle-orm/sqlite-core` for the table-extras callback; `sql\`...\`` tagged template for the atomic `usage_count` increment and any raw probe; `.references(() => t.id)` for FKs; nullable columns are plain `text(...)` without `.notNull()`. No new dependency required — `BigInt`-based `lib/decimal.ts` already exists (Story 2.3).
- **hono ^4.12.23** — `HTTPException` accepts `{ res, message, cause }`; `error-handler.ts` already catches `HTTPException` in `app.onError`. `ApiError extends HTTPException` is caught the same way. `ContentfulStatusCode` is exported from `hono/utils/http-status` (used internally by `HTTPException`).
- **@hono/zod-openapi ^1.4.0** — `createRoute` responses must enumerate every status the handler returns; declare `200`, `201`, `400`, `401`, `404`, `501` on the create route as needed.

No web/library risks beyond these — the stack is unchanged from Stories 1.1–2.3 and all claims were verified against the installed packages, not memory. [Source: package.json, node_modules introspection at story-creation time]

### Git Intelligence Summary

Recent commits (newest first): `b45a6c5 chore(api): harden settings validation, balance bound, OpenAPI paths, and decimal guard`; `b3602db feat: add string decimal math library` (Story 2.3 — created `lib/decimal.ts` and the `getTransactionDeltas` seam THIS story fills); `4b7eeff feat: add account crud balance` (Story 2.2 — `account.service.ts`, `accounts.test.ts` patterns to mirror); `b4781fe feat: category crud seed` (Story 2.1 — `usage_count`, UNIQUE-catch, and the `transactions` table existence-tolerance precedent in `deleteCategory`). All prior stories landed with `check-types`/`lint`/`test --run` green — that is the bar. No item in `deferred-work.md` blocks this story; the deferred multi-currency summary and decimal-scale-normalization items are independent and out of scope here (this story keeps the existing single-currency, scale-as-entered behavior). [Source: git log, _bmad-output/implementation-artifacts/deferred-work.md]

### Anti-Patterns to Avoid

- ❌ Plain `new HTTPException(404, ...)` for the account/category reference checks — it emits `NOT_FOUND`, not the required `ACCOUNT_NOT_FOUND`/`CATEGORY_NOT_FOUND`. Use `ApiError` (Task 5).
- ❌ Implementing transfer balance movement, `destination_account_id`, or `db.batch()` — that is Story 3.2. Return 501 `NOT_IMPLEMENTED`.
- ❌ Adding list/pagination/search/PUT/DELETE/trash endpoints — Stories 3.3/3.4.
- ❌ SQL `SUM(amount)` or `parseFloat`/`Number(...)`/`+` on amounts anywhere — use `lib/decimal.ts` `add`/`subtract` (architecture anti-pattern; string amounts can't be summed in SQLite).
- ❌ Updating fields or re-incrementing `usage_count` on an idempotent replay (AC-4/AC-5) — return the stored row untouched.
- ❌ Relying on Drizzle `.returning()` on D1 — insert then select back.
- ❌ Hand-writing or hand-editing the migration SQL — generate via `bun run db:generate` and review.
- ❌ `import { z } from "@hono/zod-openapi"` in `transaction.schema.ts` — use `import { z } from "zod"`.
- ❌ `SELECT *` — select only the columns you need.
- ❌ Leaving `getTransactionDeltas` returning an empty map — balances must now reflect income/expense (AC-11).
- ❌ Importing `services/` or `routes/` from `src/lib/api-error.ts` — it may import only from `hono/...`.

### References

- [Source: epics.md#Story-3.1] — user story, all acceptance criteria, table columns.
- [Source: epics.md#Story-3.2] — transfer scope (deferred here → 501).
- [Source: epics.md#Story-3.3, #Story-3.4] — soft-delete/trash and listing scope (deferred here).
- [Source: architecture.md#Data-Architecture] — string-decimal amounts, TypeScript aggregation (no SQL SUM), client-UUID PKs, ISO date TEXT.
- [Source: architecture.md#Implementation-Patterns-and-Consistency-Rules] — naming, thin routes, service-layer rules, error codes, validation pattern.
- [Source: architecture.md#Project-Structure-and-Boundaries] — file locations, lib/ import restriction, service boundaries.
- [Source: architecture.md#Error-Codes] — `ACCOUNT_NOT_FOUND`, UPPER_SNAKE_CASE domain-prefixed codes.
- [Source: prd.md#FR-TXN-01..10, #NFR-REL-01, #Section-5] — functional requirements, idempotent-by-UUID, data model.
- [Source: 2-3-string-decimal-math-library-account-balance-derivation.md] — `lib/decimal.ts` API, `getTransactionDeltas` seam, D1 `.returning()` caveat, 30s test-timeout learning.
- [Source: apps/api/src/services/account.service.ts] — `getTransactionDeltas` to fill, `listAccounts` consumer, `classifyAccountType`.
- [Source: apps/api/src/services/category.service.ts] — `usage_count` atomic increment, UNIQUE-catch, missing-`transactions`-table run-and-catch precedent.
- [Source: apps/api/src/routes/accounts.ts] — route/defaultHook/auth wiring to mirror.
- [Source: apps/api/src/middleware/error-handler.ts] — `deriveCode(status)` that necessitates `ApiError` for domain codes.
- [Source: apps/api/tests/integration/accounts.test.ts] — test structure, `login()`, `beforeEach`, factories.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `bun run db:generate`
- `bun run check-types`
- `bun run lint`
- `bun run test --run tests/integration/transactions.test.ts --reporter=verbose`
- `bun run test --run tests/integration/accounts.test.ts --reporter=verbose`
- `bun run test --run tests/integration/auth.test.ts --reporter=verbose`
- `bun run test --run`

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented the `transactions` table, generated migration `0003_milky_ben_grimm.sql`, and re-exported the schema so Drizzle migrations and test bootstrap pick up the new table automatically.
- Added transaction create/get schemas, service logic, and routes with idempotent client-UUID handling, category usage-count increments, domain-specific 404/501 error codes, and transfer rejection for Story 3.2 scope protection.
- Wired account balance derivation to real non-deleted transaction deltas using `lib/decimal.ts`, keeping the missing-table guard for pre-migration contexts.
- Added transaction integration coverage, expanded account balance integration coverage, and introduced a `transactionFactory` plus FK-safe cleanup ordering for account/transaction tests.
- Increased the existing auth password-change test timeout to `120_000` so the full Vitest run completes reliably under Miniflare/argon2 load; this was an environment/test-runtime stabilization change, not an auth behavior change.
- Code review (2026-05-30): applied three patches from review findings — (1) reject non-positive transaction amounts via a dedicated `positiveAmountSchema` (400 VALIDATION_ERROR); (2) cross-check category `type` against transaction `type`, throwing `ApiError(400, "CATEGORY_TYPE_MISMATCH")`; (3) a missing required `category_id` now returns `ApiError(400, "CATEGORY_REQUIRED")` instead of 404. Added three integration tests covering these. `check-types`, `lint`, and the transactions suite (13/13) pass. Remaining review observations were deferred (see Review Findings and `deferred-work.md`).

### File List

- `apps/api/src/db/schema/transactions.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0003_milky_ben_grimm.sql`
- `apps/api/src/db/migrations/meta/0003_snapshot.json`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/schemas/transaction.schema.ts`
- `apps/api/src/services/transaction.service.ts`
- `apps/api/src/services/account.service.ts`
- `apps/api/src/routes/transactions.ts`
- `apps/api/src/index.ts`
- `apps/api/src/lib/api-error.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/tests/fixtures/factories.ts`
- `apps/api/tests/integration/transactions.test.ts`
- `apps/api/tests/integration/accounts.test.ts`
- `apps/api/tests/integration/auth.test.ts`

## Review Findings

_Code review 2026-05-30 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 13 ACs verified satisfied; gates (`check-types`, `lint`, `test --run`) confirmed green. The items below are the residual observations after triage and dedup._

### Decision needed (resolved — patched 2026-05-30)

- [x] [Review][Patch] Negative/zero `amount` accepted — silent balance corruption [src/schemas/transaction.schema.ts] — FIXED: transaction `amount` now uses a dedicated `positiveAmountSchema` (regex `/^\d+(\.\d+)?$/` + a `refine` requiring a non-zero digit), so negative and zero amounts are rejected as `VALIDATION_ERROR`/400. Account `initial_balance` is unchanged (it may legitimately be negative). New test: "rejects non-positive amounts with a validation error".
- [x] [Review][Patch] Category `type` never cross-checked against transaction `type` [src/services/transaction.service.ts] — FIXED: the category lookup now selects `type` and the service throws `ApiError(400, "CATEGORY_TYPE_MISMATCH", ...)` when `category.type !== input.type`. New test: "rejects a category whose type does not match the transaction type".
- [x] [Review][Patch] Missing `category_id` returned 404 `CATEGORY_NOT_FOUND` instead of 400 [src/services/transaction.service.ts] — FIXED: a missing required `category_id` for expense/income now throws `ApiError(400, "CATEGORY_REQUIRED", ...)` (a missing field is a validation error, distinct from a non-existent referenced row which stays 404 `CATEGORY_NOT_FOUND`). New test: "rejects expense/income with no category_id as a required-field error".

### Deferred

- [x] [Review][Defer] `usage_count` increment is non-atomic with the insert [src/services/transaction.service.ts] — deferred, Dev Notes explicitly defer `db.batch()` to Story 3.2; insert + counter update are separate D1 round-trips.
- [x] [Review][Defer] `getAccountDeltas` is a full-table scan folded in memory on every `GET /api/v1/accounts` [src/services/transaction.service.ts] — deferred, by-design string-decimal aggregation (architecture mandates no SQL `SUM`); scales O(n) with history.
- [x] [Review][Defer] Default `date` uses UTC (`new Date().toISOString().slice(0,10)`) [src/services/transaction.service.ts] — deferred, spec-conformant per AC-9; off-by-one day for a UTC+7 user near midnight. Revisit when timezone handling is defined.
- [x] [Review][Defer] `destination_account_id` accepted by the request schema but hardcoded to `null` for expense/income [src/services/transaction.service.ts, src/schemas/transaction.schema.ts] — deferred, field is owned by the transfer story; revisit in Story 3.2.
- [x] [Review][Defer] Second index is single-column `idx_transactions_is_deleted (is_deleted)` while the architecture citation references composite `idx_transactions_is_deleted_date` [src/db/migrations/0003_milky_ben_grimm.sql] — deferred, spec-internal discrepancy (code followed the Task 1.1 body); may matter for Story 3.3 trash queries.
- [x] [Review][Defer] `auth.test.ts` timeout bumped 90s→120s in an out-of-scope file [tests/integration/auth.test.ts] — deferred, test-runtime stabilization disclosed in Completion Notes; no auth behavior change (mirrors the 2-1 deferred note).
- [x] [Review][Defer] `account.is_active = 1` is checked before insert but not re-verified at insert time (TOCTOU) [src/services/transaction.service.ts] — deferred, single-owner app + D1 has no Drizzle transaction support; consistent with prior deferred TOCTOU items.
- [x] [Review][Defer] No business-range bound on `date` — `z.iso.date()` accepts `0000-01-01` / `9999-12-31` [src/schemas/transaction.schema.ts] — deferred, calendar-invalid dates are correctly rejected; add a sane min/max year if/when required.
- [x] [Review][Defer] UNIQUE-collision idempotency fallback relies on `message.includes("UNIQUE constraint failed")` [src/services/transaction.service.ts] — deferred, mirrors the mandated `category.service.ts` convention; brittle to driver message changes codebase-wide.
- [x] [Review][Defer] Test-coverage gaps [tests/integration/transactions.test.ts] — deferred, low-risk robustness: AC-7 omits all three required fields at once (no per-field isolation); AC-8 covers an unknown `account_id` but not a soft-deleted (`is_active = 0`) one.
