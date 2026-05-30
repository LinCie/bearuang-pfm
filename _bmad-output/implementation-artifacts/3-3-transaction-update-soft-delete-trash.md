# Story 3.3: Transaction Update, Soft-Delete & Trash

Status: done

## Story

As the app owner,
I want to edit transactions, safely delete them with recovery, and permanently purge old trash,
so that I can fix mistakes without losing data permanently.

## Acceptance Criteria

1. **AC-1 Update non-deleted transaction.** Given a valid session and an existing non-deleted transaction, `PUT /api/v1/transactions/:id` with updated fields (amount, category_id, payee, notes, date) updates the transaction, sets `updated_by` to the authenticated user's ID, refreshes `updated_at`, and returns the updated transaction with status **200**. Affected account balances reflect the change (via `getAccountDeltas` reading the new amount at query time — no explicit balance recalculation needed).

2. **AC-2 Transfer update restrictions.** Given a valid session and an existing transfer transaction, `PUT /api/v1/transactions/:id`:
   - Only `amount`, `notes`, and `date` are editable.
   - If `account_id` or `destination_account_id` is provided and differs from the stored value, return `{ error: { code: "TRANSFER_ACCOUNTS_IMMUTABLE", message: "Cannot change accounts on a transfer. Delete and recreate instead." } }` with status **400**.
   - If `type` is provided and differs from the stored value, return `{ error: { code: "TYPE_CHANGE_NOT_ALLOWED", message: "Cannot change transaction type. Delete and recreate instead." } }` with status **400**.
   - `category_id` changes are ignored for transfers (remains `null`).

3. **AC-3 Soft-delete transaction.** Given a valid session and an existing non-deleted transaction, `DELETE /api/v1/transactions/:id` sets `is_deleted = 1` and `deleted_at = now()`, returns **204 No Content**. The transaction no longer appears in default listings and is excluded from balance derivation (already handled by `getAccountDeltas` filtering `is_deleted = 0`).

4. **AC-4 Trash listing.** Given a valid session, `GET /api/v1/transactions/trash` returns all soft-deleted transactions (`is_deleted = 1`) as `{ "items": [...] }` sorted by `deleted_at` descending. Each item includes the `deleted_at` timestamp.

5. **AC-5 Restore from trash.** Given a valid session and a soft-deleted transaction within 30 days, `POST /api/v1/transactions/:id/restore` sets `is_deleted = 0` and `deleted_at = null`, returns the restored transaction with status **200**. The affected account balance includes this transaction again.

6. **AC-6 Purge expired trash.** Given a valid session, `POST /api/v1/transactions/trash/purge` permanently deletes all transactions where `deleted_at` is older than 30 days. Returns `{ "purged_count": N }` with status **200**.

7. **AC-7 Delete already-deleted transaction.** Given a transaction that is already soft-deleted, `DELETE /api/v1/transactions/:id` returns `{ error: { code: "NOT_FOUND", message: "..." } }` with status **404**.

8. **AC-8 Restore non-existent transaction.** Given a transaction that does not exist or is permanently purged, `POST /api/v1/transactions/:id/restore` returns `{ error: { code: "NOT_FOUND", message: "..." } }` with status **404**.

9. **AC-9 Update non-existent or deleted transaction.** Given a transaction that does not exist or is soft-deleted, `PUT /api/v1/transactions/:id` returns `{ error: { code: "NOT_FOUND", message: "..." } }` with status **404**.

10. **AC-10 Category validation on update.** When updating `category_id` on a non-transfer transaction, the new category must exist and its type must match the transaction type. If not found → 404 `CATEGORY_NOT_FOUND`. If type mismatch → 400 `CATEGORY_TYPE_MISMATCH`. On successful category change, decrement old category's `usage_count` and increment new category's `usage_count`.

11. **AC-11 Type-check, lint, and tests pass.** `bun run check-types`, `bun run lint`, and `bun run test --run` (from `apps/api/`) all exit 0. New tests cover all ACs. No regressions.

## Tasks / Subtasks

- [x] **Task 1: Add update transaction schema** (AC: 1, 2, 9, 10)
  - [x] 1.1 In `src/schemas/transaction.schema.ts`, add `updateTransactionRequestSchema` — all fields optional (partial update): `amount`, `category_id`, `payee`, `notes`, `date`, `account_id`, `destination_account_id`, `type`. Use same validators as create (positiveAmountSchema for amount, `z.iso.date()` for date, etc.) but all `.optional()`.
  - [x] 1.2 Add `trashListSchema` — response schema: `z.object({ items: z.array(transactionSchema) })`.
  - [x] 1.3 Add `purgeResponseSchema` — `z.object({ purged_count: z.number() })`.

