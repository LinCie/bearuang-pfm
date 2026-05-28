# Story 1.5: Authentication — Password Change & Rate Limiting

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the app owner,
I want to change my password and be protected from brute-force login attempts,
So that my financial data remains secure even if the initial password was weak.

## Acceptance Criteria

1. **AC-1 Change password — success:** When `POST /api/v1/auth/change-password` is called with a valid session and correct `current_password` and a non-empty `new_password`, the new password is hashed (argon2id or PBKDF2 fallback) and stored in D1, replacing the previous hash. All existing sessions for the user remain valid (no forced logout). The response is `{ "message": "Password changed successfully" }` with status 200. [Source: epics.md#Story-1.5]

2. **AC-2 Change password — wrong current password:** When `POST /api/v1/auth/change-password` is called with an incorrect `current_password`, the response is `{ error: { code: "UNAUTHORIZED", message: "Current password is incorrect" } }` with status 401. [Source: epics.md#Story-1.5]

3. **AC-3 Change password — validation:** When `POST /api/v1/auth/change-password` is called with a missing or empty `new_password`, the response is a validation error with status 400. [Source: epics.md#Story-1.5, architecture.md#Process-Patterns]

4. **AC-4 Rate limiting — lockout after 5 failures:** When 5 failed login attempts occur within 15 minutes (from any source), the 6th attempt returns `{ error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again in 15 minutes." } }` with status 429. The lockout persists for 15 minutes regardless of whether subsequent credentials are correct. [Source: epics.md#Story-1.5, architecture.md#Authentication-Security]

5. **AC-5 Rate limiting — counter resets after window:** When the 15-minute rate limit window expires, a login attempt with correct credentials succeeds normally and the counter resets. [Source: epics.md#Story-1.5]

6. **AC-6 Rate limiting — successful login does not increment counter:** A successful login does not increment the failure counter. Only failed login attempts (wrong password or wrong INITIAL_PASSWORD) increment the counter. [Source: epics.md#Story-1.5]

7. **AC-7 Session timeout setting:** When `PUT /api/v1/settings` updates the `session_timeout` key with a valid integer value (seconds), new sessions created after that point use the updated TTL. Existing sessions retain their original TTL until they are refreshed. [Source: epics.md#Story-1.5]

8. **AC-8 Settings GET endpoint:** When `GET /api/v1/settings` is called with a valid session, all current settings key-value pairs are returned as `{ "items": [{ "key": "...", "value": "...", "updated_at": "..." }] }`. [Source: epics.md#Story-1.6 — settings endpoints are shared infrastructure, implemented here as they are needed for session_timeout]

9. **AC-9 Type-check and lint pass:** `bun run check-types` and `bun run lint` both exit 0. [Source: architecture.md#Implementation-Patterns]

10. **AC-10 Integration tests:** `tests/integration/auth.test.ts` is extended with tests covering: change password success, change password wrong current password → 401, change password missing new_password → 400, rate limiting lockout after 5 failures → 429, rate limit window expiry allows login. [Source: architecture.md#Test-Organization]

## Tasks / Subtasks

- [x] **Task 1: Create `src/lib/rate-limit.ts` and `src/middleware/rate-limit.ts`** (AC: 4, 5, 6)
  - [x] 1.1 Create `apps/api/src/lib/rate-limit.ts` — KV counter helpers (pure functions, no Hono dependency)
  - [x] 1.2 In `lib/rate-limit.ts`, define and export:
    - `RATE_LIMIT_MAX_ATTEMPTS = 5`
    - `RATE_LIMIT_WINDOW_SECONDS = 900` (15 minutes)
    - `RATE_LIMIT_KEY = "rate_limit:login:global"` — single global key (single-user app, no per-IP needed)
    - `getRateLimitCount(kv: KVNamespace, key: string): Promise<number>` — `kv.get(key)` → parse as integer, return 0 if null
    - `incrementRateLimitCount(kv: KVNamespace, key: string, windowSeconds: number): Promise<number>` — get current count, increment, `kv.put(key, String(newCount), { expirationTtl: windowSeconds })`, return new count
    - `resetRateLimitCount(kv: KVNamespace, key: string): Promise<void>` — `kv.delete(key)`
  - [x] 1.3 Create `apps/api/src/middleware/rate-limit.ts` — imports helpers from `../lib/rate-limit`
  - [x] 1.4 In `middleware/rate-limit.ts`, export `rateLimitMiddleware` using `createMiddleware<{ Bindings: Env }>` from `hono/factory`:
    ```typescript
    import { createMiddleware } from "hono/factory";
    import { HTTPException } from "hono/http-exception";
    import { getRateLimitCount, RATE_LIMIT_KEY, RATE_LIMIT_MAX_ATTEMPTS } from "../lib/rate-limit";

    export const rateLimitMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
      const count = await getRateLimitCount(c.env.SESSIONS, RATE_LIMIT_KEY);
      if (count >= RATE_LIMIT_MAX_ATTEMPTS) {
        throw new HTTPException(429, { message: "Too many login attempts. Try again in 15 minutes." });
      }
      await next();
    });
    ```
  - [x] 1.5 **IMPORTANT:** `lib/rate-limit.ts` must NOT import from `services/` or `routes/` (eslint enforced). `middleware/rate-limit.ts` imports from `lib/rate-limit.ts`. `services/auth.service.ts` imports from `lib/rate-limit.ts`. This respects the architecture layering.
  - [x] 1.6 **IMPORTANT:** The middleware only CHECKS the count. The login service is responsible for INCREMENTING on failure and RESETTING on success.

- [x] **Task 2: Update `src/services/auth.service.ts`** (AC: 4, 5, 6)
  - [x] 2.1 Add imports from `../lib/rate-limit` (NOT from `../middleware/rate-limit`):
    ```typescript
    import { incrementRateLimitCount, resetRateLimitCount, RATE_LIMIT_KEY, RATE_LIMIT_WINDOW_SECONDS } from "../lib/rate-limit";
    ```
  - [x] 2.2 Update `login()` signature to accept optional `ttlSeconds?: number` parameter (for Task 5): `login(db, kv, env, password, ttlSeconds?)`
  - [x] 2.3 In the `login()` function, after a failed password check (both the no-user path and the existing-user path), call `await incrementRateLimitCount(kv, RATE_LIMIT_KEY, RATE_LIMIT_WINDOW_SECONDS)` before throwing the 401
  - [x] 2.4 In the `login()` function, after a successful login (just before returning the token), call `await resetRateLimitCount(kv, RATE_LIMIT_KEY)` to clear the counter
  - [x] 2.5 Pass `ttlSeconds` to `createSession(kv, userId, ttlSeconds)` so the session uses the configured TTL
  - [x] 2.6 Add `changePassword(db: DrizzleD1Database, userId: string, currentPassword: string, newPassword: string): Promise<void>` — pure function, no kv needed
  - [x] 2.7 `changePassword` logic:
    - Query user by `userId` from `users` table
    - If not found or `is_active !== 1`, throw `new HTTPException(401, { message: "Unauthorized" })`
    - Call `verifyPassword(currentPassword, user.password_hash)` — if false, throw `new HTTPException(401, { message: "Current password is incorrect" })`
    - Call `hashPassword(newPassword)` to get new hash
    - `db.update(users).set({ password_hash: newHash }).where(eq(users.id, userId))`
    - Return void (no sessions invalidated — existing sessions remain valid per AC-1)

- [x] **Task 3: Update `src/routes/auth.ts`** (AC: 1, 2, 3, 4)
  - [x] 3.1 Add `changePasswordRequestSchema` to `src/schemas/auth.schema.ts`:
    ```typescript
    export const changePasswordRequestSchema = z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(1),
    });
    export const changePasswordResponseSchema = z.object({
      message: z.string(),
    });
    ```
  - [x] 3.2 In `src/routes/auth.ts`, define `changePasswordRoute` with `createRoute()`:
    - `method: "post"`, `path: "/api/v1/auth/change-password"`
    - Request body: `changePasswordRequestSchema`
    - Responses: 200 `changePasswordResponseSchema`, 400 `errorResponseSchema`, 401 `errorResponseSchema`
  - [x] 3.3 Apply `authMiddleware` to the change-password route: `authRouter.use("/api/v1/auth/change-password", authMiddleware)`
  - [x] 3.4 Add handler: extract `userId` from `c.get("userId")`, call `changePassword(drizzle(c.env.DB), userId, current_password, new_password)`, return `c.json({ message: "Password changed successfully" }, 200)`
  - [x] 3.5 Apply `rateLimitMiddleware` to the login route: `authRouter.use("/api/v1/auth/login", rateLimitMiddleware)` — add this BEFORE the existing `authRouter.openapi(loginRoute, ...)` handler registration
  - [x] 3.6 Import `rateLimitMiddleware` from `../middleware/rate-limit`

- [x] **Task 4: Create `src/routes/settings.ts`** (AC: 7, 8)
  - [x] 4.1 Create `apps/api/src/schemas/settings.schema.ts`:
    ```typescript
    export const settingsItemSchema = z.object({
      key: z.string(),
      value: z.string(),
      updated_at: z.string(),
    });
    export const settingsListResponseSchema = z.object({
      items: z.array(settingsItemSchema),
    });
    export const updateSettingsRequestSchema = z.object({
      key: z.string().min(1),
      value: z.string(),
    });
    export const updateSettingsResponseSchema = settingsItemSchema;
    ```
  - [x] 4.2 Create `apps/api/src/routes/settings.ts` using `OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>`
  - [x] 4.3 Define `getSettingsRoute` (`GET /api/v1/settings`) and `updateSettingsRoute` (`PUT /api/v1/settings`)
  - [x] 4.4 Apply `authMiddleware` to both routes
  - [x] 4.5 `GET /api/v1/settings` handler: `db.select().from(settings)` → return `{ items: rows }`
  - [x] 4.6 `PUT /api/v1/settings` handler: upsert the key-value pair using Drizzle's `insert().values().onConflictDoUpdate()` pattern:
    ```typescript
    const now = new Date().toISOString();
    await db.insert(settings).values({ key, value, updated_at: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updated_at: now } });
    const updated = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return c.json(updated[0], 200);
    ```
  - [x] 4.7 Mount settings router in `src/index.ts`: `import { settingsRouter } from "./routes/settings"` and `app.route("/", settingsRouter)`

- [x] **Task 5: Wire session_timeout into `createSession`** (AC: 7)
  - [x] 5.1 The deferred item from Story 1.4 noted that `refreshSession` TTL is not wired to settings. This story resolves it partially: the `PUT /api/v1/settings` endpoint allows updating `session_timeout`. New sessions read this value.
  - [x] 5.2 In `src/routes/auth.ts` login handler, create a single `db` instance and read `session_timeout` before calling `login()`:
    ```typescript
    authRouter.openapi(loginRoute, async (c) => {
      const { password } = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const timeoutSetting = await db.select().from(settings)
        .where(eq(settings.key, "session_timeout")).limit(1);
      const ttl = timeoutSetting[0] ? parseInt(timeoutSetting[0].value, 10) : DEFAULT_SESSION_TTL;
      const { token } = await login(db, c.env.SESSIONS, c.env, password, isNaN(ttl) ? DEFAULT_SESSION_TTL : ttl);
      return c.json({ token }, 200);
    });
    ```
  - [x] 5.3 Import `settings` from `"../db/schema"` and `eq` from `"drizzle-orm"` and `DEFAULT_SESSION_TTL` from `"../lib/kv"` in `routes/auth.ts`
  - [x] 5.4 `login()` in `auth.service.ts` already accepts `ttlSeconds?` (added in Task 2.2) and passes it to `createSession`
  - [x] 5.5 **`session_timeout` validation note:** The `PUT /api/v1/settings` endpoint accepts any string value. `parseInt` on a non-numeric string returns `NaN` — the `isNaN()` guard in the login handler falls back to `DEFAULT_SESSION_TTL` safely. Do NOT add hard validation in the settings endpoint that would break its generic key-value nature.
  - [x] 5.6 **Note:** `refreshSession` in `authMiddleware` still uses `DEFAULT_SESSION_TTL` (1800s). This is acceptable per AC-7: "existing sessions retain their original TTL until refreshed." Full TTL threading through middleware is deferred (would require DB access in middleware).

- [x] **Task 6: Write integration tests** (AC: 10)
  - [x] 6.1 Extend `apps/api/tests/integration/auth.test.ts` with a new `describe("change password")` block
  - [x] 6.2 Test: change password with correct current password → 200 `{ message: "Password changed successfully" }`; subsequent login with new password → 200
  - [x] 6.3 Test: change password with wrong current password → 401 `UNAUTHORIZED` with message "Current password is incorrect"
  - [x] 6.4 Test: change password with empty `new_password` → 400 validation error
  - [x] 6.5 Test: change password without auth token → 401
  - [x] 6.6 Add a new `describe("rate limiting")` block
  - [x] 6.7 Test: 5 failed login attempts → 6th attempt returns 429 `RATE_LIMITED`
  - [x] 6.8 Test: successful login resets counter (login fails 4 times, succeeds once, fails again — should NOT be locked out)
  - [x] 6.9 **IMPORTANT:** Clear KV rate limit key in `beforeEach` alongside the existing session KV cleanup:
    ```typescript
    await env.SESSIONS.delete("rate_limit:login:global");
    ```
  - [x] 6.10 Run `bun run test --run` from `apps/api/` — all tests pass

- [x] **Task 7: Verification gate** (AC: 9)
  - [x] 7.1 `bun run check-types` from repo root — exit 0
  - [x] 7.2 `bun run lint` from repo root — exit 0
  - [x] 7.3 `bun run test --run` from `apps/api/` — all tests pass



### Critical Architecture Constraints

**Rate limiting is KV-based, global (not per-IP):**
Architecture specifies: "Simple KV counter on login endpoint only — not a general-purpose rate limiting framework." This is a single-user app (1-2 users). Per-IP tracking adds complexity with no benefit. Use a single global key `"rate_limit:login:global"` defined as `RATE_LIMIT_KEY` in `lib/rate-limit.ts`.

**Architecture layering — rate limit helpers live in `lib/`, not `middleware/`:**
The eslint config enforces that `lib/` cannot import from `services/` or `routes/`. The inverse (services importing from middleware) is not eslint-blocked but violates the architecture's layering intent. The correct structure:
```
lib/rate-limit.ts        ← pure KV helpers + constants (no Hono)
middleware/rate-limit.ts ← imports from lib/rate-limit, exports rateLimitMiddleware
services/auth.service.ts ← imports from lib/rate-limit (NOT from middleware/)
```

**`rateLimitMiddleware` requires `<{ Bindings: Env }>` generic:**
```typescript
export const rateLimitMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const count = await getRateLimitCount(c.env.SESSIONS, RATE_LIMIT_KEY);
  if (count >= RATE_LIMIT_MAX_ATTEMPTS) {
    throw new HTTPException(429, { message: "Too many login attempts. Try again in 15 minutes." });
  }
  await next();
});
```
Without the generic, TypeScript will error on `c.env.SESSIONS`.

**Rate limit middleware checks; service increments/resets:**
The `rateLimitMiddleware` only reads the counter and throws 429 if over limit. The `login()` service function is responsible for:
- Incrementing the counter on any failed login attempt
- Resetting the counter on successful login

This separation is intentional — the service has the context to know if a login succeeded or failed.

**`kv.put()` with `expirationTtl` resets the TTL on every increment:**
```typescript
// Each failed attempt resets the 15-minute window from NOW
await kv.put("rate_limit:login:global", String(newCount), { expirationTtl: 900 });
```
This is a sliding window, not a fixed window. The 15-minute lockout starts from the LAST failed attempt. This is acceptable per the spec ("15-minute lockout").

**`PUT /api/v1/settings` is single-key upsert (not bulk update):**
The epics spec for Story 1.6 says `PUT /api/v1/settings` accepts "valid key-value pairs" — this story implements it as a single-key upsert per request (one `{ key, value }` body). This is intentional: the settings table is low-volume and a single-key endpoint is simpler and sufficient. Do NOT implement a bulk-update endpoint.

**`onConflictDoUpdate` for settings upsert:**
Drizzle D1 supports `INSERT OR REPLACE` semantics via `.onConflictDoUpdate()`:
```typescript
await db.insert(settings)
  .values({ key, value, updated_at: now })
  .onConflictDoUpdate({
    target: settings.key,
    set: { value, updated_at: now },
  });
```
This is the correct pattern for the settings table (TEXT primary key, upsert semantics).

**`changePassword` does NOT invalidate existing sessions:**
Per AC-1: "All existing sessions for the user remain valid (no forced logout)." This is intentional — the user is already authenticated and changing their own password. Do NOT call `deleteSession` or iterate KV to invalidate sessions.

**`rateLimitMiddleware` must be registered BEFORE the `openapi()` handler:**
In Hono, middleware registered via `router.use(path, middleware)` runs before handlers registered via `router.openapi()` for the same path. The order in the file matters:
```typescript
// CORRECT order in auth.ts:
authRouter.use("/api/v1/auth/login", rateLimitMiddleware);  // 1. register middleware
authRouter.openapi(loginRoute, async (c) => { ... });       // 2. register handler
```

**`z` import in `auth.schema.ts` uses `@hono/zod-openapi`:**
The existing `auth.schema.ts` imports `z` from `"@hono/zod-openapi"` (not from `"zod"` directly). Keep this consistent for new schemas in `auth.schema.ts`. For `settings.schema.ts`, use `z` from `"zod"` (consistent with `common.schema.ts`).

**`settings` table import:**
The `settings` table is already defined in `src/db/schema/settings.ts` and exported from `src/db/schema/index.ts`. Import it as:
```typescript
import { settings } from "../db/schema";
```

**`eq` import for Drizzle queries:**
```typescript
import { eq } from "drizzle-orm";
```

### Existing Code State (from Stories 1.1–1.4)

**`apps/api/src/services/auth.service.ts` (current):**
- Exports: `login(db, kv, env, password)`, `getSessionUser(db, userId)`
- `login()` handles first-user provisioning and normal login
- Does NOT currently increment/reset rate limit counter — add in Task 2

**`apps/api/src/lib/kv.ts` (current):**
- Exports: `DEFAULT_SESSION_TTL = 1800`, `createSession`, `getSession`, `refreshSession`, `deleteSession`
- `createSession` and `refreshSession` accept optional `ttlSeconds` parameter — already wired for TTL customization

**`apps/api/src/middleware/auth.ts` (current):**
- `authMiddleware` reads Bearer token, calls `getSession`, sets `userId`, calls `refreshSession`
- Uses `DEFAULT_SESSION_TTL` for refresh — this is acceptable per AC-7

**`apps/api/src/routes/auth.ts` (current):**
- Routes: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/session`
- `authMiddleware` applied to logout and session routes via `authRouter.use(path, authMiddleware)`
- Login handler calls `login(drizzle(c.env.DB), c.env.SESSIONS, c.env, password)`

**`apps/api/src/index.ts` (current):**
- Mounts: `healthRouter`, `authRouter`
- Add `settingsRouter` mount in Task 4

**`apps/api/src/db/schema/settings.ts` (current):**
- Columns: `key` (TEXT PK), `value` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL)
- No `created_at` column (design decision from Story 1.2)

**`apps/api/tests/integration/auth.test.ts` (current):**
- `beforeEach` clears `users`, `settings` tables and all KV sessions
- Must also clear `"rate_limit:login:global"` KV key in `beforeEach` (Task 6.9)
- Tests use `app.request(path, options, env)` pattern — follow this exactly

### Files to Create

All under `apps/api/`:
- `src/lib/rate-limit.ts` — NEW (KV counter helpers: `getRateLimitCount`, `incrementRateLimitCount`, `resetRateLimitCount`, constants)
- `src/middleware/rate-limit.ts` — NEW (Hono middleware: imports from `lib/rate-limit`, exports `rateLimitMiddleware`)
- `src/schemas/settings.schema.ts` — NEW
- `src/routes/settings.ts` — NEW

### Files to Update

- `apps/api/src/services/auth.service.ts` — add rate limit counter calls in `login()`, add `changePassword()`
- `apps/api/src/schemas/auth.schema.ts` — add `changePasswordRequestSchema`, `changePasswordResponseSchema`
- `apps/api/src/routes/auth.ts` — add change-password route, apply `rateLimitMiddleware` to login
- `apps/api/src/index.ts` — mount `settingsRouter`
- `apps/api/tests/integration/auth.test.ts` — extend with change-password and rate-limiting tests

### Files NOT to Change

- `src/lib/kv.ts` — already has the right interface; no changes needed
- `src/middleware/auth.ts` — no changes needed (TTL threading deferred)
- `src/lib/crypto.ts` — no changes needed
- `src/db/schema/` — no schema changes in this story
- `src/db/migrations/` — no new migration needed

### Anti-Patterns to Avoid

- ❌ Per-IP rate limiting — use a single global KV key; this is a single-user app
- ❌ Invalidating sessions on password change — AC-1 explicitly says sessions remain valid
- ❌ Incrementing rate limit counter on successful login — only failed attempts count
- ❌ Putting rate limit KV helpers in `middleware/rate-limit.ts` — they belong in `lib/rate-limit.ts`; services import from `lib/`, not `middleware/`
- ❌ Importing from `../middleware/rate-limit` in `auth.service.ts` — import from `../lib/rate-limit` instead
- ❌ Two `drizzle(c.env.DB)` calls in the same handler — create one `const db = drizzle(c.env.DB)` and reuse it
- ❌ `import { z } from "zod"` in `auth.schema.ts` — existing file uses `@hono/zod-openapi`; keep consistent
- ❌ `import { Hono } from 'hono'` for route files — always use `OpenAPIHono` from `@hono/zod-openapi`
- ❌ `import { HTTPException } from 'hono'` — correct path is `'hono/http-exception'`
- ❌ Module-level `drizzle(...)` call — create per-request in handler
- ❌ Storing rate limit state in module-level variables — Workers isolates are stateless; always use KV

### Test Pattern for This Story

```typescript
// Extend existing describe("auth routes") or add new describe blocks
describe("change password", () => {
  let token: string;

  beforeEach(async () => {
    // Login to get a token
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);
    const body = await res.json();
    token = body.token;
  });

  it("changes password successfully", async () => {
    const res = await app.request("/api/v1/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ current_password: env.INITIAL_PASSWORD, new_password: "newpass123" }),
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Password changed successfully");

    // Verify new password works
    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "newpass123" }),
    }, env);
    expect(loginRes.status).toBe(200);
  }, 30_000);
});

describe("rate limiting", () => {
  it("locks out after 5 failed attempts", async () => {
    // First, provision the user
    await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }, env);
    }

    // 6th attempt — even with correct password — should be rate limited
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  }, 30_000);

  it("successful login resets the failure counter", async () => {
    // Provision user
    await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);

    // 4 failed attempts (one below lockout threshold)
    for (let i = 0; i < 4; i++) {
      await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }, env);
    }

    // Successful login — resets counter
    const successRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);
    expect(successRes.status).toBe(200);

    // 4 more failures after reset — should NOT be locked out yet
    for (let i = 0; i < 4; i++) {
      await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }, env);
    }

    // 5th failure after reset — still under threshold, should get 401 not 429
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    }, env);
    expect(res.status).toBe(401); // NOT 429 — counter was reset
  }, 30_000);
});
```

**Note on `beforeEach` KV cleanup:** The existing `beforeEach` in `auth.test.ts` clears all KV sessions via `env.SESSIONS.list()`. Add `await env.SESSIONS.delete("rate_limit:login:global")` to this block to ensure rate limit state is cleared between tests.

### Deferred Items from Story 1.4 Addressed Here

- **`refreshSession` TTL not wired to settings** — Partially resolved: `login()` now reads `session_timeout` from settings and passes it to `createSession`. `refreshSession` in `authMiddleware` still uses `DEFAULT_SESSION_TTL` (acceptable per AC-7).

### Previous Story Learnings (from Story 1.4)

- **`OpenAPIHono` is the base class** — not `Hono`. All route files use `new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>()`.
- **`authMiddleware` applied via `router.use(path, middleware)`** — not globally in `index.ts`. Follow the same pattern for `rateLimitMiddleware`.
- **`c.req.valid('json')` requires the route to declare a JSON body schema** — ensure `changePasswordRoute` has `request.body` defined.
- **`c.body(null, 204)` for no-content responses** — not needed here, but keep in mind.
- **`drizzle(c.env.DB)` per request** — never module-level.
- **`errorResponseSchema` from `common.schema.ts`** — import for error response shapes in route definitions.
- **`HTTPException` import path** — `'hono/http-exception'`, not `'hono'`.
- **Integration tests use `app.request(path, options, env)` with `env` as third arg** — required for `c.env` bindings to work.
- **Per-test 30s timeout for argon2 paths** — add `, 30_000` to any test that triggers `hashPassword` or `verifyPassword`.
- **Review finding from 1.4:** Shared singleton `HTTPException` causes issues — always throw `new HTTPException(...)` inline, never reuse a module-level instance.

### Latest Tech Information

Verified against installed versions (2026-05-28):

- **`hono` v4.12.23**: `createMiddleware` from `'hono/factory'`. Middleware registered via `router.use(path, fn)` runs before `router.openapi()` handlers for the same path.
- **`@hono/zod-openapi` v1.4.0**: `openapi(route, ...middlewares, handler)` — middleware can be passed inline OR registered via `router.use()`. Both patterns work.
- **`drizzle-orm` v0.36.4**: `.onConflictDoUpdate({ target: col, set: { ... } })` is the correct upsert pattern for D1/SQLite. `db.update(table).set({ ... }).where(eq(col, val))` for updates.
- **`@cloudflare/vitest-pool-workers` v0.16.10**: KV `list()` returns `{ keys: [{ name: string }] }`. Delete all keys with `Promise.all(keys.keys.map(k => env.SESSIONS.delete(k.name)))`.

### Review Findings

- [x] [Review][Defer] No rate limit on change-password endpoint — deferred to future hardening pass; single-user app behind auth, minimal threat model [apps/api/src/routes/auth.ts]
- [x] [Review][Defer] No integration tests for settings endpoints — deferred to Story 1.6 which also uses settings [apps/api/tests/integration/auth.test.ts]
- [x] [Review][Patch] Zero/negative `session_timeout` causes KV failure, soft-locks login — Fixed: added lower-bound clamp (`< 60 → DEFAULT_SESSION_TTL`) in login handler [apps/api/src/routes/auth.ts:login handler]

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- `bun run check-types` (repo root) — passed
- `bun run lint` (repo root) — passed
- `bun run test --run` (`apps/api`) — passed (`24 passed`)

### Completion Notes List

- Implemented KV-backed global login rate limiting with dedicated helper library and middleware.
- Added password-change service flow and authenticated `POST /api/v1/auth/change-password` route.
- Added settings schemas/router with authenticated `GET/PUT /api/v1/settings` and upsert behavior.
- Wired login session TTL to `settings.session_timeout` with safe fallback to `DEFAULT_SESSION_TTL`.
- Extended auth integration coverage for password change and rate-limiting behaviors, including lockout window expiry.

### File List

- `apps/api/src/lib/rate-limit.ts` (new)
- `apps/api/src/middleware/rate-limit.ts` (new)
- `apps/api/src/services/auth.service.ts`
- `apps/api/src/schemas/auth.schema.ts`
- `apps/api/src/schemas/settings.schema.ts` (new)
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/settings.ts` (new)
- `apps/api/src/index.ts`
- `apps/api/tests/integration/auth.test.ts`

### Change Log

- 2026-05-28: Story 1.5 created by create-story workflow; status set to ready-for-dev
- 2026-05-28: Implemented Story 1.5 (password change, login rate limiting, settings endpoints, session_timeout wiring, and integration tests); verification gate passed.
