# Story 4.3: Receipt Upload & Management

Status: done

## Story

As the app owner,
I want to attach receipt images or PDFs to my transactions,
so that I have proof of purchase linked directly to the expense record.

## Acceptance Criteria (BDD)

1. **Given** the database has no receipts table **When** the migration for this story is applied **Then** the `receipts` table exists with columns: id (TEXT UUID PK), transaction_id (TEXT FK transactions.id), r2_key (TEXT), filename (TEXT), content_type (TEXT), size_bytes (INTEGER), created_by (TEXT FK users.id), created_at (TEXT ISO 8601)

2. **Given** a valid session and an existing non-deleted transaction **When** `POST /api/v1/transactions/:id/receipts` is called with a file upload (multipart/form-data) **Then** the file is stored in R2 with key `receipts/{transaction_id}/{uuid}.{ext}` **And** a receipt metadata record is created in D1 **And** the response includes the receipt id, filename, content_type, size_bytes, and a presigned download URL

3. **Given** a file upload with content type not in (image/jpeg, image/png, image/webp, image/heic, application/pdf) **When** `POST /api/v1/transactions/:id/receipts` is called **Then** the response is `{ error: { code: "INVALID_FILE_TYPE", message: "..." } }` with status 400

4. **Given** a file upload exceeding 10MB **When** `POST /api/v1/transactions/:id/receipts` is called **Then** the response is `{ error: { code: "FILE_TOO_LARGE", message: "Maximum file size is 10MB" } }` with status 400

5. **Given** a valid session and a transaction with receipts **When** `GET /api/v1/transactions/:id/receipts` is called **Then** all receipt metadata for that transaction is returned **And** each receipt includes a presigned download URL with 15-minute TTL

6. **Given** a presigned download URL accessed within 15 minutes **Then** the receipt file is downloadable directly from R2

7. **Given** a presigned download URL accessed after 15 minutes **Then** the URL is expired and returns an access denied error

8. **Given** a transaction that is soft-deleted **When** `GET /api/v1/transactions/:id/receipts` is called **Then** receipts remain accessible (soft-delete does not affect receipt access)

9. **Given** a transaction that is permanently purged (via trash purge) **When** the purge executes **Then** all associated receipts are deleted from R2 and their metadata records are removed from D1

10. **Given** a valid session and an existing receipt **When** `DELETE /api/v1/receipts/:id` is called **Then** the file is deleted from R2 **And** the receipt metadata record is deleted from D1 **And** the response is 204 No Content

11. **Given** multiple receipts attached to one transaction **When** `GET /api/v1/transactions/:id/receipts` is called **Then** all receipts are returned (many-to-one relationship supported)

12. **Given** a transaction that does not exist **When** `POST /api/v1/transactions/:id/receipts` is called **Then** the response is `{ error: { code: "TRANSACTION_NOT_FOUND", message: "..." } }` with status 404

13. **Given** a receipt that does not exist **When** `DELETE /api/v1/receipts/:id` is called **Then** the response is `{ error: { code: "NOT_FOUND", message: "..." } }` with status 404

## Tasks / Subtasks