- [x] **Task 2: Add `updateTransaction` service function** (AC: 1, 2, 9, 10)
  - [x] 2.1 In `src/services/transaction.service.ts`, add `updateTransaction(db, id, input, userId)`:
    - Fetch the transaction by `id` where `is_deleted = 0`. If not found → throw `ApiError(404, "NOT_FOUND", "Transaction not found")`.
    - If stored `type === "transfer"`:
      - If `input.type` is provided and differs from stored → throw `ApiError(400, "TYPE_CHANGE_NOT_ALLOWED", ...)`.
      - If `input.account_id` is provided and differs from stored → throw `ApiError(400, "TRANSFER_ACCOUNTS_IMMUTABLE", ...)`.
      - If `input.destination_account_id` is provided and differs from stored → throw `ApiError(400, "TRANSFER_ACCOUNTS_IMMUTABLE", ...)`.
      - Only apply `amount`, `notes`, `date` from input. Ignore `category_id`.
    - If stored `type !== "transfer"`:
      - If `input.type` is provided and differs from stored → throw `ApiError(400, "TYPE_CHANGE_NOT_ALLOWED", ...)`.
      - If `input.category_id` is provided and differs from stored:
        - Validate new category exists → 404 `CATEGORY_NOT_FOUND` if not.
        - Validate category type matches transaction type → 400 `CATEGORY_TYPE_MISMATCH` if not.
        - Decrement old category `usage_count` (if old `category_id` is not null).
        - Increment new category `usage_count`.
    - Build update object with only provided fields + `updated_by = userId` + `updated_at = now`.
    - Execute `db.update(transactions).set(updateObj).where(eq(transactions.id, id))`.
    - Fetch and return the updated transaction.

