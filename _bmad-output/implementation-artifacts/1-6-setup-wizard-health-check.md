# Story 1.6: Setup Wizard & Health Check

Status: done

## Story

As the app owner,
I want to detect if my instance needs initial setup and configure it in one step,
So that I can get started quickly after deployment without manual database manipulation.

## Acceptance Criteria

1. **AC-1 Setup status — not complete:** When `GET /api/v1/setup/status` is called on a freshly deployed instance with no `setup_complete` setting in the database, the response is `{ "is_setup_complete": false }` with status 200. This endpoint is public (no auth required). [Source: epics.md#Story-1.6, architecture.md#NFR-SEC-01]

2. **AC-2 Setup initialize — success:** When `POST /api/v1/setup/initialize` is called with `{ "display_name": "...", "base_currency": "...", "seed_categories": true|false }`, the following settings are upserted in D1: `display_name` (value: provided string), `base_currency` (value: provided string), `seed_categories_on_first_use` (value: `"true"` or `"false"`), and `setup_complete` (value: `"true"`). The response is `{ "message": "Setup complete" }` with status 200. This endpoint is public (no auth required). [Source: epics.md#Story-1.6]

3. **AC-3 Setup initialize — already complete:** When `POST /api/v1/setup/initialize` is called and `setup_complete` is already `"true"` in settings, the response is `{ error: { code: "CONFLICT", message: "Setup has already been completed" } }` with status 409. The error code is `"CONFLICT"` (not `"SETUP_ALREADY_COMPLETE"`) because the global `error-handler.ts` derives codes from HTTP status — 409 maps to `"CONFLICT"`. This is consistent with the architecture's error handling pattern. [Source: epics.md#Story-1.6, apps/api/src/middleware/error-handler.ts]

4. **AC-4 Setup status — complete:** After a successful `POST /api/v1/setup/initialize`, `GET /api/v1/setup/status` returns `{ "is_setup_complete": true }`. [Source: epics.md#Story-1.6]

5. **AC-5 Health check — enhanced:** `GET /api/v1/health` (public, no auth) returns a response that includes connectivity status for D1, R2, and KV. Each service shows `"ok"` or `"error"`. The overall `status` field is `"healthy"` only if all three services are reachable; otherwise `"degraded"`. **Breaking change from current response:** the existing `{ status: "ok" }` shape is replaced — the existing test in `auth.test.ts` (`"keeps health route public"`) must be updated to match the new shape. [Source: epics.md#Story-1.6, architecture.md#NFR-REL-03]

6. **AC-6 Health check — D1 connectivity:** D1 is checked by running a lightweight query (e.g., `SELECT 1`). If it succeeds, D1 status is `"ok"`. If it throws, D1 status is `"error"` with a brief message. [Source: epics.md#Story-1.6]

7. **AC-7 Health check — KV connectivity:** KV is checked by calling `kv.get("__health_check__")`. If it resolves (even returning null), KV status is `"ok"`. If it throws, KV status is `"error"`. [Source: epics.md#Story-1.6]

8. **AC-8 Health check — R2 connectivity:** R2 is checked by calling `r2.head("__health_check__")`. If it resolves (even returning null for a missing key), R2 status is `"ok"`. If it throws, R2 status is `"error"`. [Source: epics.md#Story-1.6]

9. **AC-9 Settings integration tests:** `GET /api/v1/settings` and `PUT /api/v1/settings` are covered by integration tests (deferred from Story 1.5). Tests verify: GET returns all settings, PUT upserts a key-value pair and returns the updated item, PUT with empty key returns 400. [Source: deferred-work.md#Deferred-from-1-5]

10. **AC-10 Type-check and lint pass:** `bun run check-types` and `bun run lint` both exit 0. [Source: architecture.md#Implementation-Patterns]

11. **AC-11 Integration tests:** A new `tests/integration/setup.test.ts` covers: setup status returns false on fresh instance, initialize succeeds and stores settings, status returns true after initialize, initialize returns 409 if called again. A new `tests/integration/health.test.ts` covers: health returns healthy when all services are up. [Source: architecture.md#Test-Organization]

## Tasks / Subtasks

- [x] **Task 1: Create `src/routes/setup.ts`** (AC: 1, 2, 3, 4)
  - [ ] 1.1 Create `apps/api/src/schemas/setup.schema.ts` with:
    - `setupStatusResponseSchema = z.object({ is_setup_complete: z.boolean() })`
    - `setupInitializeRequestSchema = z.object({ display_name: z.string().min(1), base_currency: z.string().min(1).max(10), seed_categories: z.boolean() })`
    - `setupInitializeResponseSchema = z.object({ message: z.string() })`
  - [ ] 1.2 Create `apps/api/src/routes/setup.ts` using `OpenAPIHono<{ Bindings: Env }>`
  - [ ] 1.3 Define `setupStatusRoute` with `createRoute()`: `GET /api/v1/setup/status`, no auth, 200: `setupStatusResponseSchema`
  - [ ] 1.4 Define `setupInitializeRoute` with `createRoute()`: `POST /api/v1/setup/initialize`, no auth, request body: `setupInitializeRequestSchema`, 200: `setupInitializeResponseSchema`, 409: `errorResponseSchema`
  - [ ] 1.5 `GET /api/v1/setup/status` handler: query `db.select().from(settings).where(eq(settings.key, 'setup_complete')).limit(1)` → return `{ is_setup_complete: row?.value === 'true' }`
  - [ ] 1.6 `POST /api/v1/setup/initialize` handler:
    - Check if `setup_complete` is already `"true"` → throw `new HTTPException(409, { message: "Setup has already been completed" })`
    - Upsert four settings keys using the same `insert().onConflictDoUpdate()` pattern from `settings.ts`:
      - `display_name` → provided value
      - `base_currency` → provided value
      - `seed_categories_on_first_use` → `String(seed_categories)` (`"true"` or `"false"`)
      - `setup_complete` → `"true"`
    - Return `c.json({ message: "Setup complete" }, 200)`
  - [ ] 1.7 **Note:** The `display_name` setting stored here is read by `auth.service.ts` during first-login auto-provisioning (Story 1.4 pattern). No change to `auth.service.ts` needed.
  - [ ] 1.8 **Note:** `seed_categories_on_first_use` is stored as a string setting for Epic 2 to consume. Story 1.6 does NOT create categories — it only stores the flag.

- [x] **Task 2: Enhance `src/routes/health.ts`** (AC: 5, 6, 7, 8)
  - [ ] 2.1 Update the health route response schema to:
    ```typescript
    z.object({
      status: z.enum(["healthy", "degraded"]),
      services: z.object({
        d1: z.object({ status: z.enum(["ok", "error"]), message: z.string().optional() }),
        kv: z.object({ status: z.enum(["ok", "error"]), message: z.string().optional() }),
        r2: z.object({ status: z.enum(["ok", "error"]), message: z.string().optional() }),
      }),
    })
    ```
  - [ ] 2.2 Update the handler to check each service independently using `try/catch`:
    - D1: `await drizzle(c.env.DB).run(sql\`SELECT 1\`)` — import `sql` from `drizzle-orm`
    - KV: `await c.env.SESSIONS.get("__health_check__")` — resolves to null (ok) or throws (error)
    - R2: `await c.env.RECEIPTS.head("__health_check__")` — resolves to null (ok) or throws (error)
  - [ ] 2.3 Set overall `status` to `"healthy"` if all three are `"ok"`, otherwise `"degraded"`
  - [ ] 2.4 Preserve the existing `ctx.waitUntil()` demonstration pattern (keep the try/catch block)
  - [ ] 2.5 **IMPORTANT:** The health route must remain public (no `authMiddleware`). It is registered before `authRouter` in `index.ts` and has no auth applied.
  - [ ] 2.6 Add `import { drizzle } from "drizzle-orm/d1"` and `import { sql } from "drizzle-orm"` to `health.ts`
  - [ ] 2.7 Change the `OpenAPIHono` generic from `{ Bindings: Env }` to `{ Bindings: Env }` — no change needed, but ensure `c.env.DB`, `c.env.SESSIONS`, and `c.env.RECEIPTS` are accessible (they are, via the `Env` type)
  - [ ] 2.8 **Fix regression in `tests/integration/auth.test.ts`:** The existing test `"keeps health route public"` asserts `expect(await res.json()).toEqual({ status: "ok" })`. Update it to match the new response shape:
    ```typescript
    it("keeps health route public", async () => {
      const res = await app.request("/api/v1/health", {}, env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("healthy");
      expect(body.services).toBeDefined();
    });
    ```

- [x] **Task 3: Mount setup router in `src/index.ts`** (AC: 1, 2, 3, 4)
  - [ ] 3.1 Import `setupRouter` from `"./routes/setup"`
  - [ ] 3.2 Add `app.route("/", setupRouter)` — mount it BEFORE `authRouter` so setup routes are public (though they have no auth middleware anyway, ordering is consistent with the public-first convention)
  - [ ] 3.3 Verify `index.ts` mount order: `healthRouter` → `setupRouter` → `authRouter` → `settingsRouter`

- [x] **Task 4: Write integration tests** (AC: 9, 11)
  - [ ] 4.1 Create `apps/api/tests/integration/setup.test.ts`:
    - `beforeAll`: `applyMigrations(env.DB)`
    - `beforeEach`: clear `settings` table (`DELETE FROM settings`)
    - Test: `GET /api/v1/setup/status` on fresh DB → `{ is_setup_complete: false }`
    - Test: `POST /api/v1/setup/initialize` with valid body → 200 `{ message: "Setup complete" }`; verify settings rows exist in DB
    - Test: `GET /api/v1/setup/status` after initialize → `{ is_setup_complete: true }`
    - Test: `POST /api/v1/setup/initialize` called twice → 409 with `CONFLICT` error code
    - Test: `POST /api/v1/setup/initialize` with missing `display_name` → 400 validation error
  - [ ] 4.2 Create `apps/api/tests/integration/health.test.ts`:
    - `beforeAll`: `applyMigrations(env.DB)`
    - Test: `GET /api/v1/health` → 200, `status: "healthy"`, all three services `"ok"` (in the test environment with real Miniflare bindings, all services should be reachable)
    - Test: response shape matches the new schema (status, services.d1, services.kv, services.r2)
  - [ ] 4.3 Create `apps/api/tests/integration/settings.test.ts` (deferred from Story 1.5):
    - `beforeAll`: `applyMigrations(env.DB)`
    - `beforeEach`: clear `settings` and `users` tables AND KV — use the exact same pattern as `auth.test.ts`:
      ```typescript
      beforeEach(async () => {
        await env.DB.prepare("DELETE FROM users").run();
        await env.DB.prepare("DELETE FROM settings").run();
        const kvList = await env.SESSIONS.list();
        await Promise.all(kvList.keys.map((k) => env.SESSIONS.delete(k.name) as Promise<void>));
        await env.SESSIONS.delete("rate_limit:login:global");
      });
      ```
    - Helper: login to get a token — call `POST /api/v1/auth/login` with `env.INITIAL_PASSWORD` (same pattern as `auth.test.ts`); add 30s timeout to any test that triggers this
    - **Note:** `settingsFactory` from `tests/fixtures/factories.ts` can be used for direct DB inserts if needed, but for these tests use the API endpoints directly
    - Test: `GET /api/v1/settings` with valid token → 200 `{ items: [] }` on empty DB
    - Test: `PUT /api/v1/settings` with `{ key: "theme", value: "dark" }` → 200 with the updated item `{ key: "theme", value: "dark", updated_at: <string> }`
    - Test: `GET /api/v1/settings` after PUT → items array contains the upserted key
    - Test: `PUT /api/v1/settings` with same key and different value → 200 with updated value (upsert behavior confirmed)
    - Test: `PUT /api/v1/settings` with empty `key` (`""`) → 400 validation error
    - Test: `GET /api/v1/settings` without auth → 401
    - Test: `PUT /api/v1/settings` without auth → 401

- [x] **Task 5: Verification gate** (AC: 10)
  - [ ] 5.1 `bun run check-types` from repo root — exit 0
  - [ ] 5.2 `bun run lint` from repo root — exit 0
  - [ ] 5.3 `bun run test --run` from `apps/api/` — all tests pass
  - [ ] 5.4 Update Dev Agent Record with file list and any deviations

## Dev Notes

### Critical Architecture Constraints

**Setup routes are public — no `authMiddleware`:**
`GET /api/v1/setup/status` and `POST /api/v1/setup/initialize` must be accessible without a session token (NFR-SEC-01 lists "first-run check" as a public endpoint). Do NOT apply `authMiddleware` to the setup router or any setup route. The `setupRouter` uses `OpenAPIHono<{ Bindings: Env }>` (no `Variables` needed since no userId is set).

**`setup_complete` is stored as a string `"true"` in the settings table:**
The `settings` table stores all values as `TEXT`. The boolean `is_setup_complete` in the response is derived by checking `row?.value === 'true'`. This is consistent with how `session_timeout` and other settings are stored and read.

**`POST /api/v1/setup/initialize` uses the same upsert pattern as `PUT /api/v1/settings`:**
```typescript
const now = new Date().toISOString();
await db.insert(settings)
  .values({ key: "setup_complete", value: "true", updated_at: now })
  .onConflictDoUpdate({ target: settings.key, set: { value: "true", updated_at: now } });
```
Use four sequential `await` calls (one per key) — do NOT use `db.batch()` here. `db.batch()` requires raw `D1PreparedStatement` objects (via `db.prepare(...).bind(...)`), not Drizzle query builder instances. Mixing Drizzle's `.onConflictDoUpdate()` with `db.batch()` is not supported. Sequential awaits are correct and sufficient at this scale.

**`base_currency` validation — accept any non-empty string:**
Validate as `z.string().min(1).max(10)`. Do NOT add ISO 4217 format validation — the architecture's "right-sized" philosophy applies here. The settings table stores it as plain text; format enforcement is a future concern.

**`error-handler.ts` maps 409 → `"CONFLICT"` — do NOT use a custom error code:**
The `deriveCode()` function in `error-handler.ts` maps status 409 to `"CONFLICT"`. The correct approach is to throw `new HTTPException(409, { message: "Setup has already been completed" })` — the global error handler will produce `{ error: { code: "CONFLICT", message: "Setup has already been completed" } }` automatically. Do NOT attempt to produce a custom `"SETUP_ALREADY_COMPLETE"` code — that would require bypassing the error handler pattern established in Stories 1.3–1.5. The integration test must assert `code: "CONFLICT"`, not `"SETUP_ALREADY_COMPLETE"`.

**Health check — `sql` tagged template from `drizzle-orm`:**
```typescript
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

// In handler:
const db = drizzle(c.env.DB);
await db.run(sql`SELECT 1`);
```
`db.run()` executes a raw SQL statement. `sql\`SELECT 1\`` is the Drizzle tagged template for raw SQL. This is the lightest possible D1 connectivity check.

**Health check — R2 `head()` method:**
```typescript
// c.env.RECEIPTS is an R2Bucket
const result = await c.env.RECEIPTS.head("__health_check__");
// result is null if the key doesn't exist — that's fine, it means R2 is reachable
```
`R2Bucket.head(key)` returns `R2Object | null`. A `null` result means the key doesn't exist but R2 is reachable — status is `"ok"`. Only a thrown exception means R2 is unreachable.

**Health check — KV `get()` for connectivity:**
```typescript
await c.env.SESSIONS.get("__health_check__");
// Returns null if key doesn't exist — that's fine
```
Same pattern as R2: null return = reachable = `"ok"`.

**Health check — `drizzle(c.env.DB)` creates a new instance per request — this is correct:**
The health handler creates a Drizzle instance only for the D1 check. Per-request instantiation is the correct Workers pattern (established in all previous stories). Do NOT cache it at module level.

**Health check response — always 200:**
The health endpoint always returns HTTP 200, even when `status` is `"degraded"`. The status field in the body communicates health. This is the standard pattern for health check endpoints (load balancers check HTTP status, not body content).

**`OpenAPIHono` generic for setup router:**
```typescript
export const setupRouter = new OpenAPIHono<{ Bindings: Env }>();
```
No `Variables` needed since setup routes don't set `userId`.

**`settingsFactory` exists in `tests/fixtures/factories.ts`:**
```typescript
import { settingsFactory } from "../fixtures/factories";
// Creates: { key: "test_key_<uuid>", value: "test_value", updated_at: "<iso>" }
```
Available for direct DB inserts in tests if needed. For `settings.test.ts`, prefer going through the API endpoints directly (same pattern as `auth.test.ts`).

**Regression: `auth.test.ts` health test must be updated:**
The existing test `"keeps health route public"` in `tests/integration/auth.test.ts` asserts `expect(await res.json()).toEqual({ status: "ok" })`. This will fail after the health route is updated. Task 2.8 covers this fix — do not skip it.

**`z` import in schema files:**
- `setup.schema.ts` — use `import { z } from "zod"` (consistent with `settings.schema.ts` and `common.schema.ts`)
- Do NOT use `import { z } from "@hono/zod-openapi"` in schema files (only `auth.schema.ts` does this for historical reasons)

### Existing Code State (from Stories 1.1–1.5)

**`apps/api/src/routes/health.ts` (current):**
```typescript
// Returns: { status: "ok" }
// Needs to be enhanced to: { status: "healthy"|"degraded", services: { d1, kv, r2 } }
```
The existing `ctx.waitUntil()` demonstration block must be preserved.

**`apps/api/src/index.ts` (current):**
```typescript
app.route("/", healthRouter);
app.route("/", authRouter);
app.route("/", settingsRouter);
// Add: app.route("/", setupRouter) between healthRouter and authRouter
```

**`apps/api/src/db/schema/index.ts` (current):**
```typescript
export { users } from "./users";
export { settings } from "./settings";
// No new tables needed for Story 1.6 — setup uses the existing settings table
```

**`apps/api/src/routes/settings.ts` (current):**
- `GET /api/v1/settings` — returns all settings as `{ items: [...] }`
- `PUT /api/v1/settings` — upserts a single key-value pair
- Both routes protected by `authMiddleware`
- No changes needed to this file

**`apps/api/src/services/auth.service.ts` (current):**
- `login()` reads `display_name` from settings on first-login auto-provision
- The `display_name` setting stored by `POST /api/v1/setup/initialize` will be picked up automatically — no changes needed

**`apps/api/tests/integration/auth.test.ts` (current):**
- `beforeEach` clears `users`, `settings`, and KV sessions + rate limit key
- Pattern: `app.request(path, options, env)` with `env` as third arg
- 30s timeouts on argon2 paths

### Files to Create

All under `apps/api/`:
- `src/schemas/setup.schema.ts` — NEW
- `src/routes/setup.ts` — NEW
- `tests/integration/setup.test.ts` — NEW
- `tests/integration/health.test.ts` — NEW
- `tests/integration/settings.test.ts` — NEW (deferred from Story 1.5)

### Files to Update

- `apps/api/src/routes/health.ts` — enhance response schema and handler for D1/KV/R2 connectivity checks
- `apps/api/src/index.ts` — mount `setupRouter`
- `apps/api/tests/integration/auth.test.ts` — update `"keeps health route public"` test to match new health response shape (Task 2.8)

### Files NOT to Change

- `src/db/schema/` — no new tables; setup uses existing `settings` table
- `src/db/migrations/` — no new migration needed
- `src/services/auth.service.ts` — no changes; already reads `display_name` from settings
- `src/routes/settings.ts` — no changes; already implements GET/PUT settings
- `src/middleware/auth.ts` — no changes
- `src/lib/kv.ts` — no changes
- `src/lib/crypto.ts` — no changes
- `wrangler.toml` — no changes

### Anti-Patterns to Avoid

- ❌ Applying `authMiddleware` to setup routes — they must be public
- ❌ Storing `seed_categories` as a boolean in settings — the settings table is TEXT; store `"true"` or `"false"`
- ❌ Creating categories in Story 1.6 — only store the `seed_categories_on_first_use` flag; Epic 2 handles actual category creation
- ❌ Returning HTTP 503 from the health endpoint — always return 200; use the `status` field in the body
- ❌ Using `db.prepare()` raw SQL for the D1 health check — use Drizzle's `db.run(sql\`SELECT 1\`)` to stay consistent with the "no raw SQL" rule
- ❌ Using `db.batch()` for the four settings upserts — `db.batch()` requires raw `D1PreparedStatement` objects, not Drizzle query builders; use sequential `await` calls instead
- ❌ Using `"SETUP_ALREADY_COMPLETE"` as the error code — the global error handler maps 409 → `"CONFLICT"`; throw `new HTTPException(409, ...)` and let the handler derive the code
- ❌ Skipping the `auth.test.ts` regression fix — the existing health test expects `{ status: "ok" }` and will fail; update it in Task 2.8
- ❌ `import { Hono } from 'hono'` for route files — always use `OpenAPIHono` from `@hono/zod-openapi`
- ❌ `import { HTTPException } from 'hono'` — correct path is `'hono/http-exception'`
- ❌ Module-level `drizzle(...)` call — create per-request in handler
- ❌ Checking `setup_complete` with `=== true` (boolean) — the value is a string; check `=== 'true'`
- ❌ Omitting KV cleanup in `settings.test.ts` `beforeEach` — the login call writes to KV; clear sessions and rate limit key or tests will pollute each other

### Test Pattern for This Story

```typescript
// tests/integration/setup.test.ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { applyMigrations } from "../setup";

describe("setup routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM settings").run();
  });

  it("returns is_setup_complete: false on fresh instance", async () => {
    const res = await app.request("/api/v1/setup/status", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ is_setup_complete: false });
  });

  it("initializes setup and stores settings", async () => {
    const res = await app.request(
      "/api/v1/setup/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: "LinCie",
          base_currency: "IDR",
          seed_categories: true,
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Setup complete" });

    const rows = await db.select().from(schema.settings);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("setup_complete");
    expect(keys).toContain("display_name");
    expect(keys).toContain("base_currency");
    expect(keys).toContain("seed_categories_on_first_use");
  });

  it("returns is_setup_complete: true after initialize", async () => {
    await app.request(
      "/api/v1/setup/initialize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: "LinCie", base_currency: "IDR", seed_categories: false }),
      },
      env,
    );

    const res = await app.request("/api/v1/setup/status", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ is_setup_complete: true });
  });

  it("returns 409 if initialize is called twice", async () => {
    const body = JSON.stringify({ display_name: "LinCie", base_currency: "IDR", seed_categories: false });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    await app.request("/api/v1/setup/initialize", opts, env);
    const res = await app.request("/api/v1/setup/initialize", opts, env);
    expect(res.status).toBe(409);
    const resBody = await res.json();
    expect(resBody.error.code).toBe("CONFLICT");
  });
});
```

```typescript
// tests/integration/health.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../../src/index";
import { applyMigrations } from "../setup";

describe("health route", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it("returns healthy status with all services ok", async () => {
    const res = await app.request("/api/v1/health", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.services.d1.status).toBe("ok");
    expect(body.services.kv.status).toBe("ok");
    expect(body.services.r2.status).toBe("ok");
  });

  it("is accessible without auth token", async () => {
    const res = await app.request("/api/v1/health", {}, env);
    expect(res.status).toBe(200);
  });
});
```

### Previous Story Learnings (from Stories 1.4–1.5)

- **`OpenAPIHono` is the base class** — not `Hono`. All route files use `new OpenAPIHono<{ Bindings: Env }>()` (or with `Variables` if userId is needed).
- **`authMiddleware` applied via `router.use(path, middleware)`** — not globally. Setup routes must NOT have this applied.
- **`c.req.valid('json')` requires the route to declare a JSON body schema** — ensure `setupInitializeRoute` has `request.body` defined.
- **`drizzle(c.env.DB)` per request** — never module-level.
- **`errorResponseSchema` from `common.schema.ts`** — import for error response shapes in route definitions.
- **`HTTPException` import path** — `'hono/http-exception'`, not `'hono'`.
- **Integration tests use `app.request(path, options, env)` with `env` as third arg** — required for `c.env` bindings to work.
- **`onConflictDoUpdate` for settings upsert** — established pattern from `settings.ts`; use the same approach.
- **`ctx.waitUntil()` try/catch** — established in `health.ts`; preserve it when updating the handler.
- **`z` import in non-auth schema files** — use `import { z } from "zod"` (not `@hono/zod-openapi`).
- **Review finding from 1.3:** `notFound` handler and `defaultHook` bypass `errorResponseSchema.parse()` — use `safeParse` with fallback to avoid throwing inside error paths (already handled in `index.ts`).

### Latest Tech Information

Verified against installed versions (2026-05-28):

- **`drizzle-orm` v0.36.4**: `db.run(sql\`SELECT 1\`)` executes a raw SQL statement. `sql` is a tagged template literal exported from `drizzle-orm`. `db.run()` returns a `D1Result` — no need to inspect the result for the health check.
- **`@cloudflare/workers-types`**: `R2Bucket.head(key: string): Promise<R2Object | null>` — returns null for missing keys, throws on connectivity failure. `KVNamespace.get(key: string): Promise<string | null>` — same pattern.
- **`hono` v4.12.23**: `createRoute()` from `@hono/zod-openapi`. `z.enum(["healthy", "degraded"])` for the status field.
- **`@hono/zod-openapi` v1.4.0**: Route response schemas with `z.object()` are fully supported. Nested objects in response schemas work correctly.
- **`vitest` v4.1.7** with **`@cloudflare/vitest-pool-workers` v0.16.10**: In the Miniflare test environment, all three bindings (D1, KV, R2) are available and functional. The health check test should pass with `"healthy"` status in the test environment.

## Dev Agent Record

### Agent Model Used

GPT-5.4 Mini

### Debug Log References

- `bun run check-types` from repo root
- `bun run lint` from repo root
- `bun run test --run` from `apps/api/`
- `bunx vitest --run tests/integration/setup.test.ts tests/integration/settings.test.ts tests/integration/middleware.test.ts --reporter=verbose` for isolated verification while tightening test assertions

### Completion Notes List

- Added public setup status and initialize endpoints backed by the existing `settings` table.
- Expanded the health route to probe D1, KV, and R2 and return `healthy` or `degraded` with per-service status.
- Added integration coverage for setup, health, and settings flows, and updated the existing health assertions in `auth.test.ts` and `middleware.test.ts`.
- Verified `bun run check-types`, `bun run lint`, and `bun run test --run` all pass.
- Validation-error tests now assert status and response content rather than a fixed code on the request-body validation path.

### File List

- `apps/api/src/schemas/setup.schema.ts`
- `apps/api/src/routes/setup.ts`
- `apps/api/src/routes/health.ts`
- `apps/api/src/index.ts`
- `apps/api/tests/integration/setup.test.ts`
- `apps/api/tests/integration/health.test.ts`
- `apps/api/tests/integration/settings.test.ts`
- `apps/api/tests/integration/auth.test.ts`
- `apps/api/tests/integration/middleware.test.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-05-28: Story 1.6 created by create-story workflow; status set to ready-for-dev
- 2026-05-29: Implemented setup wizard routes, expanded health checks, added integration coverage, and marked Story 1.6 complete
- 2026-05-29: Code review completed

### Review Findings

- [x] [Review][Patch] Health endpoint leaks raw infrastructure error messages to unauthenticated callers [apps/api/src/routes/health.ts — each catch block's `message` assignment]
- [x] [Review][Patch] `display_name` has no maximum length validation — `z.string().min(1)` only; arbitrarily large strings accepted [apps/api/src/schemas/setup.schema.ts — `setupInitializeRequestSchema.display_name`]
- [x] [Review][Patch] `executionCtx.waitUntil` catch block swallows all errors, not just the test-environment case — comment says "suppress that specific case" but code is unconditional [apps/api/src/routes/health.ts — executionCtx try/catch]
- [x] [Review][Defer] TOCTOU race condition on `POST /initialize` — two concurrent requests can both pass the `setup_complete` guard before either writes it; D1 has no transaction support for Drizzle query builders and the app is single-owner, so risk is acceptable — deferred, pre-existing architectural constraint
- [x] [Review][Defer] `POST /api/v1/setup/initialize` is unauthenticated and can be hijacked before the owner completes setup — protecting it requires a pre-shared secret or one-time token, out of scope for this story — deferred, architectural decision
- [x] [Review][Defer] No timeout on D1/KV/R2 health-check probes — hanging service calls can block the health endpoint for the Workers wall-clock limit — deferred, pre-existing Workers pattern gap
