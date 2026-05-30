---
title: 'Deferred API Hardening (validation envelope, balance bound, OpenAPI paths, decimal guard)'
type: 'chore'
created: '2026-05-29'
status: 'done'
context: []
baseline_commit: b3602dbc6085344402ff6ba22a3f5495cea35065
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four self-contained, low-risk hardening items accumulated in `deferred-work.md` (Stories 2.1–2.3): (A) `settingsRouter` has no `defaultHook`, so invalid settings input returns a non-standard validation error body instead of the `VALIDATION_ERROR` envelope every other router emits; (B) `initial_balance` accepts an arbitrarily long decimal string (no max bound); (C) OpenAPI route paths use Hono-style `:id` instead of OpenAPI `{id}`, degrading generated OpenAPI param docs; (D) `toScaledBigInt` in `decimal.ts` throws an opaque `RangeError` if ever called with `targetScale < scale`.

**Approach:** Apply each fix in place using existing patterns — copy the established `defaultHook` onto `settingsRouter`, add a `.max()` bound to the shared `decimalStringSchema`, switch `createRoute` `path` strings to `{id}` (leaving `.use()` middleware paths as `:id`), and add an explicit guard with a clear message to `toScaledBigInt`. Tighten one existing test and add one new test.

## Boundaries & Constraints

**Always:**
- `settingsRouter` validation errors must return the same envelope as `accountsRouter`/`categoriesRouter`: `{ error: { code: "VALIDATION_ERROR", message: "Validation failed", details } }` with HTTP 400.
- Only the `createRoute` `path` strings change to `{id}`; the `*.use("/api/v1/.../:id", authMiddleware)` registrations MUST stay Hono `:id` syntax (Hono middleware matching), and all live request paths (`/api/v1/accounts/<uuid>`) keep working.
- The `initial_balance` bound must reject over-long input with the standard 400 `VALIDATION_ERROR` envelope and still accept all currently-valid values (e.g. `"5000000.00"`, `"-250"`, `"0"`).
- `toScaledBigInt` must throw a descriptive error (not silently clamp) when `targetScale < parsed.scale`, since clamping would produce wrong math.

**Ask First:** nothing — all four are self-contained and were pre-approved as deferred items.

**Never:**
- No new dependencies, no DB migration, no schema/table changes.
- Do NOT add `current_balance` to any new response, change net-worth semantics, or touch the `getTransactionDeltas` seam.
- Do NOT change the public signatures of `add`/`subtract`/`sum`/`compare` or alter their results for any currently-valid input.
- Do NOT touch unrelated deferred items (currency aggregation, scale normalization, leading-zero normalization, cron handler, refreshSession TTL, etc.).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Settings invalid body | `PUT /api/v1/settings` `{ key: "", value: "x" }` | 400 with `{ error: { code: "VALIDATION_ERROR", message: "Validation failed", details } }` | standard envelope |
| Account over-long balance | `POST /api/v1/accounts` `initial_balance` > 30 chars | 400 with `VALIDATION_ERROR` envelope | rejected at schema |
| Account valid balance | `initial_balance: "5000000.00"` | 201 created (unchanged) | N/A |
| OpenAPI path param | `GET /api/v1/accounts/<id>` | 200/404 as today; OpenAPI doc shows `{id}` param | N/A |
| Decimal guard | `toScaledBigInt(parsed, scale < parsed.scale)` | throws `RangeError` with clear message | descriptive throw |

</frozen-after-approval>

## Code Map