- [x] **Task 3: Add soft-delete, restore, trash, purge service functions** (AC: 3, 4, 5, 6, 7, 8)
  - [x] 3.1 `softDeleteTransaction(db, id, userId)`:
    - Fetch transaction where `id` matches AND `is_deleted = 0`. If not found → throw `ApiError(404, "NOT_FOUND", ...)`.
    - Update: `is_deleted = 1`, `deleted_at = new Date().toISOString()`, `updated_by = userId`, `updated_at = new Date().toISOString()`.
  - [x] 3.2 `listTrash(db)`:
    - Select all transactions where `is_deleted = 1`, ordered by `deleted_at DESC`.
    - Return as `Transaction[]`.
  - [x] 3.3 `restoreTransaction(db, id)`:
    - Fetch transaction where `id` matches AND `is_deleted = 1`. If not found → throw `ApiError(404, "NOT_FOUND", ...)`.
    - Update: `is_deleted = 0`, `deleted_at = null`.
    - Fetch and return the restored transaction.
  - [x] 3.4 `purgeTrash(db)`:
    - Calculate cutoff: `new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()`.
    - Delete all rows where `is_deleted = 1 AND deleted_at < cutoff`.
    - Return count of deleted rows (use `db.delete(...).where(...).returning()` or count via a select before delete — D1 doesn't support `.returning()` reliably, so do a count query first: `SELECT COUNT(*) ... WHERE is_deleted = 1 AND deleted_at < cutoff`, then `DELETE ... WHERE ...`).

- [x] **Task 4: Add routes** (AC: 1–9)
  - [x] 4.1 In `src/routes/transactions.ts`, add route definitions:
    - `PUT /api/v1/transactions/{id}` — updateTransactionRoute
    - `DELETE /api/v1/transactions/{id}` — deleteTransactionRoute
    - `GET /api/v1/transactions/trash` — listTrashRoute
    - `POST /api/v1/transactions/{id}/restore` — restoreTransactionRoute
    - `POST /api/v1/transactions/trash/purge` — purgeTrashRoute
  - [x] 4.2 Register auth middleware for new paths:
    - `transactionsRouter.use("/api/v1/transactions/trash", authMiddleware)`
    - `transactionsRouter.use("/api/v1/transactions/trash/purge", authMiddleware)`
    - `transactionsRouter.use("/api/v1/transactions/:id/restore", authMiddleware)`
    - Note: `/api/v1/transactions/:id` already has auth middleware registered.
  - [x] 4.3 **CRITICAL route ordering:** Register `GET /api/v1/transactions/trash` and `POST /api/v1/transactions/trash/purge` BEFORE `GET /api/v1/transactions/{id}` and `POST /api/v1/transactions/{id}/restore` — otherwise `trash` will be matched as an `:id` param. With `@hono/zod-openapi` `createRoute`, the path is `/api/v1/transactions/trash` (literal) vs `/api/v1/transactions/{id}` (param) — Hono matches literal paths first, but register in correct order to be safe.
  - [x] 4.4 Route handlers follow thin pattern: validate → call service → respond.

- [x] **Task 5: Integration tests** (AC: 1–11)
  - [x] 5.1 Add new `describe("update transaction", ...)` block in `tests/integration/transactions.test.ts`:
    - Update expense: change amount, payee, notes, date → 200, fields updated, `updated_at` refreshed.
    - Update income: change category_id (valid same-type category) → 200, old category usage_count decremented, new incremented.
    - Update transfer: change amount, notes, date → 200.
    - Update transfer: attempt to change `account_id` → 400 `TRANSFER_ACCOUNTS_IMMUTABLE`.
    - Update transfer: attempt to change `destination_account_id` → 400 `TRANSFER_ACCOUNTS_IMMUTABLE`.
    - Update: attempt to change `type` → 400 `TYPE_CHANGE_NOT_ALLOWED`.
    - Update non-existent → 404 `NOT_FOUND`.
    - Update soft-deleted → 404 `NOT_FOUND`.
    - Update with invalid category_id → 404 `CATEGORY_NOT_FOUND`.
    - Update with mismatched category type → 400 `CATEGORY_TYPE_MISMATCH`.
  - [x] 5.2 Add new `describe("soft-delete and trash", ...)` block:
    - Delete transaction → 204, no longer in default GET, excluded from balance.
    - Delete already-deleted → 404 `NOT_FOUND`.
    - List trash → returns soft-deleted items with `deleted_at`.
    - Restore → 200, transaction back in listings, balance includes it again.
    - Restore non-existent → 404 `NOT_FOUND`.
    - Purge → permanently removes items older than 30 days, returns count.
    - Purge with nothing to purge → returns `{ purged_count: 0 }`.
  - [x] 5.3 All tests use `30_000` ms timeout for tests that call `login()`.

- [x] **Task 6: Verification gate** (AC: 11)
  - [x] 6.1 `bun run check-types` from `apps/api/` — exit 0.
  - [x] 6.2 `bun run lint` from `apps/api/` — exit 0.
  - [x] 6.3 `bun run test --run` from `apps/api/` — all suites green.

## Dev Notes

### Critical scope boundary

This story delivers:
- ✅ `PUT /api/v1/transactions/:id` — update mutable fields
- ✅ `DELETE /api/v1/transactions/:id` — soft-delete
- ✅ `GET /api/v1/transactions/trash` — list trash
- ✅ `POST /api/v1/transactions/:id/restore` — restore from trash
- ✅ `POST /api/v1/transactions/trash/purge` — permanent purge of expired items

This story MUST NOT:
- ❌ Implement listing, pagination, cursors, filters, or `?q=` search — Story 3.4.
- ❌ Change the `getAccountDeltas` logic — it already filters `is_deleted = 0`, so soft-delete automatically excludes from balances.
- ❌ Add activity logging — Story 6.2 (retrofits all mutation handlers).

### Balance derivation — no changes needed

The existing `getAccountDeltas` in `transaction.service.ts` already has:
```typescript
.where(eq(transactions.is_deleted, 0))
```
This means:
- Soft-deleted transactions are automatically excluded from balance calculations.
- Restoring a transaction automatically re-includes it in balances.
- No explicit "recalculate balance" step is needed for any operation in this story.

### Transfer update restrictions — rationale

Transfers are a single row with `account_id` (source) and `destination_account_id` (destination). Changing either account would require re-deriving balances for 4 accounts (old source, old dest, new source, new dest) and could create inconsistencies. The architecture decision is: delete and recreate instead.

### D1 `.returning()` caveat

From Story 3.1/3.2 learnings: Drizzle's `.returning()` is unreliable on D1. Pattern is:
1. Execute the mutation (insert/update/delete).
2. Fetch the row back with a separate SELECT.

For `purgeTrash`: count rows first, then delete. Do NOT rely on `.returning()` to get the count.

```typescript
// Pattern for purge:
const countResult = await db
  .select({ count: sql<number>`COUNT(*)` })
  .from(transactions)
  .where(and(eq(transactions.is_deleted, 1), lt(transactions.deleted_at, cutoff)));
const purgedCount = countResult[0]?.count ?? 0;

await db.delete(transactions).where(
  and(eq(transactions.is_deleted, 1), lt(transactions.deleted_at, cutoff))
);

return purgedCount;
```

### `usage_count` management on update

When `category_id` changes on a non-transfer transaction:
- Decrement old category's `usage_count` (only if old `category_id` is not null).
- Increment new category's `usage_count`.
- Use `sql\`${categories.usage_count} + 1\`` and `sql\`${categories.usage_count} - 1\`` patterns (already established in Story 3.1).
- Do NOT decrement below 0 — use `sql\`MAX(${categories.usage_count} - 1, 0)\``.

When a transaction is soft-deleted: do NOT decrement `usage_count` (the category was used; soft-delete is recoverable).
When a transaction is permanently purged: do NOT decrement `usage_count` (simplicity; usage_count is a hint for ordering, not an exact count).

### Route registration order

Hono matches routes in registration order for ambiguous patterns. Register literal paths before parameterized paths:

```typescript
// Register BEFORE /:id routes
transactionsRouter.openapi(listTrashRoute, ...);      // GET /api/v1/transactions/trash
transactionsRouter.openapi(purgeTrashRoute, ...);     // POST /api/v1/transactions/trash/purge

// Then parameterized routes
transactionsRouter.openapi(getTransactionRoute, ...); // GET /api/v1/transactions/{id}
transactionsRouter.openapi(updateTransactionRoute, ...); // PUT /api/v1/transactions/{id}
transactionsRouter.openapi(deleteTransactionRoute, ...); // DELETE /api/v1/transactions/{id}
transactionsRouter.openapi(restoreTransactionRoute, ...); // POST /api/v1/transactions/{id}/restore
```

**However**, with `@hono/zod-openapi` `createRoute`, the path uses `{id}` (OpenAPI param syntax) which Hono translates to `:id`. Literal paths like `/trash` will NOT match `:id` in Hono's router (Hono uses a trie-based router that prioritizes literal segments). So ordering is a safety measure, not strictly required.

### Auth middleware registration

The existing code registers:
```typescript
transactionsRouter.use("/api/v1/transactions", authMiddleware);
transactionsRouter.use("/api/v1/transactions/:id", authMiddleware);
```

The `:id` wildcard will match `trash` as well, so `GET /api/v1/transactions/trash` is already covered. But for sub-paths like `/api/v1/transactions/:id/restore` and `/api/v1/transactions/trash/purge`, add:
```typescript
transactionsRouter.use("/api/v1/transactions/:id/restore", authMiddleware);
transactionsRouter.use("/api/v1/transactions/trash/purge", authMiddleware);
```

### Existing code to modify

**`src/services/transaction.service.ts`** — add 4 new exported functions:
- `updateTransaction(db, id, input, userId)` → Transaction
- `softDeleteTransaction(db, id, userId)` → void
- `listTrash(db)` → Transaction[]
- `restoreTransaction(db, id)` → Transaction
- `purgeTrash(db)` → number

Reuse the existing private `findTransactionRow(db, id)` helper for fetching by ID — do NOT duplicate the query pattern.

**`src/schemas/transaction.schema.ts`** — add:
- `updateTransactionRequestSchema`
- `trashListSchema`
- `purgeResponseSchema`

**`src/routes/transactions.ts`** — add 5 new route definitions and handlers.

**`tests/integration/transactions.test.ts`** — add 2 new describe blocks.

No changes needed to:
- `src/db/schema/transactions.ts` — schema already has `is_deleted`, `deleted_at` columns.
- `src/services/account.service.ts` — balance derivation already excludes deleted.
- `src/db/migrations/` — no new migration needed.

### Imports needed in service

```typescript
import { and, eq, lt, sql } from "drizzle-orm";
```

The `lt` operator is needed for the purge cutoff comparison (`deleted_at < cutoff`). Verify it's imported — currently only `and`, `eq`, `sql` are imported.

### Test patterns from Story 3.2

- Use `login()` helper to get `{ token, userId }`.
- Seed accounts/categories with `accountFactory`/`categoryFactory` using `created_by/updated_by = userId`.
- Create transactions via `POST /api/v1/transactions` with auth header.
- `beforeEach` clears tables in FK-safe order: transactions → accounts → categories → users → settings.
- All tests calling `login()` use `{ timeout: 30_000 }`.

### Anti-patterns to avoid

- ❌ Using `.returning()` on D1 — always select back after mutation.
- ❌ Using `parseFloat`/`Number` on amounts — string decimal only.
- ❌ Decrementing `usage_count` on soft-delete — only on category change during update.
- ❌ Implementing pagination on trash listing — simple array for MVP (low volume).
- ❌ Adding `WHERE is_deleted = 0` to `getAccountDeltas` — it's already there.
- ❌ Importing `services/` or `routes/` from `src/lib/` — eslint restriction.
- ❌ Using `SELECT *` — select only needed columns.

### References

- [Source: epics.md#Story-3.3] — all acceptance criteria.
- [Source: architecture.md#Data-Architecture] — soft-delete scope (transactions and accounts only), string decimal amounts.
- [Source: architecture.md#Implementation-Patterns-and-Consistency-Rules] — thin routes, service-layer rules, error codes, naming.
- [Source: architecture.md#Calibration-Notes] — soft-delete for transactions only, not all entities.
- [Source: 3-2-transfer-between-accounts.md] — transfer data model (single row), `getAccountDeltas` pattern, `.returning()` caveat, test patterns.
- [Source: prd.md#FR-TXN-04] — update transaction requirement.
- [Source: prd.md#FR-TXN-05] — soft-delete requirement.
- [Source: prd.md#FR-DEL-01 through FR-DEL-04] — trash/restore/purge requirements.
- [Source: apps/api/src/services/transaction.service.ts] — existing service to extend.
- [Source: apps/api/src/routes/transactions.ts] — existing routes to extend.
- [Source: apps/api/src/schemas/transaction.schema.ts] — existing schemas to extend.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-20250514

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented all 5 endpoints: PUT update, DELETE soft-delete, GET trash, POST restore, POST trash/purge.
- Transfer update restrictions enforced (accounts immutable, type immutable).
- Category validation on update with usage_count increment/decrement.
- Purge uses count-then-delete pattern (D1 .returning() caveat).
- Route ordering: literal paths (trash, trash/purge) registered before parameterized ({id}) paths.
- All 120 tests pass (17 new tests added across 2 describe blocks).
- check-types, lint, test all exit 0.

### File List

- apps/api/src/schemas/transaction.schema.ts (modified — added updateTransactionRequestSchema, trashListSchema, purgeResponseSchema)
- apps/api/src/services/transaction.service.ts (modified — added updateTransaction, softDeleteTransaction, listTrash, restoreTransaction, purgeTrash; added `lt` import)
- apps/api/src/routes/transactions.ts (modified — added 5 route definitions, 5 handlers, auth middleware for new paths)
- apps/api/tests/integration/transactions.test.ts (modified — added "update transaction" and "soft-delete and trash" describe blocks)

### Review Findings

- [x] [Review][Patch] `restoreTransaction` doesn't update `updated_at`/`updated_by` — audit trail gap [transaction.service.ts:restoreTransaction] — FIXED
- [x] [Review][Patch] Restore doesn't validate account is still active — phantom balance on inactive account [transaction.service.ts:restoreTransaction] — FIXED
- [x] [Review][Defer] `updateTransaction` not wrapped in DB transaction — D1 limitation, no real transactions available — deferred, pre-existing
- [x] [Review][Defer] `purgeTrash` can't clean rows with NULL `deleted_at` — defensive edge case, no current code path produces this state — deferred, pre-existing
- [x] [Review][Defer] `listTrash` has no pagination — acceptable for MVP single-user low volume — deferred, pre-existing
- [x] [Review][Defer] `updateTransactionRequestSchema` allows empty body (no-op write) — harmless, low priority — deferred, pre-existing

### Change Log

- 2026-05-30: Code review applied 2 patches: restore audit trail (updated_at/updated_by) and account-active validation before restore.
- 2026-05-30: Implemented Story 3.3 — transaction update, soft-delete, trash listing, restore, and purge endpoints. All ACs satisfied.
