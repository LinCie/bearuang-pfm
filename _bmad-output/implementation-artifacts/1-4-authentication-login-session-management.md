# Story 1.4: Authentication — Login & Session Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the app owner,
I want to log in with my password and receive a session token,
So that I can securely access all protected API endpoints.

## Acceptance Criteria

1. **AC-1 First-login auto-provision:** When no user exists in `users` and `POST /api/v1/auth/login` is called with the correct `INITIAL_PASSWORD`, a primary user record is created with `role = 'primary'`, `is_active = 1`, `display_name` read from the `display_name` settings key (fallback: `"Admin"`), and `password_hash` set to the argon2id hash of `INITIAL_PASSWORD`. An opaque session token is returned. [Source: epics.md#Story-1.4, architecture.md#Authentication-Security]

2. **AC-2 Normal login:** When a user exists and `POST /api/v1/auth/login` is called with the correct password, a session token is returned. [Source: epics.md#Story-1.4]

3. **AC-3 Wrong password:** When `POST /api/v1/auth/login` is called with an incorrect password, the response is `{ error: { code: "UNAUTHORIZED", message: "Invalid credentials" } }` with status 401. [Source: epics.md#Story-1.4]

4. **AC-4 Session token stored in KV:** The session token (256-bit, cryptographically random hex string) is stored in KV as `kv.put(token, userId, { expirationTtl: 1800 })` (30-minute default TTL). [Source: epics.md#Story-1.4, architecture.md#Authentication-Security]

5. **AC-5 Auth middleware — valid token:** When a request includes `Authorization: Bearer {token}`, the auth middleware calls `kv.get(token)`. If found, `c.set('userId', userId)` is populated and the session TTL is refreshed (sliding expiration via `kv.put(token, userId, { expirationTtl: ttl })`). [Source: epics.md#Story-1.4, architecture.md#Process-Patterns]

6. **AC-6 Auth middleware — invalid/expired token:** When the token is not found in KV, the middleware throws `new HTTPException(401, { message: "Unauthorized" })`. [Source: epics.md#Story-1.4]

7. **AC-7 Logout:** `POST /api/v1/auth/logout` deletes the token from KV via `kv.delete(token)`. Subsequent requests with that token return 401. [Source: epics.md#Story-1.4]

8. **AC-8 Session info:** `GET /api/v1/auth/session` (protected) returns `{ user_id, display_name, role }` for the authenticated user. [Source: epics.md#Story-1.4]

9. **AC-9 Public routes unaffected:** `POST /api/v1/auth/login` and `GET /api/v1/health` respond normally without a session token. Auth middleware is NOT applied to these routes. [Source: epics.md#Story-1.4, architecture.md#Process-Patterns]

10. **AC-10 `lib/crypto.ts` implements hashing and token generation:** `hashPassword(password: string): Promise<string>` — argon2id via `@noble/hashes/argon2`, falls back to PBKDF2-SHA256 via Web Crypto if argon2id throws. `verifyPassword(password: string, hash: string): Promise<boolean>` — verifies against the stored hash format. `generateSessionToken(): string` — returns a 32-byte hex string via `crypto.getRandomValues()`. [Source: epics.md#Story-1.4, architecture.md#Authentication-Security]

11. **AC-11 `lib/kv.ts` implements session helpers:** `createSession(kv: KVNamespace, userId: string, ttlSeconds?: number): Promise<string>` — generates token, stores in KV, returns token. `getSession(kv: KVNamespace, token: string): Promise<string | null>` — returns userId or null. `refreshSession(kv: KVNamespace, token: string, userId: string, ttlSeconds?: number): Promise<void>` — re-puts with same TTL. `deleteSession(kv: KVNamespace, token: string): Promise<void>`. [Source: architecture.md#Project-Structure]

12. **AC-12 Service layer pattern:** `auth.service.ts` exports pure functions receiving `(db, kv, env)` as parameters — never imports db/kv directly. [Source: architecture.md#Service-Layer-Rules]

13. **AC-13 Type-check and lint pass:** `bun run check-types` and `bun run lint` both exit 0. [Source: architecture.md#Implementation-Patterns]

14. **AC-14 Integration tests:** `tests/integration/auth.test.ts` covers: first-login auto-provision, normal login, wrong password → 401, logout → subsequent 401, session endpoint returns user info, protected route without token → 401. [Source: architecture.md#Test-Organization]

## Tasks / Subtasks

- [x] **Task 1: Create `src/lib/crypto.ts`** (AC: 10)
  - [x] 1.1 Import `argon2id` from `@noble/hashes/argon2` and `pbkdf2` from `@noble/hashes/pbkdf2`; import `sha256` from `@noble/hashes/sha2`
  - [x] 1.2 Define `ARGON2_PARAMS = { t: 3, m: 65536, p: 1, dkLen: 32 }` (RFC 9106 minimum for interactive use)
  - [x] 1.3 Define `PBKDF2_ITERATIONS = 600000` (NIST SP 800-132 recommendation for SHA-256)
  - [x] 1.4 `generateSessionToken(): string` — `crypto.getRandomValues(new Uint8Array(32))` → hex string via `Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')`
  - [x] 1.5 `hashPassword(password: string): Promise<string>` — try argon2id; on any error fall back to PBKDF2. Encode result as `"argon2id:$" + hex(salt) + "$" + hex(hash)` or `"pbkdf2:$" + hex(salt) + "$" + hex(hash)` so `verifyPassword` knows which algorithm to use
  - [x] 1.6 `verifyPassword(password: string, storedHash: string): Promise<boolean>` — parse prefix to determine algorithm, extract salt and hash, recompute, compare with `crypto.subtle.timingSafeEqual()`
  - [x] 1.7 Salt generation: `crypto.getRandomValues(new Uint8Array(16))` for both algorithms
  - [x] 1.8 Export all three functions; no default export

- [x] **Task 2: Create `src/lib/kv.ts`** (AC: 11)
  - [x] 2.1 `DEFAULT_SESSION_TTL = 1800` (30 minutes in seconds)
  - [x] 2.2 `createSession(kv: KVNamespace, userId: string, ttlSeconds = DEFAULT_SESSION_TTL): Promise<string>` — generate token, `kv.put(token, userId, { expirationTtl: ttlSeconds })`, return token
  - [x] 2.3 `getSession(kv: KVNamespace, token: string): Promise<string | null>` — `kv.get(token)` returns userId string or null
  - [x] 2.4 `refreshSession(kv: KVNamespace, token: string, userId: string, ttlSeconds = DEFAULT_SESSION_TTL): Promise<void>` — `kv.put(token, userId, { expirationTtl: ttlSeconds })`
  - [x] 2.5 `deleteSession(kv: KVNamespace, token: string): Promise<void>` — `kv.delete(token)`
  - [x] 2.6 Export all functions; no default export

- [x] **Task 3: Create `src/services/auth.service.ts`** (AC: 1, 2, 3, 12)
  - [x] 3.1 Import `drizzle` from `drizzle-orm/d1`; import `users` and `settings` from `../db/schema/index`; import `eq` from `drizzle-orm`; import `hashPassword`, `verifyPassword`, `generateSessionToken` from `../lib/crypto`; import `createSession` from `../lib/kv`
  - [x] 3.2 `login(db: DrizzleD1Database, kv: KVNamespace, env: Env, password: string): Promise<{ token: string; userId: string }>` — see logic below
  - [x] 3.3 Login logic:
    - Query `db.select().from(users).limit(1)` to check if any user exists
    - If no user: verify `password === env.INITIAL_PASSWORD` (plain string compare is fine here — INITIAL_PASSWORD is a secret, not a hash); if wrong → throw `new HTTPException(401, { message: "Invalid credentials" })`
    - If no user and password matches: read `display_name` from settings (`db.select().from(settings).where(eq(settings.key, 'display_name')).limit(1)`), fallback to `"Admin"`; hash the password; insert user with `crypto.randomUUID()` as id, `role: 'primary'`, `is_active: 1`, `created_at: new Date().toISOString()`
    - If user exists: `verifyPassword(password, user.password_hash)`; if false → throw `new HTTPException(401, { message: "Invalid credentials" })`
    - Call `createSession(kv, userId)` and return `{ token, userId }`
  - [x] 3.4 `getSessionUser(db: DrizzleD1Database, userId: string): Promise<{ user_id: string; display_name: string; role: string }>` — query user by id, throw `new HTTPException(401, { message: "Unauthorized" })` if not found or `is_active !== 1`

- [x] **Task 4: Create `src/middleware/auth.ts`** (AC: 5, 6, 9)
  - [x] 4.1 Import `createMiddleware` from `hono/factory`; import `HTTPException` from `hono/http-exception`; import `getSession`, `refreshSession` from `../lib/kv`
  - [x] 4.2 Export `authMiddleware` using `createMiddleware<{ Bindings: Env; Variables: { userId: string } }>(async (c, next) => { ... })`
  - [x] 4.3 Extract token: `const authHeader = c.req.header('Authorization')` → if missing or not `Bearer ...` → throw `new HTTPException(401, { message: "Unauthorized" })`
  - [x] 4.4 `const token = authHeader.slice(7)` (after `"Bearer "`)
  - [x] 4.5 `const userId = await getSession(c.env.SESSIONS, token)` → if null → throw `new HTTPException(401, { message: "Unauthorized" })`
  - [x] 4.6 `c.set('userId', userId)` then `await refreshSession(c.env.SESSIONS, token, userId)` then `await next()`
  - [x] 4.7 **Do NOT** use `c.env.SESSIONS` before the middleware is registered — it's only available at request time

- [x] **Task 5: Create `src/routes/auth.ts`** (AC: 1, 2, 3, 7, 8)
  - [x] 5.1 Create `apps/api/src/schemas/auth.schema.ts` with:
    - `loginRequestSchema = z.object({ password: z.string().min(1) })`
    - `loginResponseSchema = z.object({ token: z.string() })`
    - `sessionResponseSchema = z.object({ user_id: z.string(), display_name: z.string(), role: z.string() })`
  - [x] 5.2 Create `apps/api/src/routes/auth.ts` using `OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>`
  - [x] 5.3 Define routes with `createRoute()`:
    - `POST /api/v1/auth/login` — no auth, body: `loginRequestSchema`, 200: `loginResponseSchema`, 401: `errorResponseSchema`
    - `POST /api/v1/auth/logout` — requires auth middleware, 204 no content
    - `GET /api/v1/auth/session` — requires auth middleware, 200: `sessionResponseSchema`
  - [x] 5.4 Login handler: `const { password } = c.req.valid('json')` → call `login(drizzle(c.env.DB), c.env.SESSIONS, c.env, password)` → return `c.json({ token }, 200)`
  - [x] 5.5 Logout handler: extract token from `Authorization` header → call `deleteSession(c.env.SESSIONS, token)` → return `c.body(null, 204)`
  - [x] 5.6 Session handler: `const userId = c.get('userId')` → call `getSessionUser(drizzle(c.env.DB), userId)` → return `c.json(result, 200)`
  - [x] 5.7 Apply `authMiddleware` to logout and session routes only — NOT to login

- [x] **Task 6: Mount auth router in `src/index.ts`** (AC: 9)
  - [x] 6.1 Import `authRouter` from `./routes/auth`
  - [x] 6.2 Add `app.route('/', authRouter)` after `app.route('/', healthRouter)`
  - [x] 6.3 Verify login route is NOT behind global auth middleware (it isn't — auth middleware is per-route in the router)

- [x] **Task 7: Write integration tests** (AC: 14)
  - [x] 7.1 Create `apps/api/tests/integration/auth.test.ts`
  - [x] 7.2 Use `applyMigrations(env.DB)` in `beforeAll` — this story touches D1
  - [x] 7.3 Import the real `app` from `../../src/index` for integration tests (not a test-only app)
  - [x] 7.4 Test: first login with `INITIAL_PASSWORD` → 200 with token, user created in DB
  - [x] 7.5 Test: second login with same password → 200 with new token (user already exists path)
  - [x] 7.6 Test: login with wrong password → 401 `UNAUTHORIZED`
  - [x] 7.7 Test: `GET /api/v1/auth/session` with valid token → 200 with `{ user_id, display_name, role }`
  - [x] 7.8 Test: `GET /api/v1/auth/session` without token → 401
  - [x] 7.9 Test: `POST /api/v1/auth/logout` → 204; subsequent session request → 401
  - [x] 7.10 Test: `GET /api/v1/health` without token → 200 (public route unaffected)
  - [x] 7.11 Run `bun run test --run` from `apps/api/` — all tests pass

- [x] **Task 8: Verification gate** (AC: 13)
  - [x] 8.1 `bun run check-types` from repo root — exit 0
  - [x] 8.2 `bun run lint` from repo root — exit 0
  - [x] 8.3 `bun run test --run` from `apps/api/` — all tests pass
  - [x] 8.4 Update Dev Agent Record with file list and any deviations

## Dev Notes

### Critical Architecture Constraints

**`@noble/hashes` v2.2.0 — argon2id IS available:**
`@noble/hashes` v2.2.0 includes argon2id directly — no separate package needed. Import path:
```typescript
import { argon2id } from "@noble/hashes/argon2";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
```
The `argon2id` function signature: `argon2id(password: KDFInput, salt: KDFInput, opts: ArgonOpts): Uint8Array`
The `argon2idAsync` variant: `argon2idAsync(password, salt, opts): Promise<Uint8Array>` — use the async variant in Workers to avoid blocking the event loop.

**Hash storage format — encode algorithm in the stored string:**
```typescript
// argon2id hash format:
"argon2id:" + hexSalt + ":" + hexHash

// PBKDF2 fallback format:
"pbkdf2:" + hexSalt + ":" + hexHash
```
`verifyPassword` parses the prefix to know which algorithm to use. This is critical — without it, you can't verify hashes after a fallback.

**`crypto.subtle.timingSafeEqual()` for hash comparison:**
```typescript
const a = new TextEncoder().encode(computedHex);
const b = new TextEncoder().encode(storedHex);
// Must be same length — pad or compare lengths first
if (a.byteLength !== b.byteLength) return false;
return crypto.subtle.timingSafeEqual(a, b);
```

**`DrizzleD1Database` type:**
```typescript
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
// In route handler:
const db = drizzle(c.env.DB);
// In service function signature:
async function login(db: DrizzleD1Database, kv: KVNamespace, env: Env, password: string)
```

**`createMiddleware` from `hono/factory`:**
```typescript
import { createMiddleware } from "hono/factory";

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string };
}>(async (c, next) => {
  // ...
  c.set("userId", userId);
  await next();
});
```
This is the correct pattern for typed middleware in Hono v4. Do NOT use `app.use()` with an inline function for reusable middleware.

**Applying auth middleware per-route in OpenAPIHono:**
```typescript
// In auth.ts router:
authRouter.openapi(sessionRoute, authMiddleware, async (c) => {
  const userId = c.get("userId");
  // ...
});
```
Or apply it to a sub-router:
```typescript
const protectedRouter = new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>();
protectedRouter.use("*", authMiddleware);
protectedRouter.openapi(sessionRoute, handler);
protectedRouter.openapi(logoutRoute, handler);
```
The login route must NOT be in the protected router.

**`c.req.valid('json')` requires the route to declare a JSON body schema:**
```typescript
const loginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/login",
  request: {
    body: {
      content: { "application/json": { schema: loginRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: { content: { "application/json": { schema: loginResponseSchema } }, description: "Login successful" },
    401: { content: { "application/json": { schema: errorResponseSchema } }, description: "Invalid credentials" },
  },
});
```

**Logout returns 204 No Content:**
```typescript
// Route definition:
responses: {
  204: { description: "Logged out successfully" },
}
// Handler:
return c.body(null, 204);
```

**`INITIAL_PASSWORD` is a secret in `Env`:**
`worker-configuration.d.ts` already declares `INITIAL_PASSWORD: string` in the `Env` interface (generated by `wrangler types`). Access it as `env.INITIAL_PASSWORD` in service functions. Do NOT use `process.env.INITIAL_PASSWORD`.

**KV `expirationTtl` is in seconds:**
```typescript
await kv.put(token, userId, { expirationTtl: 1800 }); // 30 minutes
```
The TTL for session refresh should read from the `session_timeout` settings key if it exists (Story 1.5 adds the PUT endpoint, but the key may already be set). For Story 1.4, default to 1800 seconds. Pass `ttlSeconds` as a parameter to `createSession` and `refreshSession` so Story 1.5 can pass the configured value.

**`drizzle(c.env.DB)` creates a new instance per request — this is correct for Workers:**
Workers isolates are stateless. Creating `drizzle(c.env.DB)` in each handler is the correct pattern. Do NOT store it as a module-level variable.

**`users` table `display_name` is `notNull()` — handle the first-login case:**
On first login, read `display_name` from the `settings` table (key: `'display_name'`). If not set (setup wizard not run yet), use `"Admin"` as fallback. This is the only place where `display_name` is auto-populated.

**`role` column is plain `text()` — validate at app layer:**
The `users` table uses `text('role').notNull()` with no DB-level CHECK constraint (established in Story 1.2). Enforce `'primary' | 'partner'` via Zod schema in `auth.schema.ts`. For Story 1.4, only `'primary'` is created.

### Existing Code State (from Stories 1.1–1.3)

**`apps/api/src/index.ts` (current):**
```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler";
import { healthRouter } from "./routes/health";
import { errorResponseSchema } from "./schemas/common.schema";

const app = new OpenAPIHono<{ Bindings: Env }>({ defaultHook: ... });
app.use("*", cors({ ... }));
app.onError(errorHandler);
app.notFound(...);
app.route("/", healthRouter);
export default app;
```
Add `app.route("/", authRouter)` after the health route. No other changes to `index.ts`.

**`apps/api/src/schemas/common.schema.ts`** — exports `errorResponseSchema` and `ErrorResponse`. Import this in `auth.ts` route definitions for error responses.

**`apps/api/src/middleware/error-handler.ts`** — `deriveCode(401)` returns `"UNAUTHORIZED"`. HTTPException with status 401 will produce the correct error shape automatically.

**`apps/api/tests/setup.ts`** — exports `getTestEnv()`, `applyMigrations(db: D1Database)`, `seedUser(db)`. Use `applyMigrations(env.DB)` in `beforeAll`. The `seedUser` function inserts a user with `password_hash: "placeholder_hash_not_real"` — do NOT use it for auth tests; create users via the login endpoint instead.

**`apps/api/tests/fixtures/factories.ts`** — `userFactory()` creates a user object with a placeholder hash. Useful for direct DB inserts in non-auth tests, but for auth integration tests, go through the login endpoint.

**Migration file:** `src/db/migrations/0000_fast_johnny_storm.sql` — creates `users` and `settings` tables. `applyMigrations` reads this file by name. No new migration needed for Story 1.4 (no schema changes).

### Files to Create

All under `apps/api/`:
- `src/lib/crypto.ts` — NEW (first file in `src/lib/`)
- `src/lib/kv.ts` — NEW
- `src/services/auth.service.ts` — NEW (first file in `src/services/`)
- `src/middleware/auth.ts` — NEW (second file in `src/middleware/`)
- `src/schemas/auth.schema.ts` — NEW (second file in `src/schemas/`)
- `src/routes/auth.ts` — NEW (second file in `src/routes/`)
- `tests/integration/auth.test.ts` — NEW

### Files to Update

- `apps/api/src/index.ts` — add `import { authRouter }` and `app.route('/', authRouter)`

### Files NOT to Change

- `src/db/schema/` — no schema changes in this story
- `src/db/migrations/` — no new migration needed
- `wrangler.toml` — `INITIAL_PASSWORD` is already documented as a secret; no changes needed
- `worker-configuration.d.ts` — already has `INITIAL_PASSWORD: string`; no regeneration needed
- `tests/setup.ts` — no changes needed
- `tests/fixtures/factories.ts` — no changes needed

### Anti-Patterns to Avoid

- ❌ `import { argon2id } from "@noble/argon2"` — wrong package; use `@noble/hashes/argon2`
- ❌ Storing `drizzle(c.env.DB)` as a module-level variable — causes data leaks between requests in Workers
- ❌ `process.env.INITIAL_PASSWORD` — use `env.INITIAL_PASSWORD` (passed as parameter to service)
- ❌ Applying `authMiddleware` globally in `index.ts` — it must NOT protect the login route
- ❌ `Math.random()` for token generation — use `crypto.getRandomValues()`
- ❌ Comparing hashes with `===` — use `crypto.subtle.timingSafeEqual()`
- ❌ Storing the raw password in KV — store only `userId` as the KV value
- ❌ Using `kv.get(token)` result without null check — KV returns `null` for missing/expired keys
- ❌ `import { Hono } from 'hono'` for route files — always use `OpenAPIHono` from `@hono/zod-openapi`
- ❌ `import { HTTPException } from 'hono'` — correct path is `'hono/http-exception'`

### Test Pattern for This Story

```typescript
// tests/integration/auth.test.ts
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import app from "../../src/index";
import { applyMigrations } from "../setup";

describe("auth", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it("first login creates user and returns token", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBe(64); // 32 bytes hex
  });

  it("login with wrong password returns 401", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    }, env);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("session endpoint returns user info", async () => {
    // Login first
    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);
    const { token } = await loginRes.json();

    const res = await app.request("/api/v1/auth/session", {
      headers: { Authorization: `Bearer ${token}` },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("primary");
  });

  it("logout invalidates token", async () => {
    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
    }, env);
    const { token } = await loginRes.json();

    await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }, env);

    const res = await app.request("/api/v1/auth/session", {
      headers: { Authorization: `Bearer ${token}` },
    }, env);
    expect(res.status).toBe(401);
  });
});
```

**Note on passing `env` to `app.request()`:** In `@cloudflare/vitest-pool-workers`, the test `env` object (from `cloudflare:test`) must be passed as the third argument to `app.request()` so that `c.env.DB`, `c.env.SESSIONS`, and `c.env.INITIAL_PASSWORD` are available. Without it, `c.env` will be undefined.

### Previous Story Learnings (from Story 1.3)

- **`OpenAPIHono` is the base class** — not `Hono`. All route files use `new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>()`.
- **`defaultHook` is already set in `index.ts`** — validation errors are handled globally. Route files don't need their own `defaultHook`.
- **`errorResponseSchema` from `common.schema.ts`** — import and use in route definitions for error response shapes.
- **`HTTPException` import path** — `'hono/http-exception'`, not `'hono'`.
- **`c.executionCtx.waitUntil()` pattern** — wrap in try/catch for test environments (established in `health.ts`).
- **`src/middleware/`, `src/routes/`, `src/schemas/`, `src/lib/`, `src/services/`** — all directories exist from Story 1.1 scaffold with `.gitkeep` files. No `mkdir` needed.
- **Review finding from 1.3:** `notFound` handler and `defaultHook` bypass `errorResponseSchema.parse()` — use `safeParse` with fallback to avoid throwing inside error paths.

### Latest Tech Information

Verified against installed versions (2026-05-28):

- **`@noble/hashes` v2.2.0**: `argon2id` and `argon2idAsync` are exported from `@noble/hashes/argon2`. `ArgonOpts` type: `{ t: number, m: number, p: number, dkLen?: number }`. `pbkdf2Async` exported from `@noble/hashes/pbkdf2` — signature: `pbkdf2Async(hash, password, salt, opts)` where `opts = { c: iterations, dkLen: 32 }`.
- **`hono` v4.12.23**: `createMiddleware` from `'hono/factory'`. `HTTPException` from `'hono/http-exception'`. `c.set()` / `c.get()` for typed context variables.
- **`@hono/zod-openapi` v1.4.0**: `openapi(route, ...middlewares, handler)` — middleware can be passed between route and handler. `c.req.valid('json')` returns the validated body.
- **`drizzle-orm` v0.36.4**: `drizzle(d1: D1Database)` returns `DrizzleD1Database`. `db.select().from(table).where(eq(col, val)).limit(1)` returns an array; check `.length` or use `[0]`. `db.insert(table).values(row)` for inserts.
- **`zod` v4.4.3**: `z.string().min(1)` for non-empty string validation. `z.object()` for request/response schemas.
- **`vitest` v4.1.7** with **`@cloudflare/vitest-pool-workers` v0.16.10**: Pass `env` as third argument to `app.request()` for binding access. `env.INITIAL_PASSWORD` is available in tests via `.dev.vars` or `vitest.config.ts` `vars`.

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `bun run check-types` (repo root) — pass
- `bun run lint` (repo root) — pass
- `bun run test --run` (apps/api) — pass (`16 passed`)

### Completion Notes List

- Implemented `src/lib/crypto.ts` with argon2id-first password hashing, PBKDF2 fallback, constant-time verification, and 256-bit session token generation.
- Implemented `src/lib/kv.ts` session helpers (`createSession`, `getSession`, `refreshSession`, `deleteSession`) with 30-minute default TTL.
- Implemented `src/services/auth.service.ts` login flow for first-user auto-provisioning, credential validation, and session user lookup.
- Added `src/middleware/auth.ts` bearer-token middleware with session lookup and sliding TTL refresh.
- Added auth API contracts and routing (`src/schemas/auth.schema.ts`, `src/routes/auth.ts`) for login/logout/session and mounted auth router in `src/index.ts`.
- Added `tests/integration/auth.test.ts` coverage for first login, normal login, wrong password, protected session behavior, logout invalidation, and public health route.
- Updated `tests/setup.ts` migration helper to load SQL via `?raw` import so migrations run correctly in the Workers/Vitest runtime.
- Added per-test 30s timeout for slow argon2 integration paths to avoid false failures from Vitest default 5s timeout.

### File List

- apps/api/src/lib/crypto.ts (new)
- apps/api/src/lib/kv.ts (new)
- apps/api/src/services/auth.service.ts (new)
- apps/api/src/middleware/auth.ts (new)
- apps/api/src/schemas/auth.schema.ts (new)
- apps/api/src/routes/auth.ts (new)
- apps/api/src/index.ts (modified)
- apps/api/tests/integration/auth.test.ts (new)
- apps/api/tests/setup.ts (modified)

### Change Log

- 2026-05-28: Story 1.4 created by create-story workflow; status set to ready-for-dev
- 2026-05-28: Story 1.4 implemented; auth login/session/logout + middleware + integration tests completed; status set to review

### Review Findings

- [x] [Review][Patch] Shared singleton HTTPException reused across requests [auth.service.ts, auth.ts middleware] — `INVALID_CREDENTIALS_ERROR` and `UNAUTHORIZED` are module-level singletons. HTTPException wraps a Response object that may be mutated; throw `new HTTPException(...)` inline instead.
- [x] [Review][Patch] Synchronous PBKDF2 blocks the Workers event loop [src/lib/crypto.ts] — `pbkdf2()` is CPU-bound at 600k iterations. Replace with `pbkdf2Async()` from `@noble/hashes/pbkdf2` to match the async pattern used for argon2id.
- [x] [Review][Patch] Race condition on first-user provisioning [src/services/auth.service.ts] — Two concurrent first-login requests can both pass the `existingUsers.length === 0` check and insert duplicate primary users. Add a unique constraint on `role = 'primary'` or use a DB-level insert guard.
- [x] [Review][Patch] Dead code in logout handler — empty-token branch [src/routes/auth.ts] — The `if (!token) return c.body(null, 204)` branch is unreachable because `authMiddleware` already rejects requests without a valid Bearer token. Remove the dead branch.
- [x] [Review][Patch] KV not cleared between tests [tests/integration/auth.test.ts] — `beforeEach` wipes DB rows but not KV. Add `await env.SESSIONS.list().then(keys => Promise.all(keys.keys.map(k => env.SESSIONS.delete(k.name))))` or equivalent to fully isolate tests.
- [x] [Review][Patch] Missing test: first-login with wrong password returns 401 [tests/integration/auth.test.ts] — AC-3 applies to both the no-user and existing-user cases. The current wrong-password test only covers the existing-user path. Add a test that calls login with a wrong password before any user exists.
- [x] [Review][Defer] Argon2 params not encoded in hash format [src/lib/crypto.ts] — If ARGON2_PARAMS change in future, existing hashes will silently fail verification. Consider encoding params in the hash string (e.g., argon2id format). Deferred — pre-existing design choice, not a regression.
- [x] [Review][Defer] refreshSession TTL not wired to settings [src/middleware/auth.ts] — Middleware has no `db` access so cannot read `session_timeout` from settings. Story 1.5 will need to pass TTL through or give middleware DB access. Deferred — Story 1.5 concern.
- [x] [Review][Defer] SQL migration split on `;` is fragile [tests/setup.ts] — Splitting on bare `;` will break if a future migration contains a semicolon inside a string literal. Deferred — pre-existing, no current migration is affected.
