# Story 1.3: Global Middleware & Error Handling

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want consistent error handling, input validation, CORS, and OpenAPI route patterns established,
so that every subsequent route follows the same conventions without per-route boilerplate.

## Acceptance Criteria

1. **AC-1 Global error handler — unhandled errors:** When any route throws an unhandled error, `app.onError()` returns `{ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } }` with status 500. Stack traces and internal details are never sent to the client. The error is logged server-side via `console.error(JSON.stringify({ level: "error", action: "unhandled_error", error: err.message }))`. [Source: epics.md#Story-1.3, architecture.md#Error-Handling]

2. **AC-2 Global error handler — HTTPException passthrough:** When a route throws a Hono `HTTPException`, the error handler returns the exception's status code and message wrapped in the standard error shape `{ error: { code, message } }`. This allows service-layer business rule violations to propagate correctly. [Source: architecture.md#Error-Handling]

3. **AC-3 Validation error shape:** When `@hono/zod-openapi` rejects a request due to Zod validation failure, the response is `{ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: [...] } }` with status 400. [Source: epics.md#Story-1.3, architecture.md#API-Communication-Patterns]

4. **AC-4 CORS middleware:** The Hono `cors()` middleware is registered globally in `src/index.ts` before all routes. Only the configured frontend origin is allowed (read from `env.CORS_ORIGIN` or a hardcoded placeholder for now). [Source: epics.md#Story-1.3, architecture.md#Authentication-Security]

5. **AC-5 OpenAPI route pattern demonstrated:** At least one example route (a health check or a stub route) is implemented using `createRoute()` from `@hono/zod-openapi` with a full route definition object (method, path, request schema, responses schema) separate from the handler function. This establishes the pattern for all future routes. [Source: epics.md#Story-1.3, architecture.md#API-Communication-Patterns]

6. **AC-6 `ctx.waitUntil()` pattern demonstrated:** The example route or a test demonstrates calling `ctx.waitUntil(promise)` to perform non-blocking post-response work. The response is sent immediately and the background work completes asynchronously. [Source: epics.md#Story-1.3, architecture.md#Infrastructure-Deployment]

7. **AC-7 404 handler:** `app.notFound()` returns `{ error: { code: "NOT_FOUND", message: "Route not found" } }` with status 404. [Source: architecture.md#Error-Handling, deferred-work.md]

8. **AC-8 Error handler lives in `src/middleware/error-handler.ts`:** The `onError` callback is defined and exported from `src/middleware/error-handler.ts`, then registered in `src/index.ts` via `app.onError(errorHandler)`. [Source: architecture.md#Project-Structure]

9. **AC-9 Type-check and lint pass:** `bun run check-types` and `bun run lint` both exit 0 after all changes. [Source: architecture.md#Implementation-Patterns]

10. **AC-10 Integration test for error handler:** A test in `tests/integration/middleware.test.ts` verifies: (a) an unhandled error returns 500 with the standard error shape, (b) a validation error returns 400 with `VALIDATION_ERROR` code, (c) a 404 returns the standard not-found shape. [Source: architecture.md#Test-Organization]

## Tasks / Subtasks

- [x] **Task 1: Create global error handler middleware** (AC: 1, 2, 8)
  - [x] 1.1 Create `apps/api/src/middleware/error-handler.ts`
  - [x] 1.2 Import `HTTPException` from `hono/http-exception` and `Context` from `hono`
  - [x] 1.3 Export `errorHandler` function with signature `(err: Error, c: Context): Response`
  - [x] 1.4 If `err instanceof HTTPException`: return `c.json({ error: { code: deriveCode(err.status), message: err.message } }, err.status)`
  - [x] 1.5 For all other errors: log via `console.error(JSON.stringify({ level: "error", action: "unhandled_error", error: err.message }))` then return `c.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } }, 500)`
  - [x] 1.6 Helper `deriveCode(status: number): string` maps common HTTP status codes to error code strings (401 → `"UNAUTHORIZED"`, 403 → `"FORBIDDEN"`, 404 → `"NOT_FOUND"`, 409 → `"CONFLICT"`, 422 → `"VALIDATION_ERROR"`, 429 → `"RATE_LIMITED"`, default → `"INTERNAL_ERROR"`)

- [x] **Task 2: Register middleware and handlers in `src/index.ts`** (AC: 3, 4, 7, 8)
  - [x] 2.1 Import `cors` from `hono/cors`
  - [x] 2.2 Import `errorHandler` from `./middleware/error-handler`
  - [x] 2.3 Add `defaultHook` to the `OpenAPIHono` constructor to intercept validation errors (see Dev Notes — this is the preferred pattern, not duck-typing in `onError`)
  - [x] 2.4 Register CORS: `app.use('*', (c, next) => cors({ origin: c.env.CORS_ORIGIN ?? '*' })(c, next))` — must read from `c.env`, not module-level (see Dev Notes)
  - [x] 2.5 Register `app.onError(errorHandler)`
  - [x] 2.6 Register `app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404))`
  - [x] 2.7 Remove the existing `app.get("/", ...)` stub — it uses `app.get()` which is inconsistent with the OpenAPI pattern this story establishes. The health route (Task 4) replaces it.

- [x] **Task 3: Add `CORS_ORIGIN` to the `Env` type** (AC: 4)
  - [x] 3.1 `CORS_ORIGIN` is an optional env var (not a secret). Add it to `wrangler.toml` under `[vars]` as `CORS_ORIGIN = ""` (empty string default for local dev).
  - [x] 3.2 Run `wrangler types` from `apps/api/` to regenerate `worker-configuration.d.ts`. Verify `CORS_ORIGIN?: string` appears in the generated `Env` interface.
  - [x] 3.3 **Do NOT create or edit `src/types/env.ts` manually** — the `Env` type is a global ambient interface generated by `wrangler types` into `worker-configuration.d.ts` at the project root. That file is the source of truth. `src/types/` is currently empty and will be populated in later stories.

- [x] **Task 4: Demonstrate OpenAPI route pattern with `createRoute()`** (AC: 5, 6)
  - [x] 4.1 Create `apps/api/src/routes/health.ts`
  - [x] 4.2 Define a `healthRoute` using `createRoute()` with method `"get"`, path `"/api/v1/health"`, no request schema, and a 200 response schema (Zod object with `status: z.string()`)
  - [x] 4.3 Implement the handler: return `{ status: "ok" }` — this is a stub; the full D1/R2/KV connectivity check is Story 1.6
  - [x] 4.4 Demonstrate `ctx.waitUntil()` in the handler: `c.executionCtx.waitUntil(Promise.resolve())` — a no-op that establishes the pattern
  - [x] 4.5 Export a `healthRouter` (`new OpenAPIHono<{ Bindings: Env }>()`) and mount the route on it
  - [x] 4.6 Mount `healthRouter` in `src/index.ts` via `app.route('/', healthRouter)`

- [x] **Task 5: Create shared error response schema** (AC: 3)
  - [x] 5.1 Create `apps/api/src/schemas/common.schema.ts` — this is the first file in `src/schemas/` (directory exists with `.gitkeep`)
  - [x] 5.2 Define and export the shared error response Zod schema:
    ```typescript
    import { z } from "zod";
    export const errorResponseSchema = z.object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      }),
    });
    export type ErrorResponse = z.infer<typeof errorResponseSchema>;
    ```
  - [x] 5.3 Use `errorResponseSchema` in the `defaultHook` and `errorHandler` for consistent typing. The `details` field is only present on validation errors.

- [x] **Task 6: Write integration tests** (AC: 10)
  - [x] 6.1 Create `apps/api/tests/integration/middleware.test.ts`
  - [x] 6.2 Do NOT call `applyMigrations` — these tests don't touch the database. The test app is self-contained.
  - [x] 6.3 Create a minimal `testApp` using `new OpenAPIHono<{ Bindings: Env }>()` with `defaultHook`, `onError`, and `notFound` wired up (mirrors production setup)
  - [x] 6.4 Test: route that throws `new Error("boom")` → GET returns 500 with `{ error: { code: "INTERNAL_ERROR", ... } }`
  - [x] 6.5 Test: route that throws `new HTTPException(401, { message: "Unauthorized" })` → returns 401 with `{ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }`
  - [x] 6.6 Test: GET `/api/v1/health` (import and use the real `healthRouter`) → returns 200 with `{ status: "ok" }`
  - [x] 6.7 Test: GET `/nonexistent` → returns 404 with `{ error: { code: "NOT_FOUND", ... } }`
  - [x] 6.8 Run `bun run test --run` from `apps/api/` — all tests pass

- [x] **Task 7: Verification gate** (AC: 9)
  - [x] 7.1 `bun run check-types` from repo root — must exit 0
  - [x] 7.2 `bun run lint` from repo root — must exit 0
  - [x] 7.3 `bun run test --run` from `apps/api/` — all tests pass (including schema tests from Story 1.2)
  - [x] 7.4 Update Dev Agent Record with file list and any deviations

## Dev Notes

### Critical Architecture Constraints

**`OpenAPIHono` is the base app class — not `Hono`:**
`src/index.ts` already uses `new OpenAPIHono<{ Bindings: Env }>()`. All route files must also use `OpenAPIHono`, not `Hono`. The `createRoute()` function from `@hono/zod-openapi` only works with `OpenAPIHono`.

**`@hono/zod-openapi` validation error interception — use `defaultHook`:**
The preferred pattern for `@hono/zod-openapi` v1.4.0 is to pass a `defaultHook` to the `OpenAPIHono` constructor to intercept validation errors before they reach `onError`:

```typescript
// src/index.ts
const app = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: result.error.issues } },
        400
      );
    }
  },
});
```

This is cleaner than duck-typing in `onError`. Use this approach.

**CORS in Cloudflare Workers — env is per-request:**
In Workers, `Env` bindings (D1, KV, R2, secrets) are available on `c.env`, not as module-level globals. The `cors()` middleware from `hono/cors` accepts a factory function or a static origin. To read `CORS_ORIGIN` from the environment:

```typescript
app.use('*', (c, next) => {
  return cors({ origin: c.env.CORS_ORIGIN ?? '*' })(c, next);
});
```

Do NOT do `import { env } from 'cloudflare:test'` in production code — that's test-only.

**`ctx.waitUntil()` in Hono:**
In Hono on Workers, `ctx.waitUntil()` is accessed via `c.executionCtx.waitUntil(promise)`. The `executionCtx` is the `ExecutionContext` passed to the `fetch()` handler. `OpenAPIHono` exposes it on the context object.

**HTTPException import path:**
```typescript
import { HTTPException } from "hono/http-exception";
```
Not from `hono` directly. This is the correct import for Hono v4.

**Error handler signature for `OpenAPIHono`:**
```typescript
import type { Context } from "hono";
export const errorHandler = (err: Error, c: Context): Response => { ... }
```

**`createRoute()` pattern:**
```typescript
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

const healthRoute = createRoute({
  method: "get",
  path: "/api/v1/health",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
      description: "Health check response",
    },
  },
});

export const healthRouter = new OpenAPIHono<{ Bindings: Env }>();

healthRouter.openapi(healthRoute, (c) => {
  c.executionCtx.waitUntil(Promise.resolve()); // establishes ctx.waitUntil() pattern
  return c.json({ status: "ok" }, 200);
});
```

**Route mounting in `src/index.ts`:**
```typescript
app.route("/", healthRouter);
```

**`src/middleware/` directory is empty** — this story creates the first file there. The directory already exists from Story 1.1 scaffold.

**`src/routes/` directory is empty** — this story creates `health.ts` as the first route file.

### Deferred Work Addressed

From `deferred-work.md`:
- "No global error handler or 404 handler on the Hono app — Story 1.3 is the correct place for this." ✅ Addressed by AC-1, AC-7, AC-8.

### What Story 1.3 Does NOT Do

- Does NOT implement the full health check with D1/R2/KV connectivity — that is Story 1.6.
- Does NOT implement auth middleware — that is Story 1.4.
- Does NOT implement rate limiting middleware — that is Story 1.5.
- Does NOT add `CORS_ORIGIN` as a wrangler secret — it's an optional env var; the middleware falls back to `'*'` if absent.

### Existing Code State (from Stories 1.1 & 1.2)

**`apps/api/src/index.ts` (current):**
```typescript
import { OpenAPIHono } from "@hono/zod-openapi";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ name: "bearuang-api", version: "0.1.0" });
});

export default app;
```
This file must be updated to add `defaultHook`, CORS, `onError`, `notFound`, and route mounting. **Remove the existing `app.get("/", ...)` stub** — it uses `app.get()` which is inconsistent with the OpenAPI pattern this story establishes. The health route mounted via `app.route('/', healthRouter)` replaces it.

**`apps/api/src/db/schema/index.ts`** — barrel export for `users` and `settings` tables. No changes needed.

**`apps/api/tests/setup.ts`** — exports `getTestEnv()`, `applyMigrations()`, `seedUser()`. Use `applyMigrations()` in new test files.

**`apps/api/tests/fixtures/factories.ts`** — exports `userFactory()` and `settingsFactory()`. No changes needed.

### Test Pattern for This Story

```typescript
// tests/integration/middleware.test.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { describe, it, expect } from "vitest";
import { errorHandler } from "../../src/middleware/error-handler";
import { healthRouter } from "../../src/routes/health";

describe("global middleware", () => {
  // No applyMigrations needed — these tests don't touch the database.
  // Create a minimal test app that mirrors the real app's middleware setup.
  const testApp = new OpenAPIHono<{ Bindings: Env }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: result.error.issues } },
          400
        );
      }
    },
  });
  testApp.onError(errorHandler);
  testApp.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404));
  testApp.route("/", healthRouter);

  // Add test-only error routes
  testApp.get("/test/error", () => { throw new Error("boom"); });
  testApp.get("/test/http-exception", () => { throw new HTTPException(401, { message: "Unauthorized" }); });

  it("returns 500 for unhandled errors", async () => {
    const res = await testApp.request("/test/error");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns correct status for HTTPException", async () => {
    const res = await testApp.request("/test/http-exception");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 for health route", async () => {
    const res = await testApp.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await testApp.request("/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
```

### Anti-Patterns to Avoid

- ❌ `import { Hono } from 'hono'` for route files — always use `OpenAPIHono` from `@hono/zod-openapi`
- ❌ `app.use(cors({ origin: process.env.CORS_ORIGIN }))` — `process.env` is not available in Workers; use `c.env`
- ❌ Exposing `err.stack` or raw error messages from non-HTTPException errors to the client
- ❌ Putting business logic in the error handler — it should only format and log
- ❌ Using `app.get()` for routes that need OpenAPI spec — use `app.openapi(createRoute(...), handler)` instead
- ❌ `import { HTTPException } from 'hono'` — correct path is `'hono/http-exception'`

### Project Structure Notes

All directories (`src/middleware/`, `src/routes/`, `src/schemas/`, `src/lib/`, `src/services/`, `src/types/`) already exist from Story 1.1 scaffold with `.gitkeep` files. No `mkdir` needed.

Files to create (all under `apps/api/`):
- `src/middleware/error-handler.ts` — NEW (first file in `src/middleware/`)
- `src/routes/health.ts` — NEW (first file in `src/routes/`)
- `src/schemas/common.schema.ts` — NEW (first file in `src/schemas/`; defines shared `errorResponseSchema`)

Files to update:
- `src/index.ts` — add `defaultHook`, CORS middleware, `onError`, `notFound`, route mounting; **remove** the `app.get("/", ...)` stub
- `wrangler.toml` — add `CORS_ORIGIN = ""` under `[vars]`, then run `wrangler types` to regenerate `worker-configuration.d.ts`

**Do NOT create or edit `src/types/env.ts` manually.** The `Env` type is a global ambient interface generated by `wrangler types` into `worker-configuration.d.ts` at the project root. `src/types/` is currently empty (`.gitkeep` only) and will be populated in later stories.

Files to create (tests):
- `tests/integration/middleware.test.ts` — NEW

No changes to: `package.json`, `drizzle.config.ts`, `vitest.config.ts`, schema files, or migration files.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3-Global-Middleware-Error-Handling]
- [Source: _bmad-output/planning-artifacts/architecture.md#Error-Handling]
- [Source: _bmad-output/planning-artifacts/architecture.md#API-Communication-Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication-Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project-Structure-Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation-Patterns-Consistency-Rules]
- [Source: _bmad-output/implementation-artifacts/1-2-database-schema-migration-workflow.md#Dev-Agent-Record]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- [Source: AGENTS.md (bun package manager rules)]

## Latest Tech Information

Verified against installed versions (2026-05-28):

- **`@hono/zod-openapi` v1.4.0**: Uses `OpenAPIHono` as the base class. `createRoute()` defines route metadata. Routes are registered via `app.openapi(route, handler)`. The `defaultHook` option on the constructor is the correct way to intercept validation errors — it receives `(result: SafeParseReturnType, c: Context)` and should return a `Response` when `!result.success`.
- **`hono` v4.12.23**: `HTTPException` is imported from `'hono/http-exception'`. `cors` is imported from `'hono/cors'`. `app.onError(handler)` and `app.notFound(handler)` are the correct registration methods.
- **`zod` v4.4.3**: Zod 4 is installed (bumped in Story 1.1 to satisfy `@hono/zod-openapi` peer dep). Use Zod 4 API — `z.object()`, `z.string()`, etc. are unchanged. Error `.issues` array shape is the same.
- **`vitest` v4.1.7** with **`@cloudflare/vitest-pool-workers` v0.16.10**: Tests run in Workers runtime. Use `applyMigrations()` from `tests/setup.ts` in `beforeAll` only when a test file actually queries D1. This story's middleware tests are self-contained and do not need DB access — omit `applyMigrations` from `middleware.test.ts`.

## Dev Agent Record

### Agent Model Used

- GPT-5 Codex

### Debug Log References

- `cd apps/api && bun run test --run tests/integration/middleware.test.ts` (initial red phase failed with missing module; passed after implementation)
- `cd apps/api && bun run cf:types` (regenerated `worker-configuration.d.ts` with `CORS_ORIGIN` binding)
- `cd /home/hebot/bearuang && bun run check-types` (pass)
- `cd /home/hebot/bearuang && bun run lint` (pass)
- `cd apps/api && bun run test --run` (pass, 3 files / 8 tests)

### Completion Notes List

- Implemented global `errorHandler` middleware with `HTTPException` passthrough and standardized 500 fallback payload/logging.
- Added shared `errorResponseSchema` and used it in both `defaultHook` validation responses and `errorHandler` outputs.
- Updated app bootstrap to use `defaultHook`, global CORS middleware using `c.env.CORS_ORIGIN`, `app.onError(errorHandler)`, `app.notFound(...)`, and mounted `healthRouter`.
- Added OpenAPI health route with `createRoute()` and `c.executionCtx.waitUntil(Promise.resolve())` pattern demonstration.
- Added integration middleware coverage for unhandled error, `HTTPException`, validation error shape, health route success, and 404 response.
- Added `CORS_ORIGIN = ""` in `wrangler.toml` and regenerated Worker types via Wrangler.
- Note: current Wrangler type generation emits `CORS_ORIGIN` as a literal var binding type (not optional) when `[vars]` is declared at top-level with strict vars enabled.
- Updated `tests/setup.ts` typing to satisfy repository lint constraints required by AC-9 verification gate.

### File List

- apps/api/src/index.ts
- apps/api/src/middleware/error-handler.ts
- apps/api/src/routes/health.ts
- apps/api/src/schemas/common.schema.ts
- apps/api/tests/integration/middleware.test.ts
- apps/api/tests/setup.ts
- apps/api/worker-configuration.d.ts
- apps/api/wrangler.toml
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/1-3-global-middleware-error-handling.md

### Change Log

- 2026-05-28: Implemented Story 1.3 global middleware/error handling, OpenAPI health route, CORS env binding, integration tests, and verification gate updates; status moved to `review`.

### Review Findings

- [x] [Review][Patch] Wildcard CORS fallback allows any origin when CORS_ORIGIN is unset [apps/api/src/index.ts:25]
- [x] [Review][Patch] `errorResponseSchema.parse()` inside error handler can throw, masking original error [apps/api/src/middleware/error-handler.ts:19,38]
- [x] [Review][Patch] `err.message` may be undefined for non-Error throws; log entry silently drops `error` field [apps/api/src/middleware/error-handler.ts:26]
- [x] [Review][Patch] `deriveCode` missing 400 and other client-error codes; 422 conflates HTTPException with Zod errors [apps/api/src/middleware/error-handler.ts:5]
- [x] [Review][Patch] `waitUntil` try/catch swallows all errors, not just missing-ExecutionContext TypeError [apps/api/src/routes/health.ts:22]
- [x] [Review][Patch] `notFound` handler bypasses `errorResponseSchema`, can silently diverge from error contract [apps/api/src/index.ts:31]
- [x] [Review][Patch] `defaultHook` accesses `result.error.issues` without null guard [apps/api/src/index.ts:13]
- [x] [Review][Defer] Log injection risk: err.message is user-controlled and embedded in manually-built JSON string [apps/api/src/middleware/error-handler.ts:26] — deferred, pre-existing
- [x] [Review][Defer] err.stack never logged in unhandled error path, making production debugging harder [apps/api/src/middleware/error-handler.ts:26] — deferred, pre-existing
- [x] [Review][Defer] Test app duplicates production middleware wiring instead of importing real app [apps/api/tests/integration/middleware.test.ts] — deferred, pre-existing
