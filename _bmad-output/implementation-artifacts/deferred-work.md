# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-infrastructure-configuration (2026-05-28)

- Cron trigger defined in `wrangler.toml` but no `scheduled()` handler exported from `src/index.ts` — add in the story that implements the backup cron logic.

## Deferred from: code review of 1-2-database-schema-migration-workflow (2026-05-28)

- `settings` table has no `created_at` audit column — spec-level design choice; revisit if audit requirements change.
- No CI enforcement of schema/migration drift — a `drizzle-kit check` step in CI would catch Drizzle schema vs committed SQL divergence; add when CI pipeline is established.

## Deferred from: code review of 1-4-authentication-login-session-management (2026-05-28)

- refreshSession TTL not wired to settings (`src/middleware/auth.ts`) — Middleware has no DB access; needs to be threaded through or middleware restructured to accept a DB reference in a future story.

## Deferred from: code review of 1-5-authentication-password-change-rate-limiting (2026-05-28)

- No rate limit on change-password endpoint — single-user app behind auth, minimal threat model; revisit in a future hardening pass.

## Deferred from: code review of 1-6-setup-wizard-health-check (2026-05-29)

- TOCTOU race condition on `POST /api/v1/setup/initialize` — D1 has no transaction support for Drizzle query builders and the app is single-owner, so risk is acceptable at this scale.
- `POST /api/v1/setup/initialize` is unauthenticated and can be hijacked before the owner completes setup — revisit if multi-deployment or public-facing scenarios arise.
- No timeout on D1/KV/R2 health-check probes — revisit when health endpoint SLA requirements are defined.

## Deferred from: code review of 2-1-category-crud-seed (2026-05-29)

- `applyMigrations` broad "already exists" error swallowing — substring match on error text could hide unrelated migration failures; pre-existing from Story 1.1, revisit when CI migration testing is established.
- `auth.test.ts` timeout bump 30s→60s — out of declared story scope; functional change to accommodate argon2 runtime in test environment.
- `tests/import-meta.d.ts` undocumented file addition — necessary for `import.meta.glob` typing to pass `check-types`; not listed in story's "Files to Create" but required by the implementation approach.

## Deferred from: code review of 2-2-account-crud-balance-logic (2026-05-29)

- Additional edge-case test coverage for accounts (`tests/integration/accounts.test.ts`) — decimal-string rejections, name/currency boundary rejections, wrong JSON types, deactivate-via-`PUT {is_active:false}`, and double soft-delete are unexercised. Behavior reads correct; add robustness tests later.

## Deferred from: code review of 2-3-string-decimal-math-library-account-balance-derivation (2026-05-29)

- Summary totals ignore per-account `currency` (`src/services/account.service.ts`) — `total_assets`/`total_liabilities`/`net_worth` sum `current_balance` across all currencies. Matches AC-8 as written and only `IDR` is used today; revisit when multi-currency aggregation semantics are defined.
- Inconsistent decimal scale in output (`src/lib/decimal.ts`) — `sum([])` returns `"0"` (scale 0) while populated totals carry input scale (e.g. `"1000.00"`), so `summary` and `items` can mix `"0"` and `"1000.00"`. Spec-mandated for this story; consider a uniform money-format normalization pass for API consumers.
- Leading-zero representation mismatch (`src/services/account.service.ts` + `src/lib/decimal.ts`) — `decimalStringSchema` accepts `"007.50"` but the derived `current_balance` normalizes to `"7.50"`. Pairs with the deferred 2.2 `initial_balance` bounds/normalization item.
- `getTransactionDeltas` discards its `sqlite_master` probe result (`src/services/account.service.ts`) — both branches return an empty Map, so the per-request query is wasted until Epic 3 fills the existence branch. Intentional forward-compat seam (AC-6); harmless minor overhead.

## Deferred from: code review of 3-1-expense-income-transactions (2026-05-30)

- `usage_count` increment is non-atomic with the transaction insert (`src/services/transaction.service.ts`) — insert and the `UPDATE categories SET usage_count = usage_count + 1` are separate D1 round-trips with no batch/transaction; Dev Notes explicitly defer `db.batch()` to Story 3.2. A partial failure leaves a committed transaction with an un-incremented counter.
- `getAccountDeltas` full-table scan folded in memory (`src/services/transaction.service.ts`) — every `GET /api/v1/accounts` reads all non-deleted transactions across all accounts and folds them in JS (architecture mandates no SQL `SUM`). O(n) latency/memory growth with history; revisit if a cached/snapshot balance is needed.
- Default `date` derived in UTC (`src/services/transaction.service.ts`) — `new Date().toISOString().slice(0,10)`; spec-conformant per AC-9 but produces an off-by-one day for a UTC+7 user near midnight. Revisit when app-wide timezone handling is defined.
- `destination_account_id` accepted by `createTransactionRequestSchema` but hardcoded `null` (`src/schemas/transaction.schema.ts`, `src/services/transaction.service.ts`) — field belongs to transfers; wire it up in Story 3.2.
- Index discrepancy: code created `idx_transactions_is_deleted (is_deleted)` while the architecture citation references composite `idx_transactions_is_deleted_date` (`src/db/migrations/0003_milky_ben_grimm.sql`) — spec-internal; reassess when Story 3.3 trash queries are written.
- `auth.test.ts` timeout bumped 90s→120s (`tests/integration/auth.test.ts`) — out-of-scope test-runtime stabilization for argon2/Miniflare; no behavior change (recurring pattern, see 2-1).
- TOCTOU on `account.is_active = 1` check vs insert (`src/services/transaction.service.ts`) — account can be deactivated between the check and the insert; single-owner app + no D1 transaction support makes risk acceptable, consistent with prior deferred TOCTOU items.
- No business-range bound on `date` (`src/schemas/transaction.schema.ts`) — `z.iso.date()` accepts year `0000`/`9999`; calendar-invalid dates are correctly rejected. Add min/max bounds if required.
- UNIQUE-collision idempotency fallback string-matches `"UNIQUE constraint failed"` (`src/services/transaction.service.ts`) — brittle to D1/driver message changes; mirrors the established `category.service.ts` convention, so revisit codebase-wide.
- Test-coverage gaps (`tests/integration/transactions.test.ts`) — AC-7 omits all three required fields simultaneously (no per-field isolation); AC-8 does not cover a soft-deleted (`is_active = 0`) account_id; the `getTransaction` null-`category_name` branch is unreachable this story.

## Resolved in: Story 3.2 — Transfer Between Accounts (2026-05-30)

- `db.batch()` atomicity verified: **IS atomic** in D1/Miniflare — a failing statement rolls back all preceding statements in the batch. Safe to use `db.batch()` for multi-statement operations. Permanent regression test in `tests/integration/batch-atomicity.test.ts`.
