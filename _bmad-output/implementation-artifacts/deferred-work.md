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
- `settingsRouter` missing `defaultHook` — `@hono/zod-openapi` child routers do NOT inherit the parent's `defaultHook`; `settingsRouter` has no validation-error hook, meaning invalid input to settings routes may not return the standard `VALIDATION_ERROR` envelope. Add a `defaultHook` to `settingsRouter` (and all future routers) in a future story.

## Deferred from: code review of 2-2-account-crud-balance-logic (2026-05-29)

- `initial_balance` has no max-length bound (`src/schemas/account.schema.ts`) — `name`/`currency` are bounded but the decimal string is not; an arbitrarily long numeric string is accepted and stored. AC-10's mandated schema omits a max; add a sane upper bound in a future hardening pass.
- Additional edge-case test coverage for accounts (`tests/integration/accounts.test.ts`) — decimal-string rejections, name/currency boundary rejections, wrong JSON types, deactivate-via-`PUT {is_active:false}`, and double soft-delete are unexercised. Behavior reads correct; add robustness tests later.
- OpenAPI routes use Hono-style `:id` instead of `{id}` (`src/routes/accounts.ts`) — codebase-wide pattern (also in `categories.ts`); generated OpenAPI param docs may be affected. Standardize the path-param style across all routers in one pass.

## Deferred from: code review of 2-3-string-decimal-math-library-account-balance-derivation (2026-05-29)

- Summary totals ignore per-account `currency` (`src/services/account.service.ts`) — `total_assets`/`total_liabilities`/`net_worth` sum `current_balance` across all currencies. Matches AC-8 as written and only `IDR` is used today; revisit when multi-currency aggregation semantics are defined.
- Inconsistent decimal scale in output (`src/lib/decimal.ts`) — `sum([])` returns `"0"` (scale 0) while populated totals carry input scale (e.g. `"1000.00"`), so `summary` and `items` can mix `"0"` and `"1000.00"`. Spec-mandated for this story; consider a uniform money-format normalization pass for API consumers.
- Leading-zero representation mismatch (`src/services/account.service.ts` + `src/lib/decimal.ts`) — `decimalStringSchema` accepts `"007.50"` but the derived `current_balance` normalizes to `"7.50"`. Pairs with the deferred 2.2 `initial_balance` bounds/normalization item.
- `getTransactionDeltas` discards its `sqlite_master` probe result (`src/services/account.service.ts`) — both branches return an empty Map, so the per-request query is wasted until Epic 3 fills the existence branch. Intentional forward-compat seam (AC-6); harmless minor overhead.
- `toScaledBigInt` unguarded negative repeat count (`src/lib/decimal.ts`) — `"0".repeat(targetScale - parsed.scale)` would throw an opaque RangeError if `targetScale < scale`. Unreachable today (callers use `Math.max`; function is private). Add a defensive guard if the helper is ever exposed.
- Missing edge-case test coverage (`tests/unit/lib/decimal.test.ts`, `tests/integration/accounts.test.ts`) — RESOLVED 2026-05-29 in the code-review follow-up. Added unit coverage (scale-0 formatting, negative-zero at scale 0, negative/mixed-scale compare & sum, negative totals, malformed-input rejection variety) and integration coverage (empty-account zeroed summary, liabilities-exceed-assets negative net worth).
