# Story 4.2: Occurrence Generation, Confirm & Skip

Status: review

## Story

As the app owner,
I want to see upcoming recurring payments and confirm or skip each one,
so that I maintain control over what actually gets posted as a transaction.

## Acceptance Criteria (BDD)

1. **Given** a valid session and an active recurring template with frequency "monthly" and start_date "2026-06-01" **When** `GET /api/v1/recurring/:id/upcoming` is called **Then** the next N occurrences are computed based on the template's frequency and start_date (default N=12, configurable via `?limit=N`, max 52) **And** occurrences that already exist in `recurring_occurrences` (posted or skipped) are included with their status **And** future occurrences not yet in the database are returned as "pending" with computed due_dates **And** occurrences past the end_date (if set) are not generated

2. **Given** a valid session **When** `GET /api/v1/recurring` is called with `?upcoming_days=30` **Then** a consolidated list of all expected recurring payments within the next 30 days is returned **And** each entry shows template info (payee, amount, frequency), due_date, account_id, and status

3. **Given** a valid session and a pending occurrence **When** `POST /api/v1/recurring/:id/occurrences/:occId/confirm` is called **Then** an actual transaction is created in the `transactions` table with the template's type, amount, account_id, category_id, payee, notes, and the occurrence's due_date as the transaction date **And** the occurrence status is updated to "posted" **And** the occurrence's transaction_id is set to the newly created transaction's ID **And** the account balance reflects the new transaction **And** the response returns the created transaction

4. **Given** a valid session and a pending occurrence **When** `POST /api/v1/recurring/:id/occurrences/:occId/skip` is called **Then** the occurrence status is updated to "skipped" **And** no transaction is created **And** the template remains active for future occurrences **And** the response is 200 with the updated occurrence

5. **Given** an occurrence that is already posted or skipped **When** confirm or skip is called again **Then** the response is `{ error: { code: "OCCURRENCE_ALREADY_PROCESSED", message: "..." } }` with status 409

6. **Given** a template with frequency "weekly" and start_date "2026-06-01" **When** occurrences are generated **Then** due_dates are: 2026-06-01, 2026-06-08, 2026-06-15, 2026-06-22, etc.

7. **Given** a template with frequency "monthly" and start_date "2026-01-31" **When** occurrences are generated for February **Then** the due_date is adjusted to the last day of the month (2026-02-28)

8. **Given** a non-existent template ID or occurrence ID **When** any occurrence endpoint is called **Then** the response is 404 with appropriate error code

9. **Given** a template with frequency "biweekly" and start_date "2026-06-01" **When** occurrences are generated **Then** due_dates are 14 days apart: 2026-06-01, 2026-06-15, 2026-06-29, etc.

10. **Given** a template with frequency "yearly" and start_date "2024-02-29" **When** occurrences are generated for 2025 (non-leap year) **Then** the due_date is adjusted to 2025-02-28

## Tasks / Subtasks

