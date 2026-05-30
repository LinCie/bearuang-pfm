# Story 3.4: Transaction Listing, Pagination & Search

Status: review

## Story

As the app owner,
I want to browse my transactions with pagination and filter/search them,
so that I can find specific transactions quickly even with months of history.

## Acceptance Criteria (BDD)

1. **Given** a valid session **When** `GET /api/v1/transactions` is called without parameters **Then** the first page of non-deleted transactions is returned (max 50 items), sorted by date descending (newest first), with response format `{ "items": [...], "next_cursor": "...", "has_more": true/false }`

2. **Given** a response with `has_more: true` and a `next_cursor` value **When** `GET /api/v1/transactions?cursor={next_cursor}` is called **Then** the next page of results is returned starting after the cursor position. Cursor is an opaque base64-encoded string representing a (date, id) composite key. Page size defaults to 50, configurable via `?page_size=25` (max 50).

3. **Given** a valid session **When** `GET /api/v1/transactions?start_date=2026-05-01&end_date=2026-05-31` is called **Then** only transactions within the date range (inclusive) are returned.

4. **Given** a valid session **When** `GET /api/v1/transactions?account_id={id}` is called **Then** only transactions for that account are returned (including transfers where it's source OR destination).

5. **Given** a valid session **When** `GET /api/v1/transactions?category_id={id}` is called **Then** only transactions with that category are returned.

6. **Given** a valid session **When** `GET /api/v1/transactions?min_amount=100000&max_amount=500000` is called **Then** only transactions with amount within the range (inclusive) are returned.

7. **Given** a valid session **When** `GET /api/v1/transactions?q=warung` is called **Then** transactions matching "warung" in payee, notes, or category name are returned (case-insensitive).

8. **Given** multiple filters applied simultaneously **When** `GET /api/v1/transactions?account_id={id}&start_date=2026-05-01&q=food` is called **Then** all filters are applied with AND logic.

9. **Given** a valid session **When** `GET /api/v1/transactions` is called **Then** soft-deleted transactions are excluded (only `GET /api/v1/transactions/trash` returns them).

## Tasks / Subtasks

- [x] Task 1: Create cursor utility in `src/lib/cursor.ts` (AC: #2)
  - [x] `encodeCursor(date: string, id: string): string` — base64 encode `${date}\n${id}`
  - [x] `decodeCursor(cursor: string): { date: string; id: string }` — decode and validate
  - [x] Unit tests in `tests/unit/lib/cursor.test.ts`
- [x] Task 2: Add pagination and filter schemas (AC: #1-8)
  - [x] Add `paginatedResponseSchema` to `src/schemas/common.schema.ts`
  - [x] Add `listTransactionsQuerySchema` to `src/schemas/transaction.schema.ts`
- [x] Task 3: Implement `listTransactions` service function (AC: #1-9)
  - [x] Build dynamic WHERE clause from filters with AND logic
  - [x] Handle account_id filter with OR (source OR destination)
  - [x] Handle text search `q` with LIKE on payee, notes, category name (JOIN categories)
  - [x] Handle amount range with CAST to REAL for SQLite comparison
  - [x] Implement cursor-based pagination with (date, id) composite ordering
  - [x] Always filter `is_deleted = 0`
  - [x] Return `{ items, next_cursor, has_more }`
- [x] Task 4: Add route definition and handler (AC: #1-9)
  - [x] `listTransactionsRoute` with query params schema
  - [x] Register BEFORE `listTrashRoute` (literal `/transactions` before `/transactions/trash`)
  - [x] Thin handler: validate → call service → respond
- [x] Task 5: Integration tests (AC: #1-9)
  - [x] Add "list transactions" describe block in `tests/integration/transactions.test.ts`
  - [x] Test default listing (sorted, paginated, excludes deleted)
  - [x] Test cursor pagination (multi-page traversal)
  - [x] Test each filter individually
  - [x] Test combined filters (AND logic)
  - [x] Test text search across payee, notes, category name
  - [x] Test amount range filtering
  - [x] Test account_id includes transfers (source OR destination)

## Dev Notes

### Cursor Implementation

The cursor encodes `(date, id)` as a composite key for stable ordering:
- Sort order: `date DESC, id DESC` (newest first, tie-break by id)
- Cursor condition: `WHERE (date < cursor_date) OR (date = cursor_date AND id < cursor_id)`
- This ensures stable pagination even when transactions share the same date
- Encode: `btoa(date + '\n' + id)` — Decode: `atob(cursor).split('\n')`
- Use standard `btoa`/`atob` (available in Workers runtime)
- Invalid cursor (bad base64, wrong format after decode) → `ApiError(400, "INVALID_CURSOR", "Invalid pagination cursor")`

### Pagination Strategy (`has_more` detection)

Fetch `page_size + 1` rows from DB. Then:
- If returned rows > `page_size` → `has_more: true`, return only first `page_size` rows, encode cursor from last returned item
- If returned rows ≤ `page_size` → `has_more: false`, `next_cursor: null`

This avoids a separate COUNT query. Empty result set returns:
```json
{ "items": [], "next_cursor": null, "has_more": false }
```

### Amount Range Filtering

Amounts are stored as TEXT (string decimal). For range comparison in SQLite:
- Use `CAST(amount AS REAL)` in the WHERE clause for numeric comparison
- This is acceptable because amounts are always valid decimal strings (enforced by schema validation on write)

In Drizzle, use `gte`/`lte` with a `sql` column expression:
```typescript
import { gte, lte, sql } from "drizzle-orm";

const amountExpr = sql<number>`CAST(${transactions.amount} AS REAL)`;
// Then in WHERE conditions:
gte(amountExpr, Number(params.min_amount))
lte(amountExpr, Number(params.max_amount))
```

`Number()` is safe here because the Zod schema already validated the string matches `/^\d+(\.\d+)?$/` — this is ONLY for SQL parameter binding, not for application-level math.

### Text Search (q parameter)

- Case-insensitive search on: `payee`, `notes`, and `categories.name`
- Requires LEFT JOIN on categories table for category name search
- Use `OR` to combine the three search conditions
- SQLite LIKE is only case-insensitive for ASCII A-Z. Use `LOWER()` wrapping for consistent behavior:

```typescript
const pattern = `%${q.toLowerCase()}%`;
or(
  sql`LOWER(${transactions.payee}) LIKE ${pattern}`,
  sql`LOWER(${transactions.notes}) LIKE ${pattern}`,
  sql`LOWER(${categories.name}) LIKE ${pattern}`
)
```

### Account Filter (account_id)

Must include transfers where the account is source OR destination:
```typescript
or(
  eq(transactions.account_id, accountId),
  eq(transactions.destination_account_id, accountId)
)
```

### Service Function Signature

```typescript
interface ListTransactionsParams {
  cursor?: string;
  page_size?: number;
  start_date?: string;
  end_date?: string;
  account_id?: string;
  category_id?: string;
  min_amount?: string;
  max_amount?: string;
  q?: string;
}

interface ListTransactionsResult {
  items: Transaction[];
  next_cursor: string | null;
  has_more: boolean;
}

export const listTransactions = async (
  db: DrizzleD1Database,
  params: ListTransactionsParams,
): Promise<ListTransactionsResult>
```

### Route Registration Order

The new `GET /api/v1/transactions` (list) route uses the same path as `POST /api/v1/transactions` (create) but different HTTP method — no conflict. However, ensure the listing route is registered in a logical position. The existing auth middleware `transactionsRouter.use("/api/v1/transactions", authMiddleware)` already covers this path.

### Query Param Schema

```typescript
// In transaction.schema.ts
export const listTransactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional().default(50),
  start_date: z.string().date().optional(),
  end_date: z.string().date().optional(),
  account_id: z.string().min(1).optional(),
  category_id: z.string().min(1).optional(),
  min_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  max_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  q: z.string().min(1).max(100).optional(),
});
```

### Response Schema

```typescript
// In common.schema.ts
export const paginatedTransactionResponseSchema = z.object({
  items: z.array(transactionSchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/cursor.ts` | Cursor encode/decode utility |
| `tests/unit/lib/cursor.test.ts` | Unit tests for cursor |

### Files to Modify

| File | Changes |
|------|---------|
| `src/schemas/common.schema.ts` | Add paginated response schema |
| `src/schemas/transaction.schema.ts` | Add `listTransactionsQuerySchema`, export `transactionSchema` array wrapper |
| `src/services/transaction.service.ts` | Add `listTransactions` function; add imports: `or`, `gte`, `lte`, `desc` from drizzle-orm |
| `src/routes/transactions.ts` | Add `listTransactionsRoute` definition and handler; import new schemas and service |
| `tests/integration/transactions.test.ts` | Add "list transactions" describe block with pagination/filter/search tests |

### Anti-Patterns to Avoid

- ❌ Do NOT use `SELECT *` — select only needed columns for listing (skip `created_by`, `updated_by` if not needed in list view... actually the `transactionSchema` includes all fields, so select all columns that map to it)
- ❌ Do NOT use `parseFloat`/`Number` on amounts in application code — use CAST in SQL for filtering
- ❌ Do NOT add a new migration — no schema changes needed
- ❌ Do NOT paginate the trash endpoint — that's deferred
- ❌ Do NOT use raw SQL strings for the main query — use Drizzle query builder with `sql` template only for CAST expressions
- ❌ Do NOT import from `services/` or `routes/` in `src/lib/cursor.ts`
- ❌ Do NOT add type filter (expense/income/transfer) — not in acceptance criteria

### Existing Patterns to Follow

- `toTransaction(row)` helper in `transaction.service.ts` maps DB rows to API shape — reuse it
- `ApiError` for business errors (e.g., invalid cursor → 400)
- Route handlers are thin: validate → call service → respond
- Services receive `db: DrizzleD1Database` as first param
- Test pattern: `login()` → `seedAccountAndCategories()` → create transactions via POST → test listing

### Database Indexes Available

- `idx_transactions_account_date` on `(account_id, date)` — helps account_id + date range queries
- `idx_transactions_is_deleted` on `(is_deleted)` — helps the base `WHERE is_deleted = 0` filter

### Project Structure Notes

- All paths relative to `apps/api/`
- New file `src/lib/cursor.ts` follows existing lib pattern (pure utility, no service/route imports)
- Unit test at `tests/unit/lib/cursor.test.ts` follows architecture spec for cursor encode/decode testing

### References

- [Source: epics.md#Story-3.4] — Complete acceptance criteria and BDD scenarios
- [Source: architecture.md#API-Patterns] — Cursor-based pagination response format
- [Source: architecture.md#Performance-Requirements] — NFR-PERF-04 max 50 items per page
- [Source: architecture.md#Data-Architecture] — Amount as TEXT string decimal
- [Source: architecture.md#Testing-Standards] — Unit test for cursor, integration for routes
- [Source: prd.md] — FR-TXN-08 (listing), FR-TXN-09 (search/filter)
- [Source: story-3-3] — Route registration order, D1 limitations, toTransaction helper, test patterns

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-20250514

### Completion Notes List

- Story context engine analysis completed — comprehensive developer guide created
- All operators verified available in drizzle-orm@0.36.4: or, gte, lte, like, desc, asc, and, eq, lt, sql
- No new migration needed — transactions table already has all required columns and indexes
- Previous stories (3-1, 3-2, 3-3) explicitly deferred listing/pagination/search to this story
- Implementation complete: cursor utility, schemas, service, route, and integration tests all passing
- 135 total tests pass (15 new tests added: 5 cursor unit + 10 integration)
- Cursor-based pagination uses (date DESC, id DESC) composite ordering with pageSize+1 strategy
- Text search uses LEFT JOIN on categories with LOWER() wrapping for case-insensitive matching
- Amount range filtering uses CAST(amount AS REAL) in SQL for numeric comparison

### File List

- CREATE: `apps/api/src/lib/cursor.ts`
- CREATE: `apps/api/tests/unit/lib/cursor.test.ts`
- UPDATE: `apps/api/src/schemas/common.schema.ts`
- UPDATE: `apps/api/src/schemas/transaction.schema.ts`
- UPDATE: `apps/api/src/services/transaction.service.ts`
- UPDATE: `apps/api/src/routes/transactions.ts`
- UPDATE: `apps/api/tests/integration/transactions.test.ts`

### Change Log

- 2026-05-30: Implemented transaction listing with cursor-based pagination, date/account/category/amount filters, and text search (q param). All 9 acceptance criteria satisfied.
