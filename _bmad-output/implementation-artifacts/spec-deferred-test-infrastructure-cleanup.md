---
title: 'Deferred Test Infrastructure Cleanup'
type: 'chore'
created: '2026-05-29'
status: 'done'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three test infrastructure issues accumulated across stories 1.1–1.4: (1) `seedUser()` in `tests/setup.ts` duplicates the `userFactory` stub instead of composing with it; (2) `middleware.test.ts` re-wires the full app from scratch instead of importing the real `app`, creating a false coverage signal; (3) `applyMigrations()` splits SQL on bare `;` which will break on any future migration containing a semicolon inside a string literal.

**Approach:** Refactor `seedUser()` to delegate to `userFactory`, replace the hand-rolled `testApp` in `middleware.test.ts` with the real `app` export from `src/index.ts`, and replace the bare `;` split in `applyMigrations()` with the existing `-->  statement-breakpoint` delimiter that Drizzle already emits.

## Boundaries & Constraints

**Always:**
- All existing tests must continue to pass after the refactor — no behaviour changes, only structural ones.
- `seedUser()` must still accept an optional `overrides` argument (pass-through to `userFactory`).
- The SQL split fix must use the `-->  statement-breakpoint` marker already present in the migration file — do not introduce a third-party SQL parser.
- The middleware test must cover the same scenarios as today (500, 401, 400 validation, 200 health, 404).

**Ask First:**
- If importing the real `app` causes any test to require additional env bindings not currently provided by `cloudflare:test`, halt and ask before adding new test env setup.

**Never:**
- Do not change any production source files (`src/**`).
- Do not add new test scenarios beyond what already exists.
- Do not remove the `applyMigrations` or `seedUser` exports — other test files depend on them.
- Do not add test-only routes to the real `app` in `src/index.ts` — the real app has no `/test/*` routes and the middleware test needs them to trigger error paths.

## Design Notes (updated after approval)

The real `app` in `src/index.ts` has no `/test/error`, `/test/http-exception`, or `/test/validation` routes — those only existed on the hand-rolled `testApp`. Importing the real `app` directly would make those 3 error-path tests unreachable without modifying production code (forbidden). The correct refactor is therefore: keep a minimal `testApp` in the middleware test, but build it by **importing** the real middleware pieces (`errorHandler`, `defaultHook` config pattern) rather than re-implementing them inline. This eliminates the duplication of logic while preserving the test routes needed to exercise error paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| seedUser default | no overrides | inserts a user built by `userFactory()`, returns it | — |
| seedUser with overrides | `{ display_name: 'Alice' }` | inserts user with overridden field, returns it | — |
| applyMigrations multi-statement | migration SQL with `-->  statement-breakpoint` | each statement executed independently | "already exists" errors silently ignored |
| applyMigrations semicolon-in-string | future migration: `INSERT INTO t VALUES ('a;b')` | split on breakpoint marker, not `;` — statement executes correctly | — |

</frozen-after-approval>

## Code Map

- `apps/api/tests/setup.ts` -- `seedUser()` and `applyMigrations()` — both need refactoring
- `apps/api/tests/fixtures/factories.ts` -- `userFactory` — compose into `seedUser()`
- `apps/api/tests/integration/middleware.test.ts` -- hand-rolled `testApp` — replace with real `app`
- `apps/api/src/index.ts` -- real `app` default export — import target for middleware test
- `apps/api/src/db/migrations/0000_fast_johnny_storm.sql` -- uses `--> statement-breakpoint` as delimiter

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/tests/setup.ts` -- Refactor `seedUser()` to call `userFactory(overrides)` instead of inlining the stub object; add `overrides?: Partial<UserInsert>` parameter. Fix `applyMigrations()` to split on `--> statement-breakpoint` (strip it, then split on `;` only for the remaining single-statement chunks, or split directly on the marker) — the safest approach is: strip the marker, then split on `;\n` or use the marker as the primary delimiter. Concretely: replace the current `.replaceAll("--> statement-breakpoint", "").split(";")` with `.split("--> statement-breakpoint")` then trim each chunk (they are already complete statements without a trailing `;` after the split).
- [ ] `apps/api/tests/integration/middleware.test.ts` -- Remove the hand-rolled `testApp` construction. Import `app` from `../../src/index` and use it directly for all `testApp.request(...)` calls. Keep all existing `describe`/`it` blocks and assertions unchanged.

**Acceptance Criteria:**
- Given `seedUser()` is called with no args, when the returned object is inspected, then its shape matches `userFactory()` output (has `id`, `display_name`, `password_hash`, `role`, `is_active`, `created_at`).
- Given `seedUser({ display_name: 'Alice' })` is called, then the returned user has `display_name === 'Alice'`.
- Given a migration SQL containing `--> statement-breakpoint`, when `applyMigrations()` runs, then each statement executes independently without the marker appearing in any SQL string sent to D1.
- Given the middleware test suite runs, when all 5 tests execute against the real `app`, then all pass with the same status codes and response shapes as before.
- Given `bun run test` is executed in `apps/api`, then the full test suite exits 0.

## Design Notes

**SQL split strategy:** The current migration file has this pattern:
```sql
CREATE TABLE `settings` (...);
--> statement-breakpoint
CREATE TABLE `users` (...);
```
Splitting on `--> statement-breakpoint` yields two chunks, each a complete statement ending in `;`. Trim each chunk and filter empty strings — no further splitting needed. This is robust against semicolons inside string literals in future migrations.

**Middleware test import:** `src/index.ts` exports `app` as `export default app`. The test should use:
```ts
import app from '../../src/index';
```
The CORS middleware in the real app uses `c.env.CORS_ORIGIN` — the `cloudflare:test` env already provides bindings, so this should work without additional setup. If `CORS_ORIGIN` is undefined the middleware returns `""` which is fine for tests.

## Verification

**Commands:**
- `bun run test --run` (in `apps/api`) -- expected: all tests pass, exit 0
- `bun run check-types` (in `apps/api`) -- expected: no TypeScript errors

