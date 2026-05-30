# Story 4.1: Recurring Transaction Templates

Status: review

## Story

As the app owner,
I want to define recurring payment templates with a frequency schedule,
so that I don't have to manually re-enter the same bills and subscriptions every period.

## Acceptance Criteria (BDD)

1. **Given** the database has no recurring tables **When** the migration for this story is applied **Then** the `recurring_templates` table exists with columns: id (TEXT UUID PK), type (TEXT: 'expense' | 'income'), amount (TEXT string decimal), account_id (TEXT FK accounts.id), category_id (TEXT FK categories.id), payee (TEXT nullable), notes (TEXT nullable), frequency (TEXT: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'), start_date (TEXT ISO 8601 date), end_date (TEXT nullable), is_active (INTEGER 1/0 default 1), created_by (TEXT FK users.id), updated_by (TEXT FK users.id), created_at (TEXT ISO 8601), updated_at (TEXT ISO 8601) **And** the `recurring_occurrences` table exists with columns: id (TEXT UUID PK), template_id (TEXT FK recurring_templates.id), due_date (TEXT ISO 8601 date), status (TEXT: 'pending' | 'posted' | 'skipped'), transaction_id (TEXT nullable FK transactions.id), created_at (TEXT ISO 8601)

2. **Given** a valid session and existing account and category **When** `POST /api/v1/recurring` is called with `{ "type": "expense", "amount": "150000.00", "account_id": "...", "category_id": "...", "frequency": "monthly", "start_date": "2026-06-01", "payee": "Internet Provider", "notes": "Home internet" }` **Then** a recurring template is created and returned with all fields **And** created_by is set to the authenticated user's ID

3. **Given** a valid session **When** `GET /api/v1/recurring` is called **Then** all active recurring templates are returned as `{ "items": [...] }` **And** each template includes its frequency, next_due_date (earliest future date computed from frequency and start_date, excluding posted/skipped occurrences), and account/category names

4. **Given** a valid session and an existing template **When** `GET /api/v1/recurring/:id` is called **Then** the full template details are returned

5. **Given** a valid session and an existing template **When** `PUT /api/v1/recurring/:id` is called with updated fields (amount, category_id, frequency, end_date, payee, notes) **Then** the template is updated and changes apply to future occurrences only **And** existing posted/skipped occurrences are not affected **And** updated_at is refreshed

6. **Given** a valid session and an existing template **When** `DELETE /api/v1/recurring/:id` is called **Then** the template is deactivated (is_active = 0) **And** no future occurrences will be generated **And** the response is 204 No Content

7. **Given** an invalid frequency value **When** `POST /api/v1/recurring` is called **Then** the response is a validation error with status 400

## Tasks / Subtasks

- [x] Task 1: Create Drizzle schema for recurring tables (AC: #1)
  - [x] Create `src/db/schema/recurring.ts` with `recurring_templates` and `recurring_occurrences` tables
  - [x] Add indexes: `idx_recurring_templates_is_active`, `idx_recurring_occurrences_template_id`
  - [x] Export from `src/db/schema/index.ts`
  - [x] Run `bun run db:generate` and review migration SQL
  - [x] Apply migration locally: `bun run db:migrate:local`
- [x] Task 2: Create Zod schemas (AC: #2, #3, #5, #7)
  - [x] Create `src/schemas/recurring.schema.ts` with: `createRecurringRequestSchema`, `updateRecurringRequestSchema`, `recurringTemplateSchema` (response), `recurringIdParamsSchema`
  - [x] Frequency enum: `z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'yearly'])`
  - [x] Amount validated as string decimal regex `/^\d+(\.\d+)?$/`
- [x] Task 3: Implement `recurring.service.ts` (AC: #2-6)
  - [x] `createTemplate(db, input, userId)` — insert template, return full object
  - [x] `listTemplates(db)` — select active templates with computed `next_due_date`
  - [x] `getTemplate(db, id)` — single template by ID or throw 404
  - [x] `updateTemplate(db, id, input, userId)` — partial update, refresh updated_at
  - [x] `deactivateTemplate(db, id, userId)` — set is_active = 0, update updated_by + updated_at
  - [x] `computeNextDueDate(template, occurrences)` — pure function for next occurrence date
- [x] Task 4: Implement `src/routes/recurring.ts` (AC: #2-7)
  - [x] Route definitions with OpenAPI schemas
  - [x] Auth middleware on all `/api/v1/recurring` paths
  - [x] Thin handlers: validate → call service → respond
- [x] Task 5: Register router in `src/index.ts` (AC: all)
  - [x] Import and mount `recurringRouter`
- [x] Task 6: Integration tests (AC: #1-7)
  - [x] Create `tests/integration/recurring.test.ts`
  - [x] Test CRUD lifecycle: create → list → get → update → delete
  - [x] Test validation: invalid frequency, missing required fields, invalid amount
  - [x] Test next_due_date computation in list response
  - [x] Test deactivation hides from listing
  - [x] Test FK validation: non-existent account_id or category_id → 404

## Dev Notes

### Schema Design

```typescript
// src/db/schema/recurring.ts
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { categories } from "./categories";
import { transactions } from "./transactions";
import { users } from "./users";

export const recurringTemplates = sqliteTable(
  "recurring_templates",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // 'expense' | 'income'
    amount: text("amount").notNull(),
    account_id: text("account_id").notNull().references(() => accounts.id),
    category_id: text("category_id").notNull().references(() => categories.id),
    payee: text("payee"),
    notes: text("notes"),
    frequency: text("frequency").notNull(), // 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
    start_date: text("start_date").notNull(),
    end_date: text("end_date"),
    is_active: integer("is_active").notNull().default(1),
    created_by: text("created_by").notNull().references(() => users.id),
    updated_by: text("updated_by").notNull().references(() => users.id),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => ({
    isActiveIndex: index("idx_recurring_templates_is_active").on(table.is_active),
  }),
);

export const recurringOccurrences = sqliteTable(
  "recurring_occurrences",
  {
    id: text("id").primaryKey(),
    template_id: text("template_id").notNull().references(() => recurringTemplates.id),
    due_date: text("due_date").notNull(),
    status: text("status").notNull(), // 'pending' | 'posted' | 'skipped'
    transaction_id: text("transaction_id").references(() => transactions.id),
    created_at: text("created_at").notNull(),
  },
  (table) => ({
    templateIdIndex: index("idx_recurring_occurrences_template_id").on(table.template_id),
  }),
);
```

### next_due_date Computation Logic

The `next_due_date` for the list response is computed in TypeScript (not stored):

1. Start from `start_date`, generate dates by frequency until you find one that is:
   - On or after today
   - Not already in `recurring_occurrences` with status 'posted' or 'skipped'
   - Not past `end_date` (if set)
2. If no future date exists (end_date passed or all generated), return `null`

**Frequency date math:**
- `daily`: +1 day
- `weekly`: +7 days
- `biweekly`: +14 days
- `monthly`: same day next month (clamp to last day if month is shorter, e.g., Jan 31 → Feb 28)
- `yearly`: same month+day next year (handle Feb 29 → Feb 28 in non-leap years)

**Implementation approach:** Use a helper function `computeNextDueDate(startDate, frequency, endDate, processedDates)` that iterates from start_date forward. For the list endpoint, query all occurrences per template with status 'posted' or 'skipped' to build the `processedDates` set.

**Performance note:** At 1-2 user scale with <50 templates, iterating dates in JS is negligible. No need for materialized next_due_date column.

### Service Function Signatures

```typescript
export const createTemplate = async (
  db: DrizzleD1Database,
  input: CreateRecurringInput,
  userId: string,
): Promise<RecurringTemplate>

export const listTemplates = async (
  db: DrizzleD1Database,
): Promise<{ items: RecurringTemplateWithNext[] }>

export const getTemplate = async (
  db: DrizzleD1Database,
  id: string,
): Promise<RecurringTemplate>

export const updateTemplate = async (
  db: DrizzleD1Database,
  id: string,
  input: UpdateRecurringInput,
  userId: string,
): Promise<RecurringTemplate>

export const deactivateTemplate = async (
  db: DrizzleD1Database,
  id: string,
  userId: string,
): Promise<void>
```

### Route Pattern (follows transactions.ts)

```typescript
// src/routes/recurring.ts
export const recurringRouter = new OpenAPIHono<{
  Bindings: Env;
  Variables: { userId: string };
}>({ defaultHook: ... });

recurringRouter.use("/api/v1/recurring", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id", authMiddleware);
```

### FK Validation

Before creating a template, validate that `account_id` and `category_id` exist:
- Non-existent account → `ApiError(404, "ACCOUNT_NOT_FOUND", "Account does not exist")`
- Non-existent category → `ApiError(404, "CATEGORY_NOT_FOUND", "Category does not exist")`
- Inactive account (is_active = 0) → `ApiError(400, "ACCOUNT_INACTIVE", "Cannot create recurring template for inactive account")`

### UUID Generation

Use `crypto.randomUUID()` (available in Workers runtime) for template and occurrence IDs. Same pattern as transaction service when no client ID is provided.

### Date Handling

- `start_date` and `end_date` are date-only strings: `"2026-06-01"` (no time component)
- `created_at` and `updated_at` are full ISO 8601: `new Date().toISOString()`
- Validate `start_date` with `z.iso.date()` in request body (matches `createTransactionRequestSchema` pattern)
- Validate `end_date` with `z.iso.date().optional()` in request body
- If `end_date` is provided, validate `end_date >= start_date`
- Amount validation: reuse the `positiveAmountSchema` pattern from `transaction.schema.ts` (regex + refine > 0)

### Response Shape

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "expense",
      "amount": "150000.00",
      "account_id": "uuid",
      "category_id": "uuid",
      "payee": "Internet Provider",
      "notes": "Home internet",
      "frequency": "monthly",
      "start_date": "2026-06-01",
      "end_date": null,
      "is_active": true,
      "next_due_date": "2026-06-01",
      "created_by": "uuid",
      "updated_by": "uuid",
      "created_at": "2026-05-30T14:00:00.000Z",
      "updated_at": "2026-05-30T14:00:00.000Z"
    }
  ]
}
```

Note: `is_active` in API response is boolean (`true`/`false`), mapped from integer in DB (same pattern as `is_deleted` in transactions).

### Project Structure Notes

- All paths relative to `apps/api/`
- New files: `src/db/schema/recurring.ts`, `src/schemas/recurring.schema.ts`, `src/services/recurring.service.ts`, `src/routes/recurring.ts`, `tests/integration/recurring.test.ts`
- Modified files: `src/db/schema/index.ts` (add export), `src/index.ts` (mount router)
- Schema file follows existing pattern: one file per domain in `src/db/schema/`
- Route file follows `transactions.ts` pattern: `OpenAPIHono` instance with `defaultHook`, auth middleware, thin handlers

### Files to Create

| File | Purpose |
|------|---------|
| `src/db/schema/recurring.ts` | Drizzle schema for recurring_templates + recurring_occurrences |
| `src/schemas/recurring.schema.ts` | Zod request/response schemas |
| `src/services/recurring.service.ts` | Business logic: CRUD + next_due_date computation |
| `src/routes/recurring.ts` | OpenAPI route definitions + handlers |
| `tests/integration/recurring.test.ts` | Integration tests for all endpoints |

### Files to Modify

| File | Changes |
|------|---------|
| `src/db/schema/index.ts` | Add `export { recurringTemplates, recurringOccurrences } from "./recurring"` |
| `src/index.ts` | Import `recurringRouter`, add `app.route("/", recurringRouter)` |

### Anti-Patterns to Avoid

- ❌ Do NOT store `next_due_date` in the database — compute it on read
- ❌ Do NOT use `type: 'transfer'` for recurring templates — only expense/income
- ❌ Do NOT hard-delete templates — deactivate (is_active = 0)
- ❌ Do NOT auto-generate occurrences on template creation — occurrences are generated on-demand in story 4-2
- ❌ Do NOT use floating-point for amounts — string decimal only
- ❌ Do NOT import from `services/` or `routes/` in schema files
- ❌ Do NOT add occurrence confirm/skip logic — that's story 4-2

### Existing Patterns to Follow

- `ApiError` class for domain/business errors (from `src/lib/api-error.ts`) — do NOT copy `HTTPException` usage from `category.service.ts` (older pattern)
- `drizzle(c.env.DB)` in route handlers to get DB instance
- `c.get("userId")` for authenticated user ID
- `crypto.randomUUID()` for server-generated IDs
- `new Date().toISOString()` for timestamps
- Route registration: `app.route("/", recurringRouter)` in index.ts
- Auth middleware: `recurringRouter.use("/api/v1/recurring", authMiddleware)`
- Response mapping: convert DB integer booleans to JS booleans in API responses

### Testing Patterns (from previous stories)

- Use `SELF.fetch()` for integration tests (pool-workers pattern)
- Login helper to get session token
- Seed account and category before creating templates
- Test 401 for unauthenticated requests
- Test 400 for invalid input (Zod validation)
- Test 404 for non-existent referenced entities

### References

- [Source: epics.md#Epic-4-Story-4.1] — Complete acceptance criteria
- [Source: architecture.md#Data-Architecture] — Amount as TEXT, UUID PKs, ISO dates
- [Source: architecture.md#Implementation-Patterns] — Service layer rules, route patterns, naming conventions
- [Source: architecture.md#Project-Structure] — File organization for routes, services, schemas, db/schema
- [Source: story-3-4] — Route pattern, service pattern, test patterns, ApiError usage
- [Source: prd.md] — FR-REC-01 through FR-REC-06

## Dev Agent Record

### Agent Model Used

Kiro CLI (Auto)

### Completion Notes List

- Implemented full CRUD for recurring transaction templates (POST, GET list, GET :id, PUT :id, DELETE :id)
- Migration 0004_hot_guardian.sql creates `recurring_templates` and `recurring_occurrences` tables with proper FKs and indexes
- `computeNextDueDate` iterates from start_date by frequency, skipping posted/skipped occurrences, returning first future unprocessed date
- FK validation: account must exist and be active, category must exist
- Deactivation is soft (is_active = 0), deactivated templates excluded from list
- All 18 integration tests pass covering CRUD lifecycle, validation, FK checks, next_due_date computation
- Full regression suite: 154 tests pass across 16 files
- Type check and lint pass on all new files

### File List

- `apps/api/src/db/schema/recurring.ts` (new)
- `apps/api/src/db/schema/index.ts` (modified - added recurring exports)
- `apps/api/src/db/migrations/0004_hot_guardian.sql` (new - generated)
- `apps/api/src/schemas/recurring.schema.ts` (new)
- `apps/api/src/services/recurring.service.ts` (new)
- `apps/api/src/routes/recurring.ts` (new)
- `apps/api/src/index.ts` (modified - mounted recurringRouter)
- `apps/api/tests/integration/recurring.test.ts` (new)

### Change Log

- 2026-05-30: Implemented Story 4-1 Recurring Transaction Templates - full CRUD with validation, next_due_date computation, and integration tests