- [x] Task 1: Add Zod schemas for occurrence endpoints (AC: #1-5, #8)
  - [x] Add `upcomingQuerySchema` with `limit` param (coerce number, min 1, max 52, default 12)
  - [x] Add `upcomingDaysQuerySchema` with `upcoming_days` param (coerce number, min 1, max 365, optional)
  - [x] Add `occurrenceParamsSchema` with `id` and `occId` params
  - [x] Add `occurrenceResponseSchema` for occurrence objects
  - [x] Add `upcomingResponseSchema` for the list response
- [x] Task 2: Add occurrence service functions (AC: #1-7)
  - [x] `getUpcomingOccurrences(db, templateId, limit)` — compute + merge with existing DB records
  - [x] `getUpcomingAcrossTemplates(db, days)` — consolidated upcoming across all active templates
  - [x] `confirmOccurrence(db, templateId, occurrenceId, userId)` — create transaction + update occurrence
  - [x] `skipOccurrence(db, templateId, occurrenceId, userId)` — update occurrence status to skipped
- [x] Task 3: Add occurrence routes to `recurring.ts` (AC: #1-5, #8)
  - [x] `GET /api/v1/recurring/:id/upcoming` — list upcoming occurrences for a template
  - [x] `GET /api/v1/recurring` — extend existing list route to support `?upcoming_days=N`
  - [x] `POST /api/v1/recurring/:id/occurrences/:occId/confirm` — confirm and post
  - [x] `POST /api/v1/recurring/:id/occurrences/:occId/skip` — skip occurrence
  - [x] Add auth middleware for new sub-paths
- [x] Task 4: Integration tests (AC: #1-10)
  - [x] Test upcoming generation with various frequencies (daily, weekly, biweekly, monthly, yearly)
  - [x] Test confirm creates transaction with correct fields
  - [x] Test confirm updates account balance (verify via account balance endpoint)
  - [x] Test skip updates status without creating transaction
  - [x] Test 409 for already-processed occurrences
  - [x] Test `?upcoming_days=N` consolidated list
  - [x] Test month-end clamping (Jan 31 → Feb 28)
  - [x] Test biweekly 14-day intervals
  - [x] Test yearly with leap year (Feb 29 → Feb 28 in non-leap year)
  - [x] Test end_date boundary (no occurrences past end_date)
  - [x] Test 404 for non-existent template/occurrence

## Dev Notes

### Key Design Decision: On-Demand Occurrence Generation

Occurrences are NOT pre-generated in the database. The `GET /api/v1/recurring/:id/upcoming` endpoint:
1. Computes future due_dates from the template's `start_date` + `frequency`
2. Queries existing `recurring_occurrences` rows for this template
3. Merges: existing DB rows (posted/skipped) retain their status; computed future dates not in DB are returned as "pending"
4. Only when user calls **confirm** or **skip** does a row get inserted/updated in `recurring_occurrences`

This means "pending" occurrences may not have a DB row yet. The `occId` for pending occurrences is generated deterministically or on-the-fly — see implementation approach below.

### Occurrence ID Strategy

For pending occurrences that don't exist in DB yet, the `GET /upcoming` endpoint must return an `id` that the client can use for confirm/skip. Two approaches:

**Chosen approach: Lazy-create on confirm/skip.** The `GET /upcoming` response returns a **deterministic virtual ID** for pending occurrences: use the due_date itself as the identifier for unconfirmed occurrences (since due_date is unique per template). The confirm/skip endpoints accept either a real UUID (for existing DB rows) or a due_date string as `occId`. When confirm/skip is called with a due_date:
1. Check if a `recurring_occurrences` row exists for this template + due_date
2. If not, create one with status pending, then immediately update to posted/skipped
3. If yes and status is pending, update to posted/skipped
4. If yes and status is posted/skipped, return 409

**Response shape for upcoming:**
```json
{
  "items": [
    {
      "id": "2026-06-01",
      "template_id": "uuid",
      "due_date": "2026-06-01",
      "status": "pending",
      "transaction_id": null
    },
    {
      "id": "real-uuid",
      "template_id": "uuid",
      "due_date": "2026-05-01",
      "status": "posted",
      "transaction_id": "txn-uuid"
    }
  ]
}
```

For pending items: `id` = due_date string (e.g., "2026-06-01").
For existing DB rows: `id` = actual UUID from `recurring_occurrences.id`.

### Service Function Signatures

```typescript
interface OccurrenceItem {
  id: string;           // UUID for DB rows, due_date for virtual pending
  template_id: string;
  due_date: string;
  status: "pending" | "posted" | "skipped";
  transaction_id: string | null;
}

interface UpcomingWithTemplate extends OccurrenceItem {
  template_payee: string | null;
  template_amount: string;
  template_type: "expense" | "income";
  template_frequency: string;
  account_id: string;
}

export const getUpcomingOccurrences = async (
  db: DrizzleD1Database,
  templateId: string,
  limit: number,
): Promise<{ items: OccurrenceItem[] }>

export const getUpcomingAcrossTemplates = async (
  db: DrizzleD1Database,
  days: number,
): Promise<{ items: UpcomingWithTemplate[] }>

export const confirmOccurrence = async (
  db: DrizzleD1Database,
  templateId: string,
  occId: string,
  userId: string,
): Promise<{ occurrence: OccurrenceItem; transaction: Transaction }>

export const skipOccurrence = async (
  db: DrizzleD1Database,
  templateId: string,
  occId: string,
  userId: string,
): Promise<OccurrenceItem>
```

### Confirm Occurrence Logic (Critical)

```
1. Validate template exists and is active → 404 if not
2. Resolve occurrence:
   a. If occId is a UUID format → look up in recurring_occurrences by id
   b. If occId is a date format (YYYY-MM-DD) → look up by template_id + due_date
   c. If no DB row found for date → create one with status "pending"
3. Check occurrence.status === "pending" → 409 if already posted/skipped
4. Create transaction via createTransaction() from transaction.service.ts:
   - type: template.type
   - amount: template.amount
   - account_id: template.account_id
   - category_id: template.category_id
   - payee: template.payee
   - notes: template.notes
   - date: occurrence.due_date
5. Update occurrence: status = "posted", transaction_id = new transaction ID
6. Return { occurrence, transaction }
```

### Reuse `createTransaction` from transaction.service.ts

The confirm action MUST reuse the existing `createTransaction` function. This ensures:
- FK validation (account exists + active, category exists + type matches)
- `category.usage_count` increment
- Consistent transaction shape and timestamps
- Idempotency handling (pass no client ID — server generates UUID)

Import: `import { createTransaction } from "./transaction.service";`

Note: `CreateTransactionInput` interface is NOT exported from `transaction.service.ts`. Construct the input object inline — do not try to import the type.

Call pattern:
```typescript
const { transaction } = await createTransaction(db, {
  type: template.type as "expense" | "income",
  amount: template.amount,
  account_id: template.account_id,
  category_id: template.category_id,
  payee: template.payee ?? undefined,
  notes: template.notes ?? undefined,
  date: occurrence.due_date,
}, userId);
```

### Extending the List Endpoint

The existing `GET /api/v1/recurring` endpoint (in `recurring.ts`) needs to support an optional `?upcoming_days=N` query param. When present:
- Query all active templates
- For each, compute occurrences within the next N days
- Return a flat list sorted by due_date

**Implementation:** Add a new route definition (separate from the existing `listRecurringRoute`) or branch in the handler based on query param presence. Recommended: add a separate route definition `listUpcomingRoute` at the same path with the query schema, and handle the branching in the handler.

Actually, simpler approach: modify the existing `listRecurringRoute` to accept optional query params. If `upcoming_days` is present, call `getUpcomingAcrossTemplates`. Otherwise, call existing `listTemplates`.

### Route Definitions to Add

```typescript
// New routes to add to recurring.ts:

// GET /api/v1/recurring/:id/upcoming?limit=12
const upcomingRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring/{id}/upcoming",
  security: [{ Bearer: [] }],
  request: {
    params: recurringIdParamsSchema,
    query: upcomingQuerySchema,
  },
  responses: {
    200: { description: "Upcoming occurrences", content: { "application/json": { schema: upcomingResponseSchema } } },
    401: { ... },
    404: { ... },
  },
});

// POST /api/v1/recurring/:id/occurrences/:occId/confirm
const confirmOccurrenceRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring/{id}/occurrences/{occId}/confirm",
  security: [{ Bearer: [] }],
  request: { params: occurrenceParamsSchema },
  responses: {
    200: { description: "Occurrence confirmed", content: { "application/json": { schema: confirmResponseSchema } } },
    401: { ... },
    404: { ... },
    409: { description: "Already processed", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

// POST /api/v1/recurring/:id/occurrences/:occId/skip
const skipOccurrenceRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring/{id}/occurrences/{occId}/skip",
  security: [{ Bearer: [] }],
  request: { params: occurrenceParamsSchema },
  responses: {
    200: { description: "Occurrence skipped", content: { "application/json": { schema: occurrenceResponseSchema } } },
    401: { ... },
    404: { ... },
    409: { description: "Already processed", content: { "application/json": { schema: errorResponseSchema } } },
  },
});
```

### Auth Middleware for New Paths

**CRITICAL:** The existing `.use("/api/v1/recurring/:id", authMiddleware)` does NOT cascade to deeper nested paths in Hono. You MUST add explicit middleware for each new sub-path:
```typescript
recurringRouter.use("/api/v1/recurring/:id/upcoming", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id/occurrences/:occId/confirm", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id/occurrences/:occId/skip", authMiddleware);
```

### Date Generation Logic (Reuse from Story 4-1)

The `computeNextDueDate` and `advanceDate` functions already exist in `recurring.service.ts`. **CRITICAL: `advanceDate` is currently NOT exported** — you must add `export` to it before reusing. For this story, extract a more general `generateOccurrenceDates` helper:

```typescript
export const generateOccurrenceDates = (
  startDate: string,
  frequency: string,
  endDate: string | null,
  limit: number,
): string[] => {
  const dates: string[] = [];
  let current = startDate;
  for (let i = 0; i < limit && dates.length < limit; i++) {
    if (endDate && current > endDate) break;
    dates.push(current);
    current = advanceDate(current, frequency);
  }
  return dates;
};
```

The existing `advanceDate` function handles month-end clamping (Jan 31 → Feb 28) and leap year logic correctly — reuse it directly.

### `upcoming_days` Filter Logic

For `GET /api/v1/recurring?upcoming_days=30`:
```
1. Compute cutoff_date = today + N days (ISO date string)
2. For each active template, generate dates from start_date
3. Filter: only include dates where today <= due_date <= cutoff_date
4. Merge with existing DB occurrences for those dates
5. Return flat list sorted by due_date ascending
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/services/recurring.service.ts` | Export `advanceDate`; add `generateOccurrenceDates`, `getUpcomingOccurrences`, `getUpcomingAcrossTemplates`, `confirmOccurrence`, `skipOccurrence` |
| `src/schemas/recurring.schema.ts` | Add `upcomingQuerySchema`, `occurrenceParamsSchema`, `occurrenceResponseSchema`, `upcomingResponseSchema`, `confirmResponseSchema` |
| `src/routes/recurring.ts` | Add 3 new route definitions + handlers + auth middleware for sub-paths; modify list handler for `upcoming_days` |
| `tests/integration/recurring.test.ts` | Add test cases for upcoming, confirm, skip, 409, upcoming_days, frequency edge cases |

### Schema Note: `recurring_occurrences` Has No `updated_at`

The `recurring_occurrences` table only has `created_at`. There is no `updated_at` column to track when status changed. This is acceptable — `created_at` is set when the row is lazy-created (on confirm/skip), which IS the moment the status is set. No migration needed.

### Files NOT to Create

No new files needed. All changes go into existing recurring module files. No new migration needed — `recurring_occurrences` table already exists from story 4-1.

### Anti-Patterns to Avoid

- ❌ Do NOT pre-generate all occurrences in the database on template creation
- ❌ Do NOT create a separate route file — extend existing `recurring.ts`
- ❌ Do NOT duplicate transaction creation logic — reuse `createTransaction` from `transaction.service.ts`
- ❌ Do NOT use `db.batch()` for confirm (transaction creation + occurrence update) — D1 batch is not truly atomic; sequential writes are acceptable at 1-2 user scale
- ❌ Do NOT return occurrences past `end_date`
- ❌ Do NOT allow confirming/skipping an already-processed occurrence
- ❌ Do NOT create a new migration — the `recurring_occurrences` table already exists
- ❌ Do NOT modify the `recurring_templates` table schema
- ❌ Do NOT use floating-point for amounts — string decimal only (handled by reusing `createTransaction`)

### Existing Patterns to Follow

- `ApiError` class for domain errors (from `src/lib/api-error.ts`)
- `drizzle(c.env.DB)` in route handlers
- `c.get("userId")` for authenticated user ID
- `crypto.randomUUID()` for new occurrence IDs
- `new Date().toISOString()` for `created_at` timestamps
- Route param style: `{id}` in OpenAPI path, `:id` in middleware `.use()`
- Response: `{ items: [...] }` for lists
- Error: `{ error: { code, message } }` shape
- 409 status for conflict/already-processed states

### Testing Patterns

- Use `SELF.fetch()` for integration tests
- Login helper to get session token
- Seed: create account → category → recurring template before testing occurrences
- Test flow: create template → get upcoming → confirm first → verify transaction created → verify account balance changed → get upcoming again (confirmed one shows "posted")
- Test skip flow: create template → get upcoming → skip one → verify no transaction → verify account balance unchanged → get upcoming (skipped one shows "skipped")
- Test 409: confirm → confirm again → expect 409
- Test date math: template with start_date "2026-01-31", frequency "monthly" → verify Feb occurrence is "2026-02-28"
- Test biweekly: start_date "2026-06-01" → verify 14-day intervals
- Test yearly leap: start_date "2024-02-29" → verify 2025 occurrence is "2025-02-28"

### References

- [Source: epics.md#Epic-4-Story-4.2] — Complete acceptance criteria
- [Source: architecture.md#Implementation-Patterns] — Service layer rules, route patterns
- [Source: architecture.md#Data-Architecture] — recurring_occurrences table schema
- [Source: story-4-1] — Previous story with recurring service, schema, route patterns, computeNextDueDate logic
- [Source: transaction.service.ts] — createTransaction function to reuse for confirm
- [Source: prd.md] — FR-REC-02 (generate occurrences), FR-REC-03 (confirm), FR-REC-04 (skip)

## Dev Agent Record

### Agent Model Used

Kiro CLI (Auto)

### Completion Notes List

- Implemented on-demand occurrence generation using existing `advanceDate` function (exported it for reuse)
- Created `resolveOccurrence` helper to handle both UUID and date-based occurrence IDs with lazy-create pattern
- Confirm reuses `createTransaction` from transaction.service.ts ensuring FK validation, category usage_count increment, and consistent transaction shape
- Skip marks occurrence as "skipped" without creating any transaction
- `upcoming_days` support added to existing list route via URL param branching
- All 39 recurring tests pass (20 new tests for occurrence endpoints)
- Full suite: 175 tests across 16 files, zero regressions
- Type check and lint pass cleanly

### File List

- apps/api/src/schemas/recurring.schema.ts (modified — added occurrence schemas)
- apps/api/src/services/recurring.service.ts (modified — exported advanceDate, added generateOccurrenceDates, resolveOccurrence, getUpcomingOccurrences, getUpcomingAcrossTemplates, confirmOccurrence, skipOccurrence)
- apps/api/src/routes/recurring.ts (modified — added upcoming, confirm, skip routes + auth middleware)
- apps/api/tests/integration/recurring.test.ts (modified — added 20 integration tests for occurrence endpoints)

### Change Log

- 2026-05-30: Implemented Story 4.2 — Occurrence Generation, Confirm & Skip. Added on-demand occurrence computation, confirm (creates transaction + updates balance), skip (no transaction), 409 conflict handling, and upcoming_days consolidated list.
