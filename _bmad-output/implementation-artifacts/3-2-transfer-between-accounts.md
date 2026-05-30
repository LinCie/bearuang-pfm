# Story 3.2: Transfer Between Accounts

Status: review

## Story

As the app owner,
I want to transfer money between my accounts as a single logical event,
so that moving money between wallets doesn't get double-counted as income or expense.

## Acceptance Criteria

1. **AC-1 Transfer creation succeeds.** Given a valid session and two existing active accounts, `POST /api/v1/transactions` with `{ "type": "transfer", "amount": "1000000.00", "account_id": "source-id", "destination_account_id": "dest-id", "date": "2026-05-28" }` creates a single transfer transaction record and returns it with status **201**. The `category_id` field is `null` for transfers (not required). [Source: epics.md#Story-3.2]

2. **AC-2 Balance derivation reflects transfers.** After a transfer is created, `GET /api/v1/accounts` shows the source account's `current_balance` decreased by the transfer amount and the destination account's `current_balance` increased by the transfer amount. Transfers are NOT counted as income or expense in any aggregation (summary `total_assets`/`total_liabilities`/`net_worth` reflect the net-zero movement). [Source: epics.md#Story-3.2, architecture.md#Data-Architecture]

3. **AC-3 Atomicity verified and implemented.** The transfer implementation must first verify `db.batch()` atomicity via an integration test: insert two rows in a batch where the second deliberately fails (e.g., unique constraint violation on a known PK); if the first row was rolled back → `db.batch()` IS atomic → use `db.batch([insertTransferStmt])` (single statement, still uses batch API); if the first row was committed → `db.batch()` is NOT atomic → use a single `INSERT` statement with a subquery or alternative atomic pattern. The chosen approach is documented in Dev Notes. [Source: epics.md#Story-3.2, architecture.md#Critical-Risk-db.batch()-Atomicity, prd.md#NFR-DATA-01]

4. **AC-4 Same-account transfer rejected.** When `account_id === destination_account_id`, `POST /api/v1/transactions` returns `{ error: { code: "TRANSFER_SAME_ACCOUNT", message: "..." } }` with status **400**. [Source: epics.md#Story-3.2]

5. **AC-5 Missing `destination_account_id` rejected.** When `type` is `"transfer"` and `destination_account_id` is absent or empty, `POST /api/v1/transactions` returns a validation error with status **400**. [Source: epics.md#Story-3.2]

6. **AC-6 Non-existent or inactive destination account rejected.** When `destination_account_id` references a non-existent account OR an account with `is_active = 0`, `POST /api/v1/transactions` returns `{ error: { code: "ACCOUNT_NOT_FOUND", message: "..." } }` with status **404**. Both cases must be tested. [Source: epics.md#Story-3.2]

7. **AC-7 Idempotent transfer creation.** A transfer with a client-provided `id` that already exists returns the existing record unchanged with status **200** (same idempotency contract as Story 3.1 expense/income). [Source: epics.md#Story-3.2, prd.md#NFR-REL-01]

8. **AC-8 `category_id` is optional (null) for transfers.** The `createTransactionRequestSchema` must allow `category_id` to be absent for `type: "transfer"`. The service must NOT throw `CATEGORY_REQUIRED` for transfers. The stored `category_id` is `null`. [Source: epics.md#Story-3.2]

9. **AC-9 `NOT_IMPLEMENTED` guard removed.** The Story 3.1 scope guard that returned `501 NOT_IMPLEMENTED` for `type: "transfer"` is removed. Transfers are now fully handled. The existing test `"rejects transfer creation for this story"` in `tests/integration/transactions.test.ts` (which asserts 501) **must be deleted** — it is replaced by the AC-1 transfer creation test. [Source: epics.md#Story-3.2, 3-1-expense-income-transactions.md#AC-10]

10. **AC-10 Type-check, lint, and tests pass.** `bun run check-types`, `bun run lint`, and `bun run test --run` (from `apps/api/`) all exit 0. New tests in `tests/integration/transactions.test.ts` cover all transfer ACs. No regressions in any existing suite. [Source: architecture.md#Test-Organization]

## Tasks / Subtasks

- [x] **Task 1: Verify `db.batch()` atomicity** (AC: 3)
  - [x] 1.1 Write a one-off integration test (can be in a temporary describe block in `transactions.test.ts` or a dedicated `tests/integration/batch-atomicity.test.ts`) that:
    - **First seed a real account** (direct `db.insert` with `created_by/updated_by = userId`) — the `transactions` table has a NOT NULL FK on `account_id`, so the probe inserts will fail with `FOREIGN KEY constraint failed` unless a valid account exists.
    - Inserts a row with a known UUID via `db.batch([stmt1])` (succeeds).
    - Attempts `db.batch([stmt2_ok, stmt3_fail])` where `stmt3_fail` violates a UNIQUE constraint (e.g., re-inserts the same UUID from step 1).
    - Checks whether `stmt2_ok`'s row was committed or rolled back.
  - [x] 1.2 Based on the result, choose the implementation strategy:
    - **If atomic (rollback on failure):** Use `db.batch([insertTransferStmt])` — a single-element batch is still atomic and future-proof for when debit+credit become separate rows.
    - **If NOT atomic (partial commit):** Use a single `db.insert(transactions).values({...})` call (no batch) — a single INSERT is inherently atomic.
  - [x] 1.3 Document the finding in Dev Notes of this story and in `deferred-work.md` (update the existing `db.batch()` deferred item).
  - [x] 1.4 Remove the atomicity-probe test (or keep it as a permanent regression guard — your call, but don't leave it as a "temporary" block).

- [x] **Task 2: Update Zod schema for transfers** (AC: 5, 8)
  - [x] 2.1 In `src/schemas/transaction.schema.ts`, update `createTransactionRequestSchema` so that `destination_account_id` is required when `type === "transfer"` and forbidden (or ignored) otherwise. Use a Zod discriminated union or a `.superRefine()` / `.refine()` cross-field check:
    ```typescript
    // Option A — superRefine (simpler, keeps one schema object):
    .superRefine((data, ctx) => {
      if (data.type === "transfer" && !data.destination_account_id) {
        ctx.addIssue({ code: "custom", path: ["destination_account_id"], message: "Required for transfers" });
      }
    })
    // Option B — discriminated union (more explicit, more verbose)
    ```
    Prefer Option A (superRefine) to keep the schema flat and consistent with the existing single-object shape. The `defaultHook` in the route will catch the Zod issue and return `VALIDATION_ERROR`/400 (AC-5).
    
    **⚠️ Type inference note:** Adding `.superRefine()` changes the schema type from `ZodObject` to `ZodEffects<ZodObject>`. Verify `bun run check-types` passes after this change — `@hono/zod-openapi`'s `createRoute` body schema may require `ZodObject`. If `check-types` fails with a type error on the route definition, fall back to doing the check in the service instead: keep `destination_account_id` as optional in the schema, and in `createTransaction` throw `new ApiError(400, "VALIDATION_ERROR", "destination_account_id is required for transfers")` when `input.type === "transfer" && !input.destination_account_id`. This is equally correct and avoids the `ZodEffects` issue.
  - [x] 2.2 `category_id` remains optional for all transaction types (already optional in the schema). No change needed for AC-8 at the schema level — the service change (Task 3) handles it.

- [x] **Task 3: Update transaction service** (AC: 1, 2, 3, 4, 6, 7, 8, 9)
  - [x] 3.1 Remove the `NOT_IMPLEMENTED` guard for `type === "transfer"` (AC-9).
  - [x] 3.2 Add transfer-specific validation before any DB work:
    - If `input.account_id === input.destination_account_id` → throw `new ApiError(400, "TRANSFER_SAME_ACCOUNT", "Source and destination accounts must be different")` (AC-4).
    - Validate source account exists and is active (already done for all types — no change).
    - Validate destination account exists and is active: query `accounts` where `id = destination_account_id AND is_active = 1`; if missing → throw `new ApiError(404, "ACCOUNT_NOT_FOUND", "Destination account not found")` (AC-6).
  - [x] 3.3 Skip `CATEGORY_REQUIRED` check for transfers (AC-8): the existing check `if (!input.category_id) throw CATEGORY_REQUIRED` must be guarded with `if (input.type !== "transfer" && !input.category_id)`.
  - [x] 3.4 Skip `CATEGORY_TYPE_MISMATCH` check for transfers: guard the category-type cross-check with `if (input.type !== "transfer" && input.category_id)`.
  - [x] 3.5 Insert the transfer record using the atomicity strategy from Task 1 (AC-3). Set `destination_account_id` from `input.destination_account_id`, `category_id: null` (transfers have no category).
  - [x] 3.6 Do NOT increment `usage_count` for transfers (no `category_id`).
  - [x] 3.7 Idempotency (AC-7): the existing `findTransactionRow` early-return for a pre-existing `id` already handles this — no change needed.

- [x] **Task 4: Update balance derivation for transfers** (AC: 2)
  - [x] 4.1 In `src/services/transaction.service.ts`, update `getAccountDeltas` to handle `type === "transfer"`:
    ```typescript
    if (row.type === "income") {
      deltas.set(row.account_id, add(current, row.amount));
    } else if (row.type === "expense") {
      deltas.set(row.account_id, subtract(current, row.amount));
    } else if (row.type === "transfer") {
      // Debit source account
      deltas.set(row.account_id, subtract(current, row.amount));
      // Credit destination account
      if (row.destination_account_id) {
        const destCurrent = deltas.get(row.destination_account_id) ?? "0";
        deltas.set(row.destination_account_id, add(destCurrent, row.amount));
      }
    }
    ```
  - [x] 4.2 The `getAccountDeltas` query already selects `account_id`, `type`, `amount` — add `destination_account_id` to the select list:
    ```typescript
    .select({
      account_id: transactions.account_id,
      destination_account_id: transactions.destination_account_id,
      type: transactions.type,
      amount: transactions.amount,
    })
    ```
  - [x] 4.3 Verify `GET /api/v1/accounts` summary: a transfer moves money between accounts but does not change total assets or liabilities (net-zero). The existing `listAccounts` aggregation in `account.service.ts` computes `total_assets` and `total_liabilities` from `current_balance` per account — since the debit and credit cancel out, the summary is automatically correct. No change needed in `account.service.ts`.

- [x] **Task 5: Integration tests** (AC: 1–10)
  - [x] 5.1 Add transfer tests to `tests/integration/transactions.test.ts` (in a new `describe("transfers", ...)` block). **First, delete the existing test `"rejects transfer creation for this story"` (the 501 assertion) — it is superseded by the AC-1 test below.**
    - **AC-1:** Create transfer with two accounts → 201, `type: "transfer"`, `destination_account_id` set, `category_id: null`.
    - **AC-2:** After transfer, `GET /api/v1/accounts` shows source balance decreased and destination balance increased by the transfer amount; `summary.net_worth` is unchanged.
    - **AC-4:** Same-account transfer → 400 `TRANSFER_SAME_ACCOUNT`.
    - **AC-5:** Transfer without `destination_account_id` → 400 `VALIDATION_ERROR`.
    - **AC-6:** Transfer with unknown `destination_account_id` → 404 `ACCOUNT_NOT_FOUND`. Transfer with an **inactive** (`is_active = 0`) destination account → 404 `ACCOUNT_NOT_FOUND` (seed the account then soft-delete it via `db.update` before the test).
    - **AC-7:** Idempotent transfer — POST same `id` twice → second returns 200 with original body.
    - **AC-8:** Transfer with no `category_id` → 201 (no `CATEGORY_REQUIRED` error).
    - **AC-9:** `type: "transfer"` no longer returns 501 (covered by AC-1 test).
  - [x] 5.2 Seed two accounts per transfer test using `accountFactory` with `created_by/updated_by = userId` (direct `db.insert`). Both accounts must be active (`is_active: 1`).
  - [x] 5.3 Ensure `beforeEach` still clears `transactions` FIRST (before `accounts`, `categories`, `users`) — FK-safe order established in Story 3.1.
  - [x] 5.4 Add `30_000` ms timeout to all tests that call `login()`.

- [x] **Task 6: Verification gate** (AC: 10)
  - [x] 6.1 `bun run check-types` from `apps/api/` — exit 0.
  - [x] 6.2 `bun run lint` from `apps/api/` — exit 0.
  - [x] 6.3 `bun run test --run` from `apps/api/` — all suites green.

## Dev Notes

### Critical scope boundary — what this story is and is NOT

This story delivers ONLY:

- ✅ Transfer creation via `POST /api/v1/transactions` with `type: "transfer"` (AC-1).
- ✅ Balance derivation updated to debit source and credit destination for transfers (AC-2).
- ✅ `db.batch()` atomicity verified and implementation strategy chosen (AC-3).
- ✅ Transfer-specific validation: same-account guard, missing destination, inactive destination (AC-4, AC-5, AC-6).
- ✅ Idempotent transfer creation by client UUID (AC-7).
- ✅ `category_id` optional for transfers (AC-8).
- ✅ `NOT_IMPLEMENTED` guard removed (AC-9).

This story MUST NOT:

- ❌ Implement `PUT` (update), `DELETE` (soft-delete), `GET /trash`, `POST /:id/restore`, or `POST /trash/purge` — Story 3.3.
- ❌ Implement listing, pagination, cursors, filters, or `?q=` search — Story 3.4.
- ❌ Change transfer account fields on update — Story 3.3 defines `TRANSFER_ACCOUNTS_IMMUTABLE`.
- ❌ Use SQL `SUM(amount)` or any float math for balances — string-decimal aggregation in TypeScript via `lib/decimal.ts`.

### `db.batch()` atomicity — the critical architectural decision

The architecture document flags this as a **Critical Risk**: D1's `db.batch()` may NOT provide true transaction semantics with rollback. If statement N fails, statements 1..N-1 may already be committed. This is a money-correctness issue.

**Verification approach (Task 1):**

```typescript
// In a test — seed a real account first (transactions.account_id is a NOT NULL FK):
// const account = accountFactory({ created_by: userId, updated_by: userId });
// await db.insert(schema.accounts).values(account);
const knownId = "known-uuid-for-atomicity-test";
// stmt1: insert a new row (should succeed)
const stmt1 = db.insert(transactions).values({ id: crypto.randomUUID(), ... }).prepare();
// stmt2: re-insert the known UUID (should fail with UNIQUE constraint)
const stmt2 = db.insert(transactions).values({ id: knownId, ... }).prepare();

try {
  await db.batch([stmt1, stmt2]);
} catch (e) {
  // Check if stmt1's row was committed (NOT atomic) or rolled back (atomic)
  const row = await db.select().from(transactions).where(eq(transactions.id, stmt1_id));
  if (row.length > 0) {
    // NOT atomic — stmt1 committed despite stmt2 failing
  } else {
    // Atomic — both rolled back
  }
}
```

**Implementation strategies:**

- **If atomic:** `await db.batch([db.insert(transactions).values({...})])` — single-element batch. This is semantically equivalent to a plain insert but uses the batch API, which is future-proof if we ever need to add a second statement (e.g., activity log) atomically.
- **If NOT atomic:** `await db.insert(transactions).values({...})` — plain insert. A single INSERT is always atomic in SQLite. Do NOT use `db.batch()` for the transfer insert.

**Note:** The architecture originally envisioned `db.batch([debitStmt, creditStmt])` for transfers, but the current data model stores a transfer as a **single row** with both `account_id` (source) and `destination_account_id` (destination). The balance debit/credit is derived at read time in `getAccountDeltas`, not stored as two separate rows. Therefore, the atomicity concern reduces to: "is the single INSERT atomic?" — which it always is. The `db.batch()` verification is still worth doing to document the platform behavior for future stories (e.g., Story 3.3's `usage_count` increment + insert, or activity logging).

### Transfer data model — single row, not two rows

Unlike a traditional double-entry bookkeeping system, bearuang stores a transfer as **one row** in the `transactions` table:

```
id: "uuid"
type: "transfer"
amount: "1000000.00"
account_id: "source-account-id"          ← debit this account
destination_account_id: "dest-account-id" ← credit this account
category_id: null
```

The balance effect is computed in `getAccountDeltas` at read time:
- Source account: `balance -= amount`
- Destination account: `balance += amount`

This means:
- No `db.batch()` needed for the insert itself (single row).
- The `db.batch()` atomicity question is still relevant for future stories (activity log, usage_count).
- Transfers are excluded from income/expense aggregations because `getAccountDeltas` handles them separately.

### Existing code to modify

**`src/services/transaction.service.ts`** — primary change file:
- Remove the `NOT_IMPLEMENTED` guard (lines ~20-22 in current file).
- Add transfer validation (same-account check, destination account lookup).
- Guard `CATEGORY_REQUIRED` and `CATEGORY_TYPE_MISMATCH` checks with `input.type !== "transfer"`.
- Update `getAccountDeltas` to handle `type === "transfer"` (add `destination_account_id` to select, add debit/credit logic).

**`src/schemas/transaction.schema.ts`** — add `superRefine` for `destination_account_id` required on transfers.

**`tests/integration/transactions.test.ts`** — add transfer test suite.

No changes needed to:
- `src/routes/transactions.ts` — route already declares `destination_account_id` in the request schema and handles 400/404 responses.
- `src/services/account.service.ts` — `listAccounts` consumes `getAccountDeltas` map unchanged; the map now includes transfer deltas automatically.
- `src/db/schema/transactions.ts` — `destination_account_id` column already exists (Story 3.1).
- `src/db/migrations/` — no new migration needed (schema unchanged).

### Zod `superRefine` for cross-field validation

The `createTransactionRequestSchema` needs a cross-field rule: `destination_account_id` is required when `type === "transfer"`. Use `superRefine` to keep the schema as a single flat object (consistent with the existing pattern):

```typescript
export const createTransactionRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  type: transactionTypeSchema,
  amount: positiveAmountSchema,
  account_id: z.string().trim().min(1),
  category_id: z.string().trim().min(1).optional(),
  destination_account_id: z.string().trim().min(1).optional(),
  payee: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(1000).optional(),
  date: z.iso.date().optional(),
}).superRefine((data, ctx) => {
  if (data.type === "transfer" && !data.destination_account_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["destination_account_id"],
      message: "destination_account_id is required for transfers",
    });
  }
});
```

The `defaultHook` in `transactionsRouter` catches Zod issues and returns `VALIDATION_ERROR`/400 — no route change needed.

**⚠️ `ZodEffects` type compatibility:** `.superRefine()` changes the schema type from `ZodObject` to `ZodEffects<ZodObject>`. If `bun run check-types` fails because `@hono/zod-openapi`'s `createRoute` body schema rejects `ZodEffects`, use the service-level fallback instead: keep `destination_account_id` as optional in the schema, and in `createTransaction` throw `new ApiError(400, "VALIDATION_ERROR", "destination_account_id is required for transfers")` when `input.type === "transfer" && !input.destination_account_id`. Both approaches produce the same 400 `VALIDATION_ERROR` response — the Zod approach is preferred for consistency, but the service approach is the safe fallback.

### Balance derivation — transfer handling in `getAccountDeltas`

Current `getAccountDeltas` selects `account_id, type, amount` and ignores `transfer` rows. This story adds `destination_account_id` to the select and handles the transfer case:

```typescript
export const getAccountDeltas = async (
  db: DrizzleD1Database,
): Promise<Map<string, string>> => {
  const rows = await db
    .select({
      account_id: transactions.account_id,
      destination_account_id: transactions.destination_account_id,
      type: transactions.type,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(eq(transactions.is_deleted, 0));

  const deltas = new Map<string, string>();

  for (const row of rows) {
    const current = deltas.get(row.account_id) ?? "0";

    if (row.type === "income") {
      deltas.set(row.account_id, add(current, row.amount));
    } else if (row.type === "expense") {
      deltas.set(row.account_id, subtract(current, row.amount));
    } else if (row.type === "transfer") {
      // Debit source
      deltas.set(row.account_id, subtract(current, row.amount));
      // Credit destination
      if (row.destination_account_id) {
        const destCurrent = deltas.get(row.destination_account_id) ?? "0";
        deltas.set(row.destination_account_id, add(destCurrent, row.amount));
      }
    }
  }

  return deltas;
};
```

**Net-worth invariant:** A transfer moves money between accounts but does not change total net worth. If source is an asset and destination is an asset: `total_assets` is unchanged (one goes down, one goes up by the same amount). The `listAccounts` summary in `account.service.ts` computes `total_assets` and `total_liabilities` by summing `current_balance` per account type — the net-zero property holds automatically.

### Foreign keys and test seeding

From Story 3.1 Dev Notes (verified): FK enforcement is ON in the test environment. Transfer tests must:
- Seed TWO accounts with `created_by/updated_by = userId` (from `login()`).
- Both accounts must have `is_active: 1`.
- `beforeEach` must clear `transactions` FIRST, then `accounts`, `categories`, `users`, `settings`.
- All `transactionFactory` overrides must use real seeded `account_id`/`category_id`/`created_by`/`updated_by`.

### Deferred items from Story 3.1 that this story resolves

- **`destination_account_id` accepted but hardcoded `null`** — this story wires it up for transfers.
- **`NOT_IMPLEMENTED` 501 guard** — removed in this story.
- **`db.batch()` atomicity unverified** — verified and documented in this story.

### Anti-patterns to avoid

- ❌ Storing transfers as two rows (debit + credit) — the data model is a single row with `destination_account_id`. Balance effect is derived at read time.
- ❌ Using SQL `SUM(amount)` or `parseFloat`/`Number`/`+` on amounts — use `lib/decimal.ts` `add`/`subtract`.
- ❌ Throwing `CATEGORY_REQUIRED` for transfers — `category_id` is null for transfers.
- ❌ Forgetting to add `destination_account_id` to the `getAccountDeltas` select — the column is needed for the credit side of the balance.
- ❌ Implementing `PUT`/`DELETE`/trash/restore/list — Stories 3.3/3.4.
- ❌ Relying on Drizzle `.returning()` on D1 — insert then select back (established pattern from Stories 2.1–3.1).
- ❌ Importing `services/` or `routes/` from `src/lib/` — eslint import restriction.

### References

- [Source: epics.md#Story-3.2] — user story, all acceptance criteria.
- [Source: architecture.md#Critical-Risk-db.batch()-Atomicity] — atomicity verification requirement.
- [Source: architecture.md#Data-Architecture] — single-row transfer model, TypeScript aggregation, no SQL SUM.
- [Source: architecture.md#Implementation-Patterns-and-Consistency-Rules] — naming, thin routes, service-layer rules, error codes.
- [Source: prd.md#NFR-DATA-01] — atomic transfers requirement.
- [Source: prd.md#FR-TXN-03] — transfer functional requirement.
- [Source: 3-1-expense-income-transactions.md] — existing service/route/schema patterns, FK enforcement, `.returning()` caveat, `ApiError` usage, `getAccountDeltas` seam.
- [Source: apps/api/src/services/transaction.service.ts] — current service to modify.
- [Source: apps/api/src/schemas/transaction.schema.ts] — current schema to modify.
- [Source: apps/api/tests/integration/transactions.test.ts] — test structure to extend.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4.6

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **db.batch() atomicity verified:** IS atomic in D1/Miniflare — rolled back stmt1 on stmt2 failure. Using `db.batch([insertStmt])` for future-proofing.
- **Implementation strategy:** Single-row transfer model with balance derivation at read time. No double-entry rows needed.
- **Schema approach:** Used `.superRefine()` successfully — no `ZodEffects` type compatibility issue with `@hono/zod-openapi`.
- **All ACs satisfied:** Transfer creation, balance derivation, atomicity verification, same-account guard, missing destination, inactive destination, idempotency, category_id optional, NOT_IMPLEMENTED removed.
- **Test results:** 103 tests pass across 14 files. 8 new transfer tests + 1 atomicity regression guard added.

### File List

- `apps/api/src/schemas/transaction.schema.ts` — added `.superRefine()` for `destination_account_id` required on transfers
- `apps/api/src/services/transaction.service.ts` — removed NOT_IMPLEMENTED guard, added transfer validation, updated `getAccountDeltas` for transfers
- `apps/api/tests/integration/transactions.test.ts` — deleted 501 test, added 8 transfer integration tests
- `apps/api/tests/integration/batch-atomicity.test.ts` — new permanent regression guard for `db.batch()` atomicity
- `_bmad-output/implementation-artifacts/deferred-work.md` — documented `db.batch()` atomicity finding
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated to review

### Change Log

- 2026-05-30: Implemented Story 3.2 — Transfer Between Accounts. Added transfer support to POST /api/v1/transactions, updated balance derivation, verified db.batch() atomicity, added comprehensive integration tests.