- `apps/api/src/routes/settings.ts` -- `settingsRouter` missing `defaultHook`; add it (item A).
- `apps/api/src/schemas/account.schema.ts` -- `decimalStringSchema`; add `.max()` bound (item B).
- `apps/api/src/routes/accounts.ts` -- `getAccountRoute`/`updateAccountRoute`/`deleteAccountRoute` `path` → `{id}` (item C). `.use()` lines unchanged.
- `apps/api/src/routes/categories.ts` -- `updateCategoryRoute`/`deleteCategoryRoute` `path` → `{id}` (item C). `.use()` lines unchanged.
- `apps/api/src/lib/decimal.ts` -- `toScaledBigInt` defensive guard (item D).
- `apps/api/tests/integration/settings.test.ts` -- strengthen "returns 400 when key is empty" to assert the standard envelope.
- `apps/api/tests/integration/accounts.test.ts` -- add "returns 400 when initial_balance exceeds max length".

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/routes/settings.ts` -- add the same `defaultHook` used by `accountsRouter`/`categoriesRouter` to the `settingsRouter` `OpenAPIHono` constructor -- standardize the validation envelope.
- [x] `apps/api/src/schemas/account.schema.ts` -- add `.max(30, "Must be at most 30 characters")` to `decimalStringSchema` (after `.trim()`, before/with `.regex()`) -- bound the decimal string length.
- [x] `apps/api/src/routes/accounts.ts` -- change the three `createRoute` `path` values from `/api/v1/accounts/:id` to `/api/v1/accounts/{id}`; leave the two `authMiddleware` `.use("/api/v1/accounts/:id", ...)` lines unchanged -- correct OpenAPI param docs.
- [x] `apps/api/src/routes/categories.ts` -- change the two `createRoute` `path` values from `/api/v1/categories/:id` to `/api/v1/categories/{id}`; leave the `.use("/api/v1/categories/:id", ...)` line unchanged -- correct OpenAPI param docs.
- [x] `apps/api/src/lib/decimal.ts` -- in `toScaledBigInt`, throw `RangeError` when `targetScale < parsed.scale` with a clear message before computing the pad -- defensive guard.
- [x] `apps/api/tests/integration/settings.test.ts` -- in the empty-key test, assert `body.error.code === "VALIDATION_ERROR"` and `body.error.message === "Validation failed"` (parse with `errorResponseSchema`) -- verify item A.
- [x] `apps/api/tests/integration/accounts.test.ts` -- add a `30_000`ms test that POSTs an `initial_balance` longer than 30 chars and asserts 400 `VALIDATION_ERROR` -- verify item B.

**Acceptance Criteria:**
- Given an authenticated `PUT /api/v1/settings` with `key: ""`, when sent, then the response is 400 with `{ error: { code: "VALIDATION_ERROR", message: "Validation failed", details } }`.
- Given an authenticated `POST /api/v1/accounts` with a 31+ character `initial_balance`, when sent, then the response is 400 with the `VALIDATION_ERROR` envelope; a valid `"5000000.00"` still returns 201.
- Given the existing accounts/categories `:id` integration tests, when run after the path change, then all continue to pass (routing unchanged at runtime).
- Given `toScaledBigInt` is called with `targetScale < parsed.scale`, when invoked, then it throws a `RangeError` whose message names the invariant.

## Verification

**Commands:**
- `bun run check-types` (from `apps/api/`) -- expected: exit 0.
- `bun run lint` (from `apps/api/`) -- expected: exit 0.
- `bun run test --run` (from `apps/api/`) -- expected: accounts, settings, categories, decimal suites green (pre-existing argon2/Miniflare timeout in `auth.test.ts`, if it occurs, is environmental and unrelated).

## Suggested Review Order

**Validation envelope (item A)**

- Entry point: settings router now carries the same `defaultHook` every other router uses, so invalid input returns the standard envelope.
  [`settings.ts:78`](../../apps/api/src/routes/settings.ts#L78)

**Input bound (item B)**

- Shared decimal schema gains a 30-char ceiling; bounds `initial_balance` without touching the regex contract.
  [`account.schema.ts:15`](../../apps/api/src/schemas/account.schema.ts#L15)

**OpenAPI param docs (item C)**

- `createRoute` paths switch to OpenAPI `{id}`; library maps to Hono `:id` at runtime, so routing is unchanged.
  [`accounts.ts:86`](../../apps/api/src/routes/accounts.ts#L86)
- Same conversion for the two category id routes.
  [`categories.ts:121`](../../apps/api/src/routes/categories.ts#L121)

**Defensive guard (item D)**

- `toScaledBigInt` now throws a named `RangeError` instead of an opaque one if ever scaled below its own precision.
  [`decimal.ts:29`](../../apps/api/src/lib/decimal.ts#L29)

**Tests (peripherals)**

- Empty-key settings test now asserts the full `VALIDATION_ERROR` envelope (verifies item A).
  [`settings.test.ts:174`](../../apps/api/tests/integration/settings.test.ts#L174)
- New over-long-balance rejection test (verifies item B).
  [`accounts.test.ts:161`](../../apps/api/tests/integration/accounts.test.ts#L161)