- [x] Task 1: Create receipts DB schema and migration (AC: #1)
  - [x] Create `src/db/schema/receipts.ts` with receipts table definition
  - [x] Add `receipts` export to `src/db/schema/index.ts`
  - [x] Run `drizzle-kit generate` to produce migration SQL
  - [x] Apply migration locally with `wrangler d1 migrations apply DB --local`
- [x] Task 2: Create `src/lib/r2.ts` presigned URL helper (AC: #5, #6, #7)
  - [x] Implement `generatePresignedDownloadUrl(env, r2Key)` using aws4fetch
  - [x] Use 15-minute TTL (900 seconds)
  - [x] Read R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY from env secrets
- [x] Task 3: Create `src/services/receipt.service.ts` (AC: #2-5, #8-13)
  - [x] `uploadReceipt(db, r2Bucket, input, userId)` — validate, store in R2, save metadata
  - [x] `listReceipts(db, env, transactionId)` — fetch metadata + generate presigned URLs
  - [x] `deleteReceipt(db, r2Bucket, receiptId)` — delete from R2 + D1
  - [x] `deleteReceiptsForTransactions(db, r2Bucket, transactionIds)` — bulk delete for purge
- [x] Task 4: Create `src/routes/receipts.ts` with route definitions (AC: #2-5, #10, #12, #13)
  - [x] `POST /api/v1/transactions/:id/receipts` — multipart upload
  - [x] `GET /api/v1/transactions/:id/receipts` — list with presigned URLs
  - [x] `DELETE /api/v1/receipts/:id` — delete single receipt
  - [x] Add auth middleware for all receipt paths
  - [x] Register `receiptsRouter` in `src/index.ts`
- [x] Task 5: Extend `purgeTrash` in `transaction.service.ts` (AC: #9)
  - [x] Before deleting transactions, collect their IDs
  - [x] Delete associated receipts from R2 and D1
  - [x] Update `purgeTrash` signature to accept R2 bucket binding
- [x] Task 6: Integration tests (AC: #1-13)
  - [x] Test upload with valid file (JPEG) → receipt created, presigned URL returned
  - [x] Test upload with invalid content type → 400 INVALID_FILE_TYPE
  - [x] Test upload exceeding 10MB → 400 FILE_TOO_LARGE
  - [x] Test list receipts for transaction → returns all with presigned URLs
  - [x] Test delete receipt → removed from R2 and D1, returns 204
  - [x] Test upload to non-existent transaction → 404
  - [x] Test delete non-existent receipt → 404
  - [x] Test multiple receipts on one transaction
  - [x] Test purge trash deletes associated receipts
  - [x] Test receipts accessible on soft-deleted transaction

### Review Findings

_Code review 2026-05-31 — 6 patch applied, 10 deferred, 7 dismissed as noise. Decision on AC #2 resolved: enforce non-deleted. After fixes: `check-types` clean and 188/188 tests pass (17 files)._

Patch:

- [x] [Review][Patch] AC #2 — enforce non-deleted transaction on upload (resolved decision): add `is_deleted = 0` to the existence check in `uploadReceipt` so uploads to a soft-deleted transaction return 404 TRANSACTION_NOT_FOUND [apps/api/src/services/receipt.service.ts:60]
- [x] [Review][Patch] `check-types` is broken — 24 `'unknown'` errors from bare `await res.json()`; type response bodies via `schema.parse(...)` / typed assertion as sibling test files do [apps/api/tests/integration/receipts.test.ts:79-352]
- [x] [Review][Patch] Upload not atomic — `r2Bucket.put` runs before `db.insert`; a failed insert orphans the R2 object. Wrap the insert in try/catch and delete the R2 object on failure [apps/api/src/services/receipt.service.ts:87]
- [x] [Review][Patch] Delete ordering leaves dead metadata — `r2Bucket.delete` runs before `db.delete`; a failed D1 delete leaves a row whose presigned URL 404s. Delete the D1 row first, then the R2 object [apps/api/src/services/receipt.service.ts:150]
- [x] [Review][Patch] `purgeTrash` `r2Bucket` parameter is optional — silently skips receipt cleanup (AC #9) if ever called without it; make the parameter required [apps/api/src/services/transaction.service.ts:415]
- [x] [Review][Patch] Missing test — `GET /transactions/:id/receipts` returning 404 for a non-existent transaction is handled but untested [apps/api/tests/integration/receipts.test.ts]

Defer:

- [x] [Review][Defer] No per-user authorization on receipt upload/list/delete (IDOR) [apps/api/src/routes/receipts.ts] — deferred, app-wide posture (no service filters by `created_by`); revisit with Epic 6 collaboration
- [x] [Review][Defer] Client-supplied content-type trusted; no magic-byte validation [apps/api/src/services/receipt.service.ts:70] — deferred, security hardening; owner uploads own files in a private app
- [x] [Review][Defer] Worker-proxied upload deviates from architecture.md NFR-PERF-03 ("no Worker proxy") [apps/api/src/services/receipt.service.ts:87] — deferred, reconcile the now-stale arch doc with the story's explicit decision (downloads still use presigned URLs, so NFR-SEC-08 holds)
- [x] [Review][Defer] Bulk receipt delete uses `Promise.all` not `allSettled` [apps/api/src/services/receipt.service.ts:172] — deferred, a single R2 delete failure aborts purge cleanup; retry-safe
- [x] [Review][Defer] Content-type with parameters (e.g. `image/jpeg; charset=...`) rejected [apps/api/src/services/receipt.service.ts:70] — deferred, browsers rarely send params on multipart File.type
- [x] [Review][Defer] Zero-byte file accepted [apps/api/src/services/receipt.service.ts:75] — deferred, minor validation gap, not in AC
- [x] [Review][Defer] `listReceipts` `Promise.all` — one presign failure fails the whole list [apps/api/src/services/receipt.service.ts:127] — deferred, signing is local/no-network, failure unlikely
- [x] [Review][Defer] Missing R2 secrets produce a cryptic runtime signing error [apps/api/src/lib/r2.ts:12] — deferred, add explicit secret validation
- [x] [Review][Defer] No cap on receipts per transaction [apps/api/src/services/receipt.service.ts:56] — deferred, storage-DoS, low risk for a private app
- [x] [Review][Defer] `deleteReceiptsForTransactions` unbounded `IN (...)` / R2 bulk delete not batched [apps/api/src/services/receipt.service.ts:163] — deferred, batch in chunks if large purges occur

## Dev Notes

### Architecture Decision: Upload Strategy

**Worker-proxied upload via R2 binding** (NOT presigned PUT URLs):
- The epic AC explicitly states `POST /api/v1/transactions/:id/receipts is called with a file upload (multipart/form-data)` — this means the Worker receives the file
- Use `env.RECEIPTS.put(key, body)` for upload — no R2 API credentials needed for writes
- This is simpler for a 1-2 user app: no extra secrets for upload, no CORS config on R2 bucket
- 10MB file through Worker is fine (Workers support up to 100MB request bodies on paid plan)

**Presigned URLs via aws4fetch for DOWNLOAD only** (NFR-SEC-08):
- Downloads use presigned GET URLs with 15-min TTL
- This requires R2 API credentials as secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- These are set via `wrangler secret put` and accessed via `c.env.R2_ACCOUNT_ID` etc.

### R2 Key Structure

```
receipts/{transaction_id}/{uuid}.{ext}
```

Extension mapping:
- `image/jpeg` → `.jpg`
- `image/png` → `.png`
- `image/webp` → `.webp`
- `image/heic` → `.heic`
- `application/pdf` → `.pdf`

### Presigned URL Generation (`src/lib/r2.ts`)

```typescript
import { AwsClient } from "aws4fetch";

const PRESIGN_TTL = 900; // 15 minutes

export const generatePresignedDownloadUrl = async (
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
): Promise<string> => {
  const client = new AwsClient({
    service: "s3",
    region: "auto",
    accessKeyId,
    secretAccessKey,
  });

  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Expires=${PRESIGN_TTL}`;

  const signed = await client.sign(new Request(url), {
    aws: { signQuery: true },
  });

  return signed.url.toString();
};
```

**Critical:** The bucket name in the URL is `bearuang-receipts` (from wrangler.toml `bucket_name`), NOT the binding name `RECEIPTS`.

### Secrets Required (add to `.dev.vars` and production)

```
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-api-token-access-key>
R2_SECRET_ACCESS_KEY=<r2-api-token-secret-key>
```

These must be added to `wrangler.toml` comment and `.env.example` documentation. Generate R2 API tokens from Cloudflare dashboard → R2 → Manage R2 API Tokens.

### Multipart Form Parsing in Hono

Hono provides built-in multipart parsing. Use `c.req.parseBody()`:

```typescript
const body = await c.req.parseBody();
const file = body["file"];
// file is a File object with: name, type, size, arrayBuffer(), stream()
```

**Validation before R2 upload:**
1. Check `file` exists and is a `File` instance (not a string)
2. Check `file.type` is in allowed content types
3. Check `file.size` <= 10 * 1024 * 1024 (10MB)
4. Only then call `env.RECEIPTS.put(key, file.stream() or await file.arrayBuffer())`

### Receipt Service Function Signatures

```typescript
interface UploadReceiptInput {
  transactionId: string;
  file: File;
}

interface ReceiptMetadata {
  id: string;
  transaction_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_by: string;
  created_at: string;
  download_url: string;
}

export const uploadReceipt = async (
  db: DrizzleD1Database,
  r2Bucket: R2Bucket,
  env: { R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string },
  input: UploadReceiptInput,
  userId: string,
): Promise<ReceiptMetadata>

export const listReceipts = async (
  db: DrizzleD1Database,
  env: { R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string },
  transactionId: string,
): Promise<{ items: ReceiptMetadata[] }>

export const deleteReceipt = async (
  db: DrizzleD1Database,
  r2Bucket: R2Bucket,
  receiptId: string,
): Promise<void>

export const deleteReceiptsForTransactions = async (
  db: DrizzleD1Database,
  r2Bucket: R2Bucket,
  transactionIds: string[],
): Promise<number>
```

### Extending `purgeTrash` in `transaction.service.ts`

The existing `purgeTrash` function signature is:
```typescript
export const purgeTrash = async (db: DrizzleD1Database): Promise<number>
```

It must be updated to:
```typescript
export const purgeTrash = async (db: DrizzleD1Database, r2Bucket: R2Bucket): Promise<number>
```

**Logic change:**
1. Query transactions to be purged (same existing WHERE clause)
2. Collect their IDs
3. Call `deleteReceiptsForTransactions(db, r2Bucket, transactionIds)` to clean up R2 + receipt metadata
4. Then delete the transactions (existing logic)

**CRITICAL:** The route handler in `transactions.ts` that calls `purgeTrash` must be updated to pass `c.env.RECEIPTS` as the second argument.

### Route Definitions

```typescript
// POST /api/v1/transactions/:id/receipts — upload
const uploadReceiptRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions/{id}/receipts",
  security: [{ Bearer: [] }],
  request: {
    params: transactionIdParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({ file: z.any() }),
        },
      },
      required: true,
    },
  },
  responses: {
    201: { description: "Receipt uploaded", content: { "application/json": { schema: receiptResponseSchema } } },
    400: { description: "Invalid file", content: { "application/json": { schema: errorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Transaction not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

// GET /api/v1/transactions/:id/receipts — list
const listReceiptsRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/{id}/receipts",
  security: [{ Bearer: [] }],
  request: { params: transactionIdParamsSchema },
  responses: {
    200: { description: "Receipt list", content: { "application/json": { schema: receiptListResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Transaction not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

// DELETE /api/v1/receipts/:id — delete
const deleteReceiptRoute = createRoute({
  method: "delete",
  path: "/api/v1/receipts/{id}",
  security: [{ Bearer: [] }],
  request: { params: receiptIdParamsSchema },
  responses: {
    204: { description: "Receipt deleted" },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});
```

### Auth Middleware Registration

```typescript
receiptsRouter.use("/api/v1/transactions/:id/receipts", authMiddleware);
receiptsRouter.use("/api/v1/receipts/:id", authMiddleware);
```

### Registering in `src/index.ts`

Add after the `recurringRouter`:
```typescript
import { receiptsRouter } from "./routes/receipts";
// ...
app.route("/", receiptsRouter);
```

### DB Schema (`src/db/schema/receipts.ts`)

```typescript
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { transactions } from "./transactions";
import { users } from "./users";

export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    transaction_id: text("transaction_id").notNull().references(() => transactions.id),
    r2_key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    content_type: text("content_type").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    created_by: text("created_by").notNull().references(() => users.id),
    created_at: text("created_at").notNull(),
  },
  (table) => ({
    transactionIdIndex: index("idx_receipts_transaction_id").on(table.transaction_id),
  }),
);
```

### Update `src/db/schema/index.ts`

Add:
```typescript
export { receipts } from "./receipts";
```

### Allowed Content Types Constant

```typescript
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

const EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
```

### Transaction Existence Check

For upload and list, verify the transaction exists. For upload, also verify it's not permanently deleted (but soft-deleted is OK per AC #8):

```typescript
// For upload: transaction must exist (any state — even soft-deleted is fine for attaching receipts? NO)
// Actually re-reading AC: upload is to "an existing non-deleted transaction" (AC #2 says "existing")
// But AC #8 says "soft-deleted transaction" receipts remain accessible (for GET, not POST)
// So: POST requires transaction exists (is_deleted = 0 OR is_deleted = 1 — just exists in DB)
// Actually the epic AC says "existing transaction" — interpret as: row exists in DB (not permanently purged)
// This is safest: allow attaching receipts to soft-deleted transactions too (they might be restored)

const txn = await db.select({ id: transactions.id })
  .from(transactions)
  .where(eq(transactions.id, transactionId))
  .limit(1);
if (!txn[0]) throw new ApiError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
```

### Files to Create (NEW)

| File | Purpose |
|------|---------|
| `src/db/schema/receipts.ts` | Drizzle schema for receipts table |
| `src/lib/r2.ts` | Presigned download URL generation via aws4fetch |
| `src/services/receipt.service.ts` | Receipt business logic |
| `src/routes/receipts.ts` | Route definitions and handlers |
| `src/db/migrations/XXXX_*.sql` | Generated migration (via drizzle-kit generate) |

### Files to Modify (UPDATE)

| File | Changes |
|------|---------|
| `src/db/schema/index.ts` | Add `export { receipts } from "./receipts";` |
| `src/index.ts` | Import and mount `receiptsRouter` |
| `src/services/transaction.service.ts` | Update `purgeTrash` to accept `R2Bucket` param and delete associated receipts |
| `src/routes/transactions.ts` | Update `purgeTrashRoute` handler to pass `c.env.RECEIPTS` to `purgeTrash` |
| `.env.example` | Document R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY |

### Existing Patterns to Follow

- `ApiError` class from `src/lib/api-error.ts` for domain errors
- `drizzle(c.env.DB)` in route handlers for DB access
- `c.get("userId")` for authenticated user ID
- `c.env.RECEIPTS` for R2 bucket binding
- `crypto.randomUUID()` for new receipt IDs
- `new Date().toISOString()` for `created_at` timestamps
- Route param style: `{id}` in OpenAPI path, `:id` in middleware `.use()`
- Response: `{ items: [...] }` for lists
- Error: `{ error: { code, message } }` shape
- 204 No Content for deletes (no body)
- `OpenAPIHono` with `defaultHook` for validation errors (same pattern as `transactionsRouter`)
- Import `transactionIdParamsSchema` from `src/schemas/transaction.schema.ts` (reuse existing)

### Anti-Patterns to Avoid

- ❌ Do NOT use presigned PUT URLs for upload — use R2 binding directly
- ❌ Do NOT create a separate Zod schema file for receipts — define schemas inline in `receipts.ts` route file or create minimal `receipt.schema.ts` if needed
- ❌ Do NOT use `request.body` directly — use Hono's `c.req.parseBody()` for multipart
- ❌ Do NOT store the presigned download URL in the database — generate it on-the-fly per request
- ❌ Do NOT use `@aws-sdk/client-s3` — it's not Workers-compatible; use `aws4fetch` only
- ❌ Do NOT add `Content-Length` header when signing presigned URLs
- ❌ Do NOT forget to delete R2 objects when purging trash or deleting receipts
- ❌ Do NOT use floating-point for size_bytes — it's an integer
- ❌ Do NOT import from `services/` or `routes/` in `lib/r2.ts`

### Testing Patterns

- Use `SELF.fetch()` for integration tests (same as other test files)
- Login helper to get session token
- Seed: create account → category → transaction before testing receipts
- For file upload in tests, construct a `FormData` with a `File`/`Blob`:
  ```typescript
  const formData = new FormData();
  formData.append("file", new File(["test content"], "receipt.jpg", { type: "image/jpeg" }));
  const res = await SELF.fetch(`/api/v1/transactions/${txnId}/receipts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  ```
- For presigned URL testing: verify the URL contains expected query params (X-Amz-Expires, X-Amz-Signature) — don't actually fetch from R2 in tests (Miniflare R2 doesn't support presigned URLs)
- Test the R2 binding operations directly: verify `env.RECEIPTS.get(key)` returns the uploaded content
- Test purge: create transaction → attach receipt → soft-delete → purge → verify receipt gone from R2

### Env Type Updates

The `Env` type (generated by `wrangler types`) should already include `RECEIPTS: R2Bucket` from wrangler.toml. If not, run `bunx wrangler types` to regenerate. The new secrets need to be added to the Env interface manually or via wrangler types:

```typescript
// In worker-configuration.d.ts or src/types/env.ts:
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  RECEIPTS: R2Bucket;
  CORS_ORIGIN: string;
  INITIAL_PASSWORD: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
```

### Previous Story Intelligence (from 4-2)

- Story 4-2 added occurrence generation with on-demand computation pattern
- Pattern: service functions receive `db: DrizzleD1Database` as first param
- Route handlers use `drizzle(c.env.DB)` to create the db instance
- Auth middleware registered per-path (not wildcard)
- Tests use `SELF.fetch()` with full URL paths
- All 175 tests pass across 16 files — ensure no regressions

### References

- [Source: epics.md#Epic-4-Story-4.3] — Complete acceptance criteria
- [Source: architecture.md#Implementation-Patterns] — Service layer rules, route patterns
- [Source: architecture.md#Project-Structure] — File organization, receipts.ts placement
- [Source: architecture.md#Infrastructure-Deployment] — R2 presigned URLs via aws4fetch
- [Source: architecture.md#NFR-SEC-08] — Presigned URL 15-min TTL
- [Source: architecture.md#NFR-PERF-03] — Receipt upload <5s for 10MB
- [Source: prd.md] — FR-RCP-01 through FR-RCP-05
- [Source: wrangler.toml] — R2 binding name is RECEIPTS, bucket is bearuang-receipts
- [Source: Cloudflare R2 docs] — aws4fetch presigned URL generation with signQuery:true
- [Source: story-4-2] — Previous story patterns and test count baseline

## Dev Agent Record

### Agent Model Used

Kiro CLI (Auto)

### Completion Notes List

- Implemented full receipt upload & management feature with R2 integration
- Schema: receipts table with FK to transactions and users, indexed on transaction_id
- R2 presigned download URLs via aws4fetch with 15-min TTL
- Upload uses R2 binding directly (worker-proxied), not presigned PUT
- Service layer validates content type (jpeg/png/webp/heic/pdf), file size (10MB max), and transaction existence
- Routes: POST upload (multipart), GET list (with presigned URLs), DELETE single receipt
- purgeTrash extended to cascade-delete receipts from R2 and D1 before removing transactions
- All 12 new integration tests pass; full suite 187 tests / 17 files, zero regressions
- Type augmentation added for R2 secrets (env.d.ts) since wrangler types doesn't include secrets

### File List

New files:
- apps/api/src/db/schema/receipts.ts
- apps/api/src/db/migrations/0005_worried_sabretooth.sql
- apps/api/src/lib/r2.ts
- apps/api/src/services/receipt.service.ts
- apps/api/src/routes/receipts.ts
- apps/api/src/types/env.d.ts
- apps/api/tests/integration/receipts.test.ts

Modified files:
- apps/api/src/db/schema/index.ts
- apps/api/src/index.ts
- apps/api/src/services/transaction.service.ts
- apps/api/src/routes/transactions.ts
- apps/api/.dev.vars

## Change Log

- 2026-05-31: Implemented Story 4.3 — Receipt Upload & Management. Added receipts table, R2 presigned URL helper, receipt service (upload/list/delete/bulk-delete), receipt routes, extended purgeTrash for receipt cleanup, 12 integration tests.
- 2026-05-31: Code review — applied 6 patches: enforce non-deleted transaction on upload (AC #2), atomic upload (delete R2 object if D1 insert fails), delete D1 row before R2 object, required `r2Bucket` on `purgeTrash`, typed test response bodies (fixes `check-types`), added 404 GET-receipts test. `check-types` clean; 188/188 tests pass. 10 items deferred (see deferred-work.md), 7 dismissed. Status → done.
