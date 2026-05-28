---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - "/home/hebot/bearuang/_bmad-output/planning-artifacts/prds/prd-bearuang-2026-05-27/prd.md"
  - "/home/hebot/bearuang/_bmad-output/planning-artifacts/architecture.md"
  - "/home/hebot/bearuang/_bmad-output/brainstorming/brainstorming-session-2026-05-26-features.md"
---

# bearuang - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for bearuang, decomposing the requirements from the PRD and Architecture into implementable stories for the backend API (Hono on Cloudflare Workers with D1, R2, KV).

## Requirements Inventory

### Functional Requirements

FR-AUTH-01: Password-based authentication using a secret initially set via Cloudflare Worker environment variable (password stored as bcrypt/argon2 hash in D1)
FR-AUTH-02: In-app password change endpoint (replaces env-defined initial password with user-chosen password stored in D1)
FR-AUTH-03: Session token management via KV (issue opaque session token on login, store in KV with TTL)
FR-AUTH-04: Configurable session timeout (default 30 minutes inactivity, configurable via settings endpoint)
FR-AUTH-05: Logout endpoint that invalidates session in KV (immediate session revocation)
FR-AUTH-06: Rate limiting on login attempts (prevent brute-force; use KV counter with sliding window)

FR-ACCT-01: CRUD operations for financial accounts (create, read, update, soft-delete)
FR-ACCT-02: Support account types: bank, cash, e-wallet, credit card, loan, investment (enum field with correct balance semantics)
FR-ACCT-03: Asset vs liability balance logic (banks/cash/e-wallet/investment = asset; credit card/loan = liability)
FR-ACCT-04: Initial balance entry on account creation (stored as opening balance, not counted as income transaction)
FR-ACCT-05: Per-account current balance calculation (derived from initial balance + sum of transactions affecting the account)
FR-ACCT-06: Account listing with balances (return all active accounts with computed current balance)
FR-ACCT-07: Account currency assignment (each account has a base currency, single currency per account for MVP)

FR-TXN-01: Create expense transaction (amount, account, category, date default now, optional payee, optional notes)
FR-TXN-02: Create income transaction (amount, account, category, date, optional notes)
FR-TXN-03: Create transfer between accounts (single logical event: debit source, credit destination, no double-counting in reports)
FR-TXN-04: Update transaction (all mutable fields editable; recalculates affected account balances)
FR-TXN-05: Soft-delete transaction (moves to trash, recoverable for 30 days, then permanently purged)
FR-TXN-06: Transaction attribution (records which user created/modified each transaction via user_id foreign key)
FR-TXN-07: Notes/memo field (free-text field on every transaction)
FR-TXN-08: Transaction listing with pagination (paginated list, sorted by date descending by default)
FR-TXN-09: Transaction search and filter (filter by: date range, account, category, amount range, text search on description/notes/payee)
FR-TXN-10: Offline transaction queue support (accept transactions with client-generated UUID and created_at timestamp; idempotent upsert by UUID)

FR-CAT-01: CRUD for flat expense categories (no hierarchy, no nesting for MVP)
FR-CAT-02: Starter category seed endpoint (populate sensible defaults on first-run)
FR-CAT-03: Income category types (predefined: salary, freelance, gift, refund, interest, other)
FR-CAT-04: Category usage tracking (track which categories are used, for ordering suggestions)

FR-REC-01: Create recurring transaction template (amount, account, category, frequency, start date, optional end date)
FR-REC-02: Generate upcoming entries (compute next N occurrences based on template frequency)
FR-REC-03: Confirm/post a recurring entry (user confirms before it becomes an actual transaction)
FR-REC-04: Skip a recurring entry (mark a single occurrence as skipped without deleting the template)
FR-REC-05: Update/delete recurring template (changes apply to future occurrences only)
FR-REC-06: Upcoming payments list (return all expected recurring payments within next 30 days)

FR-RCP-01: Upload receipt file to R2 (accept image JPEG, PNG, WebP, HEIC and PDF; max 10MB per file)
FR-RCP-02: Link receipt to transaction (many-to-one: multiple receipts can attach to one transaction)
FR-RCP-03: Generate presigned download URL (time-limited URL for client to fetch receipt from R2)
FR-RCP-04: Delete receipt (remove from R2 and unlink from transaction)
FR-RCP-05: List receipts for a transaction (return metadata and download URLs for all receipts on a transaction)

FR-VIEW-01: Net worth calculation (total assets minus total liabilities across all active accounts)
FR-VIEW-02: Net worth breakdown by account (per-account balance with asset/liability classification)
FR-VIEW-03: Spending by category for a given month (aggregate expense amounts grouped by category, with previous month comparison)
FR-VIEW-04: Dashboard data endpoint (single endpoint returning: net worth, account balances, income vs expenses for current month, upcoming payments next 7 days)
FR-VIEW-05: Monthly summary report (total income, total expenses, net savings, top 5 categories, top 5 payees, net worth change from previous month)
FR-VIEW-06: Monthly cash flow (total income minus total expenses for a given month)

FR-COLLAB-01: Solo mode as default (app starts single-user; collaboration is opt-in)
FR-COLLAB-02: Generate partner invite link (one-time secret link stored in KV with configurable expiry, default 24h)
FR-COLLAB-03: Accept invite and create partner account (partner sets their own password; becomes second user with equal data access)
FR-COLLAB-04: Shared data access (both users see all accounts, transactions, categories, recurring templates)
FR-COLLAB-05: Per-transaction user attribution (every transaction records created_by and updated_by user ID)
FR-COLLAB-06: Activity log (append-only log of mutations: "User X created/updated/deleted transaction Y")
FR-COLLAB-07: Revoke partner access (primary user can remove partner; partner's data attribution preserved)

FR-EXP-01: Full JSON export (all accounts, transactions, categories, recurring templates, settings in a single documented JSON structure with schema version)
FR-EXP-02: CSV export of transactions (standard columns: date, type, amount, account, category, payee, notes, receipt_attached)
FR-EXP-03: Export includes metadata (schema version, export timestamp, account count, transaction count for integrity verification)

FR-SETUP-01: First-run detection (endpoint to check if initial setup has been completed)
FR-SETUP-02: Initial setup wizard endpoint (accept: display name, base currency, initial accounts optional, seed categories yes/no)
FR-SETUP-03: Currency configuration (set base currency for the instance, single currency for MVP)

FR-DEL-01: Soft delete for transactions (mark as deleted, retain for 30 days)
FR-DEL-02: List deleted items (endpoint to view trash)
FR-DEL-03: Restore deleted item (undelete within 30-day window)
FR-DEL-04: Permanent purge (background or on-demand cleanup of items past 30-day retention)

### NonFunctional Requirements

NFR-PERF-01: API response time < 200ms for standard CRUD operations (p95) on Cloudflare Workers
NFR-PERF-02: Dashboard endpoint < 500ms including aggregation queries
NFR-PERF-03: Receipt upload < 5s for 10MB file
NFR-PERF-04: Transaction listing pagination: max 50 items per page, cursor-based

NFR-SEC-01: All endpoints require valid session token except: login, accept-invite, first-run check
NFR-SEC-02: Passwords hashed with bcrypt (cost 10+) or argon2id
NFR-SEC-03: Session tokens: cryptographically random, 256-bit minimum entropy
NFR-SEC-04: CORS configured for the specific frontend origin only
NFR-SEC-05: Input validation on all endpoints — reject malformed requests before processing
NFR-SEC-06: Rate limiting: 5 failed login attempts per 15 minutes, then 15-minute lockout
NFR-SEC-07: No sensitive data in URL query parameters (tokens, passwords)
NFR-SEC-08: R2 receipts accessible only via presigned URLs with short TTL (15 minutes)

NFR-DATA-01: Transfers are atomic: both legs succeed or neither does (single D1 transaction)
NFR-DATA-02: Account balances are always derivable from transactions + initial balance (no stored running total as source of truth)
NFR-DATA-03: Client-generated UUIDs for offline support; server enforces uniqueness
NFR-DATA-04: Schema migrations are versioned and forward-only
NFR-DATA-05: Export format is versioned; importers must handle version differences

NFR-REL-01: Idempotent transaction creation (by client UUID) to handle retry-after-timeout
NFR-REL-02: Graceful handling of D1 row limits and R2 storage limits with clear error messages
NFR-REL-03: Health check endpoint returning D1/R2/KV connectivity status

NFR-MAINT-01: TypeScript strict mode, no `any` types in domain logic
NFR-MAINT-02: Database schema managed via numbered migration files
NFR-MAINT-03: API versioning via URL prefix (`/api/v1/`) to allow future breaking changes
NFR-MAINT-04: Structured JSON error responses with error codes
NFR-MAINT-05: OpenAPI spec generated or maintained alongside implementation

NFR-OPS-01: Single `wrangler deploy` command deploys the complete backend
NFR-OPS-02: Environment configuration via wrangler.toml bindings (D1, R2, KV) and secrets
NFR-OPS-03: Zero-downtime deployments (Cloudflare Workers default behavior)
NFR-OPS-04: D1 point-in-time recovery available via Cloudflare dashboard

### Additional Requirements

- Starter template: Architecture specifies the project lives at `apps/api/` within the monorepo (Hono on Cloudflare Workers, already scaffolded)
- Post-scaffold dependencies (installed via bun in apps/api/): drizzle-orm, @hono/zod-openapi, zod, @noble/hashes, aws4fetch (core); drizzle-kit, @cloudflare/vitest-pool-workers, @cloudflare/workers-types, vitest, typescript, wrangler (dev)
- wrangler.toml must configure D1, R2, KV bindings and Cron Trigger for weekly backup
- Drizzle ORM for all database access — no raw SQL
- Amount storage as TEXT (string decimal) — never floating-point
- TypeScript aggregation for balance calculations (not SQL SUM on string amounts)
- Decimal math library needed (candidates: decimal.js-light, big.js)
- Password hashing: argon2id via @noble/hashes (primary), PBKDF2-SHA256 via Web Crypto (fallback)
- Session tokens via crypto.getRandomValues() (256-bit)
- R2 presigned URLs via aws4fetch library
- OpenAPI via @hono/zod-openapi for explicit route definitions
- Cursor-based pagination for transactions; simple offset for low-volume lists (accounts, categories)
- db.batch() for atomic transfers — verify guarantees at implementation time; fallback to single compound INSERT if not atomic
- Cron Trigger for weekly backup export to R2 (reuses JSON export logic)
- Observability via `observability.enabled: true` in wrangler.toml + structured JSON console.log
- ctx.waitUntil() for activity logging and non-critical post-response tasks
- eslint import restriction: lib/ never imports from services/ or routes/
- Services are pure functions receiving dependencies as parameters (db, kv, env, userId)
- Routes are thin: validate → call service → respond
- Structured error shape: `{ error: { code, message, details? } }`

### UX Design Requirements

N/A — Backend-only project. No UX design document.

### FR Coverage Map

FR-AUTH-01: Epic 1 - Password-based authentication
FR-AUTH-02: Epic 1 - In-app password change
FR-AUTH-03: Epic 1 - Session token management via KV
FR-AUTH-04: Epic 1 - Configurable session timeout
FR-AUTH-05: Epic 1 - Logout endpoint
FR-AUTH-06: Epic 1 - Rate limiting on login attempts
FR-SETUP-01: Epic 1 - First-run detection
FR-SETUP-02: Epic 1 - Initial setup wizard endpoint
FR-SETUP-03: Epic 1 - Currency configuration

FR-ACCT-01: Epic 2 - Account CRUD operations
FR-ACCT-02: Epic 2 - Account types (bank, cash, e-wallet, credit card, loan, investment)
FR-ACCT-03: Epic 2 - Asset vs liability balance logic
FR-ACCT-04: Epic 2 - Initial balance entry
FR-ACCT-05: Epic 2 - Per-account current balance calculation
FR-ACCT-06: Epic 2 - Account listing with balances
FR-ACCT-07: Epic 2 - Account currency assignment
FR-CAT-01: Epic 2 - Category CRUD
FR-CAT-02: Epic 2 - Starter category seed
FR-CAT-03: Epic 2 - Income category types
FR-CAT-04: Epic 2 - Category usage tracking

FR-TXN-01: Epic 3 - Create expense transaction
FR-TXN-02: Epic 3 - Create income transaction
FR-TXN-03: Epic 3 - Create transfer between accounts
FR-TXN-04: Epic 3 - Update transaction
FR-TXN-05: Epic 3 - Soft-delete transaction
FR-TXN-06: Epic 3 - Transaction attribution
FR-TXN-07: Epic 3 - Notes/memo field
FR-TXN-08: Epic 3 - Transaction listing with pagination
FR-TXN-09: Epic 3 - Transaction search and filter
FR-TXN-10: Epic 3 - Offline transaction queue support (idempotent upsert)
FR-DEL-01: Epic 3 - Soft delete for transactions
FR-DEL-02: Epic 3 - List deleted items (trash)
FR-DEL-03: Epic 3 - Restore deleted item
FR-DEL-04: Epic 3 - Permanent purge

FR-REC-01: Epic 4 - Create recurring transaction template
FR-REC-02: Epic 4 - Generate upcoming entries
FR-REC-03: Epic 4 - Confirm/post a recurring entry
FR-REC-04: Epic 4 - Skip a recurring entry
FR-REC-05: Epic 4 - Update/delete recurring template
FR-REC-06: Epic 4 - Upcoming payments list
FR-RCP-01: Epic 4 - Upload receipt file to R2
FR-RCP-02: Epic 4 - Link receipt to transaction
FR-RCP-03: Epic 4 - Generate presigned download URL
FR-RCP-04: Epic 4 - Delete receipt
FR-RCP-05: Epic 4 - List receipts for a transaction

FR-VIEW-01: Epic 5 - Net worth calculation
FR-VIEW-02: Epic 5 - Net worth breakdown by account
FR-VIEW-03: Epic 5 - Spending by category for a given month
FR-VIEW-04: Epic 5 - Dashboard data endpoint
FR-VIEW-05: Epic 5 - Monthly summary report
FR-VIEW-06: Epic 5 - Monthly cash flow
FR-EXP-01: Epic 5 - Full JSON export
FR-EXP-02: Epic 5 - CSV export of transactions
FR-EXP-03: Epic 5 - Export includes metadata

FR-COLLAB-01: Epic 6 - Solo mode as default
FR-COLLAB-02: Epic 6 - Generate partner invite link
FR-COLLAB-03: Epic 6 - Accept invite and create partner account
FR-COLLAB-04: Epic 6 - Shared data access
FR-COLLAB-05: Epic 6 - Per-transaction user attribution
FR-COLLAB-06: Epic 6 - Activity log
FR-COLLAB-07: Epic 6 - Revoke partner access

## Epic List

### Epic 1: Project Foundation & Authentication
Users can deploy the API, authenticate securely, set up their instance (currency, display name), and manage sessions with rate-limited login protection. All cross-cutting infrastructure patterns are established: OpenAPI route definitions, structured error handling, test harness, migration workflow, multi-user context, and `ctx.waitUntil()` pattern.
**FRs covered:** FR-AUTH-01, FR-AUTH-02, FR-AUTH-03, FR-AUTH-04, FR-AUTH-05, FR-AUTH-06, FR-SETUP-01, FR-SETUP-02, FR-SETUP-03
**NFRs addressed:** NFR-SEC-01 through NFR-SEC-07, NFR-MAINT-01 through NFR-MAINT-05, NFR-OPS-01 through NFR-OPS-04, NFR-REL-03
**Cross-cutting patterns established:** @hono/zod-openapi route pattern, global error handler (NFR-MAINT-04), vitest + pool-workers test harness with factories, Drizzle migration workflow (NFR-MAINT-02), auth middleware with userId context, settings GET/PUT endpoints, health check (NFR-REL-03), ctx.waitUntil() pattern

### Epic 2: Accounts & Categories
Users can create and manage financial accounts with correct asset/liability semantics and computed balances, and manage expense/income categories with starter defaults.
**FRs covered:** FR-ACCT-01, FR-ACCT-02, FR-ACCT-03, FR-ACCT-04, FR-ACCT-05, FR-ACCT-06, FR-ACCT-07, FR-CAT-01, FR-CAT-02, FR-CAT-03, FR-CAT-04
**NFRs addressed:** NFR-PERF-01, NFR-DATA-02
**Includes:** lib/decimal.ts string decimal math utilities, account balance derivation logic

### Epic 3: Transactions & Soft-Delete
Users can record expenses, income, and transfers, browse transaction history with search and pagination, and recover accidentally deleted items from trash.
**FRs covered:** FR-TXN-01, FR-TXN-02, FR-TXN-03, FR-TXN-04, FR-TXN-05, FR-TXN-06, FR-TXN-07, FR-TXN-08, FR-TXN-09, FR-TXN-10, FR-DEL-01, FR-DEL-02, FR-DEL-03, FR-DEL-04
**NFRs addressed:** NFR-PERF-01, NFR-PERF-04, NFR-DATA-01, NFR-DATA-03, NFR-REL-01
**Includes:** Atomic transfers via db.batch() (spike first), cursor-based pagination, idempotent upsert by client UUID, soft-delete + trash + restore + purge

### Epic 4: Recurring Transactions & Receipts
Users can set up recurring payment templates with flexible frequencies, manage upcoming occurrences (confirm or skip), and attach receipt files to any transaction with secure presigned URL access.
**FRs covered:** FR-REC-01, FR-REC-02, FR-REC-03, FR-REC-04, FR-REC-05, FR-REC-06, FR-RCP-01, FR-RCP-02, FR-RCP-03, FR-RCP-04, FR-RCP-05
**NFRs addressed:** NFR-PERF-03, NFR-SEC-08
**Includes:** On-demand occurrence generation (compute next N from template), R2 presigned URLs via aws4fetch (15-min TTL)

### Epic 5: Dashboard, Reports & Data Export
Users can view their financial health at a glance, generate monthly reports, export all data in JSON or CSV, and have automated weekly backups to R2.
**FRs covered:** FR-VIEW-01, FR-VIEW-02, FR-VIEW-03, FR-VIEW-04, FR-VIEW-05, FR-VIEW-06, FR-EXP-01, FR-EXP-02, FR-EXP-03
**NFRs addressed:** NFR-PERF-02, NFR-DATA-05
**Includes:** Weekly backup Cron Trigger (reuses JSON export logic, writes to R2)

### Epic 6: Collaboration
The primary user can invite a partner via a one-time secret link, granting equal access to all shared financial data. All mutations are attributed per-user with an always-on activity log, and partner access can be revoked.
**FRs covered:** FR-COLLAB-01, FR-COLLAB-02, FR-COLLAB-03, FR-COLLAB-04, FR-COLLAB-05, FR-COLLAB-06, FR-COLLAB-07
**Includes:** Activity log (always-on, works in solo mode too) using ctx.waitUntil() pattern (established in Epic 1), invite link via KV with 24h expiry

## Epic 1: Project Foundation & Authentication

Users can deploy the API, authenticate securely, set up their instance (currency, display name), and manage sessions with rate-limited login protection. All cross-cutting infrastructure patterns are established.

### Story 1.1: Project Scaffold & Infrastructure Configuration

As a developer,
I want a fully configured Hono project on Cloudflare Workers with all dependencies, bindings, and tooling ready,
So that I can immediately start building features without infrastructure setup blocking me.

**Acceptance Criteria:**

**Given** the existing project at `apps/api/` in the monorepo
**When** the scaffold is configured with all required dependencies and tooling
**Then** the project builds and runs with `wrangler dev` (from `apps/api/`)
**And** all core dependencies are installed via bun (drizzle-orm, @hono/zod-openapi, zod, @noble/hashes, aws4fetch)
**And** all dev dependencies are installed via bun (drizzle-kit, @cloudflare/vitest-pool-workers, @cloudflare/workers-types, vitest, typescript, wrangler)
**And** wrangler.toml configures D1 binding (DB), R2 binding (RECEIPTS), KV binding (SESSIONS), and Cron Trigger (`0 3 * * 0`)
**And** wrangler.toml has `observability.enabled = true` and `nodejs_compat` compatibility flag
**And** tsconfig.json has strict mode enabled with no `any` in domain logic
**And** vitest.config.ts is configured with `@cloudflare/vitest-pool-workers`
**And** drizzle.config.ts points to the D1 database
**And** the project directory structure exists: src/routes/, src/services/, src/middleware/, src/db/schema/, src/lib/, src/schemas/, src/types/ (all under `apps/api/`)
**And** a test helper module exists at tests/setup.ts with seed utilities and a factory pattern
**And** `.env.example` documents required secrets (INITIAL_PASSWORD)
**And** `.gitignore` excludes .wrangler/, .dev.vars, node_modules/
**And** `wrangler types` generates binding types in src/types/env.ts
**And** eslint is configured with import restriction rules preventing `src/lib/` from importing `src/services/` or `src/routes/`

### Story 1.2: Database Schema & Migration Workflow

As a developer,
I want the foundational database tables (users, settings) created via Drizzle with a repeatable migration workflow,
So that all subsequent epics can follow the same pattern for schema changes.

**Acceptance Criteria:**

**Given** the project scaffold from Story 1.1 (at `apps/api/`)
**When** the Drizzle schema is defined for `users` table
**Then** the `users` table has columns: id (TEXT UUID PK), display_name (TEXT), password_hash (TEXT), role (TEXT: 'primary' | 'partner'), is_active (INTEGER 1/0 default 1), created_at (TEXT ISO 8601)
**And** the `settings` table has columns: key (TEXT PK), value (TEXT), updated_at (TEXT ISO 8601)
**And** schema files are created per-domain: `src/db/schema/users.ts` for users table, `src/db/schema/settings.ts` for settings table
**And** `src/db/schema/index.ts` is a barrel file that re-exports all table definitions
**And** `drizzle-kit generate` produces a numbered SQL migration file in src/db/migrations/
**And** `wrangler d1 migrations apply DB --local` applies the migration successfully
**And** the schema file exports all table definitions from src/db/schema/index.ts
**And** each subsequent epic creates new schema files per-domain (e.g., `src/db/schema/accounts.ts`) and adds them to the barrel export
**And** a test verifies the migration applies cleanly and tables are queryable
**And** the migration workflow is documented: generate → review SQL → apply local → apply remote

### Story 1.3: Global Middleware & Error Handling

As a developer,
I want consistent error handling, input validation, CORS, and OpenAPI route patterns established,
So that every subsequent route follows the same conventions without per-route boilerplate.

**Acceptance Criteria:**

**Given** the project with schema from Story 1.2
**When** a route throws an unhandled error
**Then** the global error handler returns `{ error: { code: "INTERNAL_ERROR", message: "..." } }` with status 500
**And** stack traces and internal details are never exposed to the client
**And** errors are logged server-side via `console.error(JSON.stringify({ level, action, error }))`

**Given** a request with invalid input (fails Zod validation)
**When** the zValidator middleware rejects it
**Then** the response is `{ error: { code: "VALIDATION_ERROR", message: "...", details: [...] } }` with status 400

**Given** any request to the API
**When** CORS headers are evaluated
**Then** only the configured frontend origin is allowed (via Hono `cors()` middleware)

**Given** a new route needs to be created
**When** the developer follows the established pattern
**Then** routes use `@hono/zod-openapi` with `OpenAPIHono` as the base app class and `createRoute()` for route definitions with Zod schemas for request/response
**And** at least one example route demonstrates the full pattern: route definition object (method, path, request schema, responses) separate from the handler function
**And** `@hono/zod-openapi` provides built-in validation (no separate `@hono/zod-validator` needed)

**Given** a route handler needs to perform non-blocking post-response work
**When** `ctx.waitUntil()` is called with a promise
**Then** the response is sent immediately and the background work completes asynchronously

### Story 1.4: Authentication — Login & Session Management

As the app owner,
I want to log in with my password and receive a session token,
So that I can securely access all protected API endpoints.

**Acceptance Criteria:**

**Given** the initial password is set via INITIAL_PASSWORD environment secret
**When** no user exists in the `users` table and the first login attempt is made with the correct INITIAL_PASSWORD
**Then** a primary user record is created with the password hashed (argon2id or PBKDF2-SHA256 fallback)
**And** `lib/crypto.ts` implements `hashPassword()` and `verifyPassword()` that attempt argon2id via `@noble/hashes` and fall back to PBKDF2-SHA256 via Web Crypto API if argon2id is unavailable or throws
**And** an opaque session token (256-bit, cryptographically random) is returned
**And** the session token is stored in KV with a TTL of 30 minutes (default)
**And** the token itself is used as the KV key (lookup via `kv.get(token)` — no timing-safe comparison needed for lookup)

**Given** a valid session token exists in KV
**When** a request includes `Authorization: Bearer {token}` header
**Then** the auth middleware looks up the token via `kv.get(token)`
**And** if found, `c.set('userId', ...)` is populated for downstream handlers
**And** the session TTL is refreshed (sliding expiration)

**Given** service functions in this story
**When** implemented
**Then** they follow the pattern: `export async function createSession(db: DrizzleD1Database, kv: KVNamespace, userId: string): Promise<string>` — pure functions receiving dependencies as parameters, never importing db/kv directly

**Given** an invalid or expired session token
**When** a request is made to a protected endpoint
**Then** the response is `{ error: { code: "UNAUTHORIZED", message: "..." } }` with status 401

**Given** a valid session
**When** `POST /api/v1/auth/logout` is called
**Then** the session token is deleted from KV immediately
**And** subsequent requests with that token return 401

**Given** a valid session
**When** `GET /api/v1/auth/session` is called
**Then** the response confirms the session is valid and returns the user's display_name and role

**Given** the public endpoints (login, accept-invite, first-run check, health)
**When** accessed without a session token
**Then** they respond normally without requiring authentication (NFR-SEC-01)

### Story 1.5: Authentication — Password Change & Rate Limiting

As the app owner,
I want to change my password and be protected from brute-force login attempts,
So that my financial data remains secure even if the initial password was weak.

**Acceptance Criteria:**

**Given** a valid session
**When** `POST /api/v1/auth/change-password` is called with correct current_password and valid new_password
**Then** the new password is hashed and stored in D1 (replacing the previous hash)
**And** all existing sessions for the user remain valid (no forced logout)
**And** the response confirms success

**Given** a valid session
**When** `POST /api/v1/auth/change-password` is called with incorrect current_password
**Then** the response is `{ error: { code: "UNAUTHORIZED", message: "Current password is incorrect" } }` with status 401

**Given** 5 failed login attempts within 15 minutes from any source
**When** a 6th login attempt is made
**Then** the response is `{ error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again in 15 minutes." } }` with status 429
**And** the lockout persists for 15 minutes regardless of correct credentials

**Given** the rate limit window has expired (15 minutes elapsed)
**When** a login attempt is made with correct credentials
**Then** login succeeds normally and the counter resets

**Given** the session timeout setting
**When** `PUT /api/v1/settings` updates the session_timeout value
**Then** new sessions use the updated TTL
**And** existing sessions retain their original TTL until refreshed

### Story 1.6: Setup Wizard & Health Check

As the app owner,
I want to detect if my instance needs initial setup and configure it in one step,
So that I can get started quickly after deployment without manual database manipulation.

**Acceptance Criteria:**

**Given** a freshly deployed instance with no users in the database
**When** `GET /api/v1/setup/status` is called
**Then** the response is `{ "is_setup_complete": false }`

**Given** setup is not complete
**When** `POST /api/v1/setup/initialize` is called with display_name, base_currency, and seed_categories (boolean)
**Then** the base currency is stored in settings
**And** the display_name is stored in settings (key: `display_name`) and will be applied to the primary user record on first login
**And** if seed_categories is true, a setting `seed_categories_on_first_use` is stored (actual category creation happens in Epic 2)
**And** the setup is marked as complete in settings (key: `setup_complete`, value: `true`)
**And** subsequent calls to `GET /api/v1/setup/status` return `{ "is_setup_complete": true }`

**Given** setup is already complete
**When** `POST /api/v1/setup/initialize` is called again
**Then** the response is `{ error: { code: "SETUP_ALREADY_COMPLETE", message: "..." } }` with status 409

**Given** a valid session
**When** `GET /api/v1/settings` is called
**Then** all current settings are returned (base_currency, session_timeout, etc.)

**Given** a valid session
**When** `PUT /api/v1/settings` is called with valid key-value pairs
**Then** the specified settings are updated and the response confirms the new values

**Given** any request to `GET /api/v1/health`
**When** the endpoint is called (no auth required)
**Then** the response includes connectivity status for D1, R2, and KV
**And** each service shows "ok" or "error" with a brief message
**And** the overall status is "healthy" only if all services are reachable

## Epic 2: Accounts & Categories

Users can create and manage financial accounts with correct asset/liability semantics and computed balances, and manage expense/income categories with starter defaults.

### Story 2.1: Category CRUD & Seed

As the app owner,
I want to create, manage, and seed expense/income categories,
So that I can organize my transactions by meaningful spending and earning types.

**Acceptance Criteria:**

**Given** the database has no categories table
**When** the migration for this story is applied
**Then** the `categories` table exists with columns: id (TEXT UUID PK), name (TEXT), type (TEXT: 'expense' | 'income'), usage_count (INTEGER default 0), created_by (TEXT FK users.id), updated_by (TEXT FK users.id), created_at (TEXT ISO 8601), updated_at (TEXT ISO 8601)

**Given** a valid session
**When** `POST /api/v1/categories` is called with `{ "name": "Food", "type": "expense" }`
**Then** a new category is created and returned with its generated UUID
**And** the response includes all fields (id, name, type, usage_count, created_at)

**Given** a valid session
**When** `GET /api/v1/categories` is called
**Then** all categories are returned as `{ "items": [...] }` sorted by usage_count descending (most used first)
**And** categories can be filtered by type query param (`?type=expense` or `?type=income`)

**Given** a valid session and an existing category
**When** `PUT /api/v1/categories/:id` is called with `{ "name": "Groceries" }`
**Then** the category name is updated and the updated category is returned

**Given** a valid session and an existing category
**When** `DELETE /api/v1/categories/:id` is called
**Then** if no transactions reference this category, the category is hard-deleted and the response is 204 No Content
**And** if transactions reference this category, the response is `{ error: { code: "CATEGORY_IN_USE", message: "Cannot delete category with existing transactions" } }` with status 409

**Given** a valid session
**When** `POST /api/v1/categories/seed` is called
**Then** default expense categories are created: Food, Transport, Housing, Utilities, Entertainment, Health, Shopping, Education, Other
**And** default income categories are created: Salary, Freelance, Gift, Refund, Interest, Other
**And** if categories already exist, duplicates are not created (idempotent by name+type)

**Given** a category that does not exist
**When** any operation references it by ID
**Then** the response is `{ error: { code: "CATEGORY_NOT_FOUND", message: "..." } }` with status 404

### Story 2.2: Account CRUD & Balance Logic

As the app owner,
I want to create and manage financial accounts with correct asset/liability classification,
So that I can track where my money lives and what I owe.

**Acceptance Criteria:**

**Given** the database has no accounts table
**When** the migration for this story is applied
**Then** the `accounts` table exists with columns: id (TEXT UUID PK), name (TEXT), type (TEXT: 'bank' | 'cash' | 'ewallet' | 'credit_card' | 'loan' | 'investment'), currency (TEXT), initial_balance (TEXT string decimal), is_active (INTEGER 1/0 default 1), created_by (TEXT FK users.id), updated_by (TEXT FK users.id), created_at (TEXT ISO 8601), updated_at (TEXT ISO 8601)

**Given** a valid session
**When** `POST /api/v1/accounts` is called with `{ "name": "BCA Savings", "type": "bank", "currency": "IDR", "initial_balance": "5000000.00" }`
**Then** a new account is created with the provided initial_balance stored as string decimal
**And** created_by is set to the authenticated user's ID
**And** the full account object is returned

**Given** a valid session
**When** `GET /api/v1/accounts` is called
**Then** all active accounts are returned (is_active = 1)
**And** each account includes its type, currency, and initial_balance

**Given** a valid session and an existing account
**When** `GET /api/v1/accounts/:id` is called
**Then** the full account details are returned

**Given** a valid session and an existing account
**When** `PUT /api/v1/accounts/:id` is called with updated fields (name, type, currency)
**Then** the account is updated, updated_at is refreshed, and the updated account is returned
**And** initial_balance is NOT editable after creation

**Given** a valid session and an existing account
**When** `DELETE /api/v1/accounts/:id` is called
**Then** the account is soft-deleted (is_active = 0)
**And** the response is 204 No Content
**And** the account no longer appears in `GET /api/v1/accounts` listing
**And** new transactions cannot be created against this account (rejected with `{ error: { code: "ACCOUNT_INACTIVE", message: "..." } }` status 400)

**Given** a valid session and a soft-deleted account
**When** `PUT /api/v1/accounts/:id` is called with `{ "is_active": true }`
**Then** the account is restored (is_active = 1) and appears in listings again

**Given** account types bank, cash, ewallet, investment
**When** balance is calculated
**Then** they are classified as assets (positive balance increases net worth)

**Given** account types credit_card, loan
**When** balance is calculated
**Then** they are classified as liabilities (positive balance decreases net worth)

**Given** an invalid account type not in the enum
**When** `POST /api/v1/accounts` is called
**Then** the response is a validation error with status 400

### Story 2.3: String Decimal Math Library & Account Balance Derivation

As the app owner,
I want to see accurate current balances for each account and my total net worth,
So that I know exactly how much money I have without floating-point rounding errors.

**Acceptance Criteria:**

**Given** the `lib/decimal.ts` module
**When** string decimal operations are performed
**Then** `add("12.50", "3.75")` returns `"16.25"`
**And** `subtract("100.00", "33.33")` returns `"66.67"`
**And** `sum(["1.10", "2.20", "3.30"])` returns `"6.60"`
**And** `compare("10.00", "9.99")` returns 1 (first is greater)
**And** `compare("5.00", "5.00")` returns 0 (equal)
**And** `compare("1.00", "2.00")` returns -1 (first is less)
**And** operations preserve precision as-entered (no rounding on input)
**And** negative amounts are supported (e.g., `"-50.00"`)
**And** operations never use floating-point arithmetic internally

**Given** a valid session
**When** `GET /api/v1/accounts` is called
**Then** each account includes a `current_balance` field
**And** current_balance = initial_balance + sum of all non-deleted transactions affecting the account
**And** for accounts with no transactions yet, current_balance equals initial_balance
**And** the balance derivation service gracefully returns initial_balance when the transactions table does not yet exist or is empty (forward-compatible with Epic 3)

**Given** a valid session
**When** `GET /api/v1/accounts` is called
**Then** the response includes a `summary` object with `total_assets`, `total_liabilities`, and `net_worth`
**And** net_worth = total_assets - total_liabilities
**And** all amounts are string decimals

**Given** an account with initial_balance "1000.00" and no transactions
**When** the balance is derived
**Then** current_balance is "1000.00"

**Given** a soft-deleted account (is_active = 0)
**When** `GET /api/v1/accounts` is called
**Then** the soft-deleted account is excluded from the listing and net worth calculation

## Epic 3: Transactions & Soft-Delete

Users can record expenses, income, and transfers, browse transaction history with search and pagination, and recover accidentally deleted items from trash.

### Story 3.1: Expense & Income Transactions

As the app owner,
I want to record expense and income transactions with category, payee, and notes,
So that I have a complete record of where my money goes and comes from.

**Acceptance Criteria:**

**Given** the database has no transactions table
**When** the migration for this story is applied
**Then** the `transactions` table exists with columns: id (TEXT UUID PK, client-generated), type (TEXT: 'expense' | 'income' | 'transfer'), amount (TEXT string decimal), account_id (TEXT FK accounts.id), destination_account_id (TEXT nullable, for transfers), category_id (TEXT FK categories.id), payee (TEXT nullable), notes (TEXT nullable), date (TEXT ISO 8601 date), created_by (TEXT FK users.id), updated_by (TEXT FK users.id), is_deleted (INTEGER 0/1 default 0), deleted_at (TEXT nullable), created_at (TEXT ISO 8601), updated_at (TEXT ISO 8601)

**Given** a valid session and existing account and category
**When** `POST /api/v1/transactions` is called with `{ "id": "client-uuid-123", "type": "expense", "amount": "50000.00", "account_id": "...", "category_id": "...", "date": "2026-05-28", "payee": "Warung Makan", "notes": "Lunch" }`
**Then** an expense transaction is created with the client-provided UUID as primary key
**And** created_by and updated_by are set to the authenticated user's ID
**And** the full transaction object is returned

**Given** a valid session
**When** `POST /api/v1/transactions` is called with `{ "type": "income", "amount": "15000000.00", "account_id": "...", "category_id": "...", "date": "2026-05-01" }`
**Then** an income transaction is created
**And** if no `id` is provided, the server generates a UUID

**Given** a transaction with a specific client-generated UUID already exists
**When** `POST /api/v1/transactions` is called with the same UUID
**Then** the existing transaction is returned unchanged (idempotent — request body is ignored, existing record returned as-is)
**And** the response status is 200 (not 201)

**Given** a transaction is successfully created
**When** the category_id is valid
**Then** the referenced category's usage_count is incremented by 1

**Given** a valid session and an existing transaction
**When** `GET /api/v1/transactions/:id` is called
**Then** the full transaction details are returned including account name, category name

**Given** a request with missing required fields (amount, account_id, type)
**When** `POST /api/v1/transactions` is called
**Then** the response is a validation error with status 400

**Given** a request referencing a non-existent account_id or category_id
**When** `POST /api/v1/transactions` is called
**Then** the response is `{ error: { code: "ACCOUNT_NOT_FOUND", message: "..." } }` or `{ error: { code: "CATEGORY_NOT_FOUND", message: "..." } }` with status 404

**Given** no date is provided in the request
**When** `POST /api/v1/transactions` is called
**Then** the date defaults to today (ISO 8601 date-only format)

### Story 3.2: Transfer Between Accounts

As the app owner,
I want to transfer money between my accounts as a single logical event,
So that moving money between wallets doesn't get double-counted as income or expense.

**Acceptance Criteria:**

**Given** a valid session and two existing accounts
**When** `POST /api/v1/transactions` is called with `{ "type": "transfer", "amount": "1000000.00", "account_id": "source-id", "destination_account_id": "dest-id", "date": "2026-05-28" }`
**Then** a single transfer transaction record is created
**And** the source account balance decreases by the amount
**And** the destination account balance increases by the amount
**And** both balance changes are atomic (via `db.batch()` or single compound statement)

**Given** a transfer transaction
**When** account balances are calculated
**Then** the transfer amount is subtracted from the source account's balance
**And** the transfer amount is added to the destination account's balance
**And** the transfer is NOT counted as income or expense in any aggregation

**Given** a transfer where source and destination are the same account
**When** `POST /api/v1/transactions` is called
**Then** the response is `{ error: { code: "TRANSFER_SAME_ACCOUNT", message: "..." } }` with status 400

**Given** a transfer request without destination_account_id
**When** `POST /api/v1/transactions` is called with type "transfer"
**Then** the response is a validation error with status 400

**Given** a transfer request referencing a non-existent destination account
**When** `POST /api/v1/transactions` is called
**Then** the response is `{ error: { code: "ACCOUNT_NOT_FOUND", message: "..." } }` with status 404

**Given** the `db.batch()` atomicity guarantee needs verification
**When** an integration test inserts two rows in a batch where the second deliberately fails (e.g., unique constraint violation)
**Then** the test confirms whether the first row was committed or rolled back
**And** if `db.batch()` is NOT atomic (first row committed despite second failing), the transfer implementation uses a single INSERT statement with a subquery or alternative atomic pattern instead of batch
**And** if `db.batch()` IS atomic, transfers use `db.batch([debitStmt, creditStmt])` for the balance update

### Story 3.3: Transaction Update, Soft-Delete & Trash

As the app owner,
I want to edit transactions, safely delete them with recovery, and permanently purge old trash,
So that I can fix mistakes without losing data permanently.

**Acceptance Criteria:**

**Given** a valid session and an existing non-deleted transaction
**When** `PUT /api/v1/transactions/:id` is called with updated fields (amount, category_id, payee, notes, date)
**Then** the transaction is updated with the new values
**And** updated_by is set to the authenticated user's ID
**And** updated_at is refreshed
**And** the updated transaction is returned
**And** affected account balances reflect the change

**Given** a valid session and an existing transfer transaction
**When** `PUT /api/v1/transactions/:id` is called
**Then** only amount, notes, and date are editable on transfers
**And** account_id (source) and destination_account_id cannot be changed (response is `{ error: { code: "TRANSFER_ACCOUNTS_IMMUTABLE", message: "Cannot change accounts on a transfer. Delete and recreate instead." } }` with status 400)
**And** type cannot be changed from/to transfer (response is `{ error: { code: "TYPE_CHANGE_NOT_ALLOWED", message: "Cannot change transaction type. Delete and recreate instead." } }` with status 400)

**Given** a valid session and an existing non-deleted transaction
**When** `DELETE /api/v1/transactions/:id` is called
**Then** the transaction is soft-deleted (is_deleted = 1, deleted_at = now)
**And** the response is 204 No Content
**And** the transaction no longer appears in default transaction listings
**And** the affected account balance no longer includes this transaction

**Given** a valid session
**When** `GET /api/v1/transactions/trash` is called
**Then** all soft-deleted transactions are returned (is_deleted = 1)
**And** each item shows deleted_at timestamp

**Given** a valid session and a soft-deleted transaction within 30 days
**When** `POST /api/v1/transactions/:id/restore` is called
**Then** the transaction is restored (is_deleted = 0, deleted_at = null)
**And** the affected account balance includes this transaction again
**And** the restored transaction is returned

**Given** a valid session
**When** `POST /api/v1/transactions/trash/purge` is called
**Then** all transactions with deleted_at older than 30 days are permanently removed from D1
**And** the response includes the count of purged transactions

**Given** a transaction that is already soft-deleted
**When** `DELETE /api/v1/transactions/:id` is called again
**Then** the response is `{ error: { code: "NOT_FOUND", message: "..." } }` with status 404

**Given** a transaction that does not exist or is permanently purged
**When** `POST /api/v1/transactions/:id/restore` is called
**Then** the response is `{ error: { code: "NOT_FOUND", message: "..." } }` with status 404

### Story 3.4: Transaction Listing, Pagination & Search

As the app owner,
I want to browse my transactions with pagination and filter/search them,
So that I can find specific transactions quickly even with months of history.

**Acceptance Criteria:**

**Given** a valid session
**When** `GET /api/v1/transactions` is called without parameters
**Then** the first page of non-deleted transactions is returned (max 50 items)
**And** transactions are sorted by date descending (newest first)
**And** the response format is `{ "items": [...], "next_cursor": "...", "has_more": true/false }`

**Given** a response with `has_more: true` and a `next_cursor` value
**When** `GET /api/v1/transactions?cursor={next_cursor}` is called
**Then** the next page of results is returned starting after the cursor position
**And** the cursor is an opaque base64-encoded string representing a (date, id) composite key for stable ordering
**And** page size defaults to 50, configurable via `?page_size=25` (max 50)

**Given** a valid session
**When** `GET /api/v1/transactions?start_date=2026-05-01&end_date=2026-05-31` is called
**Then** only transactions within the date range (inclusive) are returned

**Given** a valid session
**When** `GET /api/v1/transactions?account_id={id}` is called
**Then** only transactions for that account are returned (including transfers where it's source or destination)

**Given** a valid session
**When** `GET /api/v1/transactions?category_id={id}` is called
**Then** only transactions with that category are returned

**Given** a valid session
**When** `GET /api/v1/transactions?min_amount=100000&max_amount=500000` is called
**Then** only transactions with amount within the range (inclusive) are returned

**Given** a valid session
**When** `GET /api/v1/transactions?q=warung` is called
**Then** transactions matching "warung" in payee, notes, or category name are returned (case-insensitive)

**Given** multiple filters are applied simultaneously
**When** `GET /api/v1/transactions?account_id={id}&start_date=2026-05-01&q=food` is called
**Then** all filters are applied with AND logic

**Given** a valid session
**When** `GET /api/v1/transactions` is called
**Then** soft-deleted transactions are excluded from results
**And** only `GET /api/v1/transactions/trash` returns soft-deleted items

## Epic 4: Recurring Transactions & Receipts

Users can set up recurring payment templates with flexible frequencies, manage upcoming occurrences (confirm or skip), and attach receipt files to any transaction with secure presigned URL access.

### Story 4.1: Recurring Transaction Templates

As the app owner,
I want to define recurring payment templates with a frequency schedule,
So that I don't have to manually re-enter the same bills and subscriptions every period.

**Acceptance Criteria:**

**Given** the database has no recurring tables
**When** the migration for this story is applied
**Then** the `recurring_templates` table exists with columns: id (TEXT UUID PK), type (TEXT: 'expense' | 'income'), amount (TEXT string decimal), account_id (TEXT FK accounts.id), category_id (TEXT FK categories.id), payee (TEXT nullable), notes (TEXT nullable), frequency (TEXT: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'), start_date (TEXT ISO 8601 date), end_date (TEXT nullable), is_active (INTEGER 1/0 default 1), created_by (TEXT FK users.id), updated_by (TEXT FK users.id), created_at (TEXT ISO 8601), updated_at (TEXT ISO 8601)
**And** the `recurring_occurrences` table exists with columns: id (TEXT UUID PK), template_id (TEXT FK recurring_templates.id), due_date (TEXT ISO 8601 date), status (TEXT: 'pending' | 'posted' | 'skipped'), transaction_id (TEXT nullable FK transactions.id), created_at (TEXT ISO 8601)

**Given** a valid session and existing account and category
**When** `POST /api/v1/recurring` is called with `{ "type": "expense", "amount": "150000.00", "account_id": "...", "category_id": "...", "frequency": "monthly", "start_date": "2026-06-01", "payee": "Internet Provider", "notes": "Home internet" }`
**Then** a recurring template is created and returned with all fields
**And** created_by is set to the authenticated user's ID

**Given** a valid session
**When** `GET /api/v1/recurring` is called
**Then** all active recurring templates are returned as `{ "items": [...] }`
**And** each template includes its frequency, next_due_date (earliest future date computed from frequency and start_date, excluding posted/skipped occurrences), and account/category names

**Given** a valid session and an existing template
**When** `GET /api/v1/recurring/:id` is called
**Then** the full template details are returned

**Given** a valid session and an existing template
**When** `PUT /api/v1/recurring/:id` is called with updated fields (amount, category_id, frequency, end_date, payee, notes)
**Then** the template is updated and changes apply to future occurrences only
**And** existing posted/skipped occurrences are not affected
**And** updated_at is refreshed

**Given** a valid session and an existing template
**When** `DELETE /api/v1/recurring/:id` is called
**Then** the template is deactivated (is_active = 0)
**And** no future occurrences will be generated
**And** the response is 204 No Content

**Given** an invalid frequency value
**When** `POST /api/v1/recurring` is called
**Then** the response is a validation error with status 400

### Story 4.2: Occurrence Generation, Confirm & Skip

As the app owner,
I want to see upcoming recurring payments and confirm or skip each one,
So that I maintain control over what actually gets posted as a transaction.

**Acceptance Criteria:**

**Given** a valid session and an active recurring template with frequency "monthly" and start_date "2026-06-01"
**When** `GET /api/v1/recurring/:id/upcoming` is called
**Then** the next N occurrences are computed based on the template's frequency and start_date (default N=12, configurable via `?limit=N`, max 52)
**And** occurrences that already exist (posted or skipped) are included with their status
**And** future occurrences not yet in the database are returned as "pending" with computed due_dates
**And** occurrences past the end_date (if set) are not generated

**Given** a valid session
**When** `GET /api/v1/recurring` is called with upcoming payments context
**Then** a consolidated list of all expected recurring payments within the next 30 days is available via `GET /api/v1/recurring?upcoming_days=30`
**And** each entry shows template name, amount, due_date, account, and status

**Given** a valid session and a pending occurrence
**When** `POST /api/v1/recurring/:id/occurrences/:occId/confirm` is called
**Then** an actual transaction is created in the transactions table with the template's amount, account, category, payee, notes, and the occurrence's due_date
**And** the occurrence status is updated to "posted"
**And** the occurrence's transaction_id is set to the newly created transaction
**And** the account balance reflects the new transaction

**Given** a valid session and a pending occurrence
**When** `POST /api/v1/recurring/:id/occurrences/:occId/skip` is called
**Then** the occurrence status is updated to "skipped"
**And** no transaction is created
**And** the template remains active for future occurrences

**Given** an occurrence that is already posted or skipped
**When** confirm or skip is called again
**Then** the response is `{ error: { code: "OCCURRENCE_ALREADY_PROCESSED", message: "..." } }` with status 409

**Given** a template with frequency "weekly" and start_date "2026-06-01"
**When** occurrences are generated
**Then** due_dates are: 2026-06-01, 2026-06-08, 2026-06-15, 2026-06-22, etc.

**Given** a template with frequency "monthly" and start_date "2026-01-31"
**When** occurrences are generated for February
**Then** the due_date is adjusted to the last day of the month (2026-02-28)

### Story 4.3: Receipt Upload & Management

As the app owner,
I want to attach receipt images or PDFs to my transactions,
So that I have proof of purchase linked directly to the expense record.

**Acceptance Criteria:**

**Given** the database has no receipts table
**When** the migration for this story is applied
**Then** the `receipts` table exists with columns: id (TEXT UUID PK), transaction_id (TEXT FK transactions.id), r2_key (TEXT), filename (TEXT), content_type (TEXT), size_bytes (INTEGER), created_by (TEXT FK users.id), created_at (TEXT ISO 8601)

**Given** a valid session and an existing transaction
**When** `POST /api/v1/transactions/:id/receipts` is called with a file upload (multipart/form-data)
**Then** the file is stored in R2 with a unique key (e.g., `receipts/{transaction_id}/{uuid}.{ext}`)
**And** a receipt metadata record is created in D1
**And** the response includes the receipt id, filename, content_type, size_bytes, and a presigned download URL

**Given** a file upload with content type not in (image/jpeg, image/png, image/webp, image/heic, application/pdf)
**When** `POST /api/v1/transactions/:id/receipts` is called
**Then** the response is `{ error: { code: "INVALID_FILE_TYPE", message: "..." } }` with status 400

**Given** a file upload exceeding 10MB
**When** `POST /api/v1/transactions/:id/receipts` is called
**Then** the response is `{ error: { code: "FILE_TOO_LARGE", message: "Maximum file size is 10MB" } }` with status 400

**Given** a valid session and a transaction with receipts
**When** `GET /api/v1/transactions/:id/receipts` is called
**Then** all receipt metadata for that transaction is returned
**And** each receipt includes a presigned download URL with 15-minute TTL generated via `lib/r2.ts` using the `aws4fetch` library

**Given** a presigned download URL
**When** accessed within 15 minutes
**Then** the receipt file is downloadable directly from R2

**Given** a presigned download URL
**When** accessed after 15 minutes
**Then** the URL is expired and returns an access denied error

**Given** a transaction that is soft-deleted
**When** `GET /api/v1/transactions/:id/receipts` is called
**Then** receipts remain accessible (soft-delete does not affect receipt access)

**Given** a transaction that is permanently purged (via trash purge)
**When** the purge executes
**Then** all associated receipts are deleted from R2 and their metadata records are removed from D1

**Given** a valid session and an existing receipt
**When** `DELETE /api/v1/receipts/:id` is called
**Then** the file is deleted from R2
**And** the receipt metadata record is deleted from D1
**And** the response is 204 No Content

**Given** multiple receipts attached to one transaction
**When** `GET /api/v1/transactions/:id/receipts` is called
**Then** all receipts are returned (many-to-one relationship supported)

**Given** a transaction that does not exist
**When** `POST /api/v1/transactions/:id/receipts` is called
**Then** the response is `{ error: { code: "TRANSACTION_NOT_FOUND", message: "..." } }` with status 404

## Epic 5: Dashboard, Reports & Data Export

Users can view their financial health at a glance, generate monthly reports, export all data in JSON or CSV, and have automated weekly backups to R2.

### Story 5.1: Net Worth & Dashboard Endpoint

As the app owner,
I want a single dashboard endpoint that shows my complete financial snapshot,
So that I can see my net worth, balances, monthly activity, and upcoming payments in one request.

**Acceptance Criteria:**

**Given** a valid session and accounts with transactions
**When** `GET /api/v1/reports/net-worth` is called
**Then** the response includes `total_assets` (sum of all active asset account balances)
**And** `total_liabilities` (sum of all active liability account balances)
**And** `net_worth` (total_assets - total_liabilities)
**And** `accounts` array with each account's id, name, type, classification (asset/liability), and current_balance
**And** all amounts are string decimals

**Given** a valid session
**When** `GET /api/v1/dashboard` is called
**Then** the response includes:
- `net_worth`: total assets minus total liabilities (string decimal)
- `accounts`: array of all active accounts with current balances
- `current_month`: object with `total_income`, `total_expenses`, `net_savings` for the current calendar month
- `upcoming_payments`: array of recurring occurrences due within the next 7 days, computed on-the-fly from all active recurring templates (same logic as occurrence generation in Epic 4)
**And** the response completes within 500ms (NFR-PERF-02)

**Given** no accounts or transactions exist
**When** `GET /api/v1/dashboard` is called
**Then** net_worth is "0.00", accounts is empty, current_month shows all zeros, upcoming_payments is empty

**Given** accounts with transactions spanning multiple months
**When** `GET /api/v1/dashboard` is called
**Then** current_month calculations only include transactions from the current calendar month (UTC)
**And** transfers are excluded from income/expense totals

### Story 5.2: Monthly Reports

As the app owner,
I want monthly spending breakdowns and summary reports,
So that I can understand my financial patterns and track progress month over month.

**Acceptance Criteria:**

**Given** a valid session and transactions in a specific month
**When** `GET /api/v1/reports/spending-by-category?month=2026-05` is called
**Then** the response includes an array of categories with their total expense amount for that month
**And** each category entry includes: category_id, category_name, amount (string decimal), transaction_count
**And** a `previous_month` comparison is included showing the same categories for the prior month
**And** categories are sorted by amount descending
**And** only expense transactions are included (not income, not transfers)

**Given** a valid session
**When** `GET /api/v1/reports/monthly-summary?month=2026-05` is called
**Then** the response includes:
- `month`: "2026-05"
- `total_income`: sum of all income transactions in the month (string decimal)
- `total_expenses`: sum of all expense transactions in the month (string decimal)
- `net_savings`: total_income - total_expenses (string decimal)
- `top_categories`: top 5 expense categories by amount
- `top_payees`: top 5 payees by total amount
- `net_worth_change`: computed as total_income minus total_expenses for the month (equivalent to the change in net worth, since no historical snapshots are stored)
**And** transfers are excluded from income/expense totals

**Given** a valid session
**When** `GET /api/v1/reports/cash-flow?month=2026-05` is called
**Then** the response includes `total_income`, `total_expenses`, and `net_cash_flow` (income - expenses) for that month
**And** all amounts are string decimals

**Given** a month with no transactions
**When** any report endpoint is called for that month
**Then** the response returns zero values (not an error)

**Given** an invalid month format (not YYYY-MM)
**When** a report endpoint is called
**Then** the response is a validation error with status 400

### Story 5.3: Data Export & Automated Backup

As the app owner,
I want to export all my financial data and have automated weekly backups,
So that I maintain full data ownership and can recover from any disaster.

**Acceptance Criteria:**

**Given** a valid session
**When** `GET /api/v1/export/json` is called
**Then** the response is a JSON file containing:
- `schema_version`: "1.0"
- `exported_at`: ISO 8601 timestamp
- `metadata`: { account_count, transaction_count, category_count, recurring_template_count }
- `users`: all user records (excluding password_hash)
- `accounts`: all accounts (including soft-deleted)
- `categories`: all categories
- `transactions`: all transactions (including soft-deleted)
- `recurring_templates`: all templates
- `recurring_occurrences`: all occurrences
- `receipts`: all receipt metadata records (id, transaction_id, filename, content_type, size_bytes — note: binary files in R2 are not included in JSON export)
- `settings`: all settings key-value pairs
**And** the Content-Type is `application/json`
**And** the Content-Disposition header suggests a filename like `bearuang-export-2026-05-28.json`

**Given** a valid session
**When** `GET /api/v1/export/csv` is called
**Then** the response is a CSV file with columns: date, type, amount, account, category, payee, notes, receipt_attached
**And** only non-deleted transactions are included
**And** receipt_attached is "yes" or "no"
**And** the Content-Type is `text/csv`
**And** the Content-Disposition header suggests a filename like `bearuang-transactions-2026-05-28.csv`

**Given** the Cron Trigger fires (weekly, Sunday 3am UTC)
**When** the scheduled handler executes (in `src/index.ts` via `export default { fetch: app.fetch, scheduled: handleBackup }`)
**Then** the full JSON export is generated (same format as GET /api/v1/export/json)
**And** the export is written to R2 with key `backups/bearuang-backup-{ISO-date}.json`
**And** the operation completes without requiring an authenticated session (runs as system — no userId param needed for export service in this context)

**Given** the R2 backup bucket
**When** multiple weekly backups accumulate
**Then** old backups are retained (no automatic cleanup for MVP — user manages via Cloudflare dashboard)

**Given** an export with a large number of transactions
**When** `GET /api/v1/export/json` is called
**Then** the export completes successfully (D1 handles the full table scan)
**And** the response streams if possible, or returns complete JSON

## Epic 6: Collaboration

The primary user can invite a partner via a one-time secret link, granting equal access to all shared financial data. All mutations are attributed per-user with an activity log, and partner access can be revoked.

### Story 6.1: Partner Invite & Account Creation

As the app owner,
I want to invite my partner to share access to our financial data,
So that we can both track and manage our household finances together.

**Acceptance Criteria:**

**Given** a valid session as the primary user and no partner exists
**When** `POST /api/v1/collaboration/invite` is called
**Then** a one-time invite token is generated (cryptographically random, 256-bit)
**And** the token is stored in KV with metadata: `{ created_by, expires_at, used: false }`
**And** the default expiry is 24 hours (configurable via request body)
**And** the response includes the invite token and a constructed invite URL
**And** only one active (unused, non-expired) invite can exist at a time

**Given** a valid invite token that has not expired and has not been used
**When** `POST /api/v1/collaboration/accept-invite` is called with `{ "token": "...", "display_name": "Partner", "password": "..." }` (no auth required)
**Then** a new user record is created with role "partner"
**And** the partner's password is hashed and stored in D1
**And** the invite token is marked as used in KV
**And** the partner can now log in with their own credentials
**And** a session token is returned (partner is logged in immediately)

**Given** an expired invite token
**When** `POST /api/v1/collaboration/accept-invite` is called
**Then** the response is `{ error: { code: "INVITE_EXPIRED", message: "..." } }` with status 410

**Given** an already-used invite token
**When** `POST /api/v1/collaboration/accept-invite` is called
**Then** the response is `{ error: { code: "INVITE_ALREADY_USED", message: "..." } }` with status 410

**Given** an invalid or non-existent invite token
**When** `POST /api/v1/collaboration/accept-invite` is called
**Then** the response is `{ error: { code: "INVITE_NOT_FOUND", message: "..." } }` with status 404

**Given** a partner user exists and is logged in
**When** the partner accesses any data endpoint (accounts, transactions, categories, recurring)
**Then** they see all the same data as the primary user (shared access)
**And** any transactions they create have created_by set to their user ID

**Given** a partner already exists
**When** `POST /api/v1/collaboration/invite` is called
**Then** the response is `{ error: { code: "PARTNER_ALREADY_EXISTS", message: "..." } }` with status 409

**Given** no partner has been invited or accepted
**When** the app operates normally
**Then** it functions in solo mode — all features work for a single user without any collaboration UI or overhead

### Story 6.2: Activity Log

As the app owner,
I want to see a log of all financial mutations made by either user,
So that I have visibility into what changed and who changed it.

**Acceptance Criteria:**

**Given** the database has no activity_log table
**When** the migration for this story is applied
**Then** the `activity_log` table exists with columns: id (INTEGER PK autoincrement), user_id (TEXT FK users.id), action (TEXT: 'created' | 'updated' | 'deleted' | 'restored'), entity_type (TEXT: 'transaction' | 'account' | 'category' | 'recurring_template'), entity_id (TEXT), summary (TEXT), created_at (TEXT ISO 8601)

**Given** any user performs a mutation (create, update, delete, restore) on transactions, accounts, categories, or recurring templates
**When** the route handler completes successfully
**Then** an activity log entry is written via `ctx.waitUntil()` (non-blocking)
**And** the entry includes: user_id, action, entity_type, entity_id, and a human-readable summary (e.g., "Created expense transaction of 50000.00 in Food")

**Given** this story is implemented
**When** activity logging is added
**Then** all POST, PUT, DELETE handlers in routes/accounts.ts, routes/transactions.ts, routes/categories.ts, and routes/recurring.ts that return 2xx are retrofitted to emit an activity log entry via `ctx.waitUntil()`
**And** the activity log works in both solo mode and collaboration mode (it is always-on, not collaboration-only)

**Given** a valid session
**When** `GET /api/v1/collaboration/activity-log` is called
**Then** the activity log entries are returned in reverse chronological order
**And** the response format is `{ "items": [...], "next_cursor": "...", "has_more": true/false }`
**And** each entry includes the user's display_name alongside user_id

### Story 6.3: Partner Revocation

As the app owner,
I want to revoke my partner's access if needed,
So that I maintain control over who can access our shared financial data.

**Acceptance Criteria:**

**Given** a valid session as the primary user
**When** `DELETE /api/v1/collaboration/partner` is called
**Then** the partner user's is_active is set to 0 (cannot log in)
**And** all active sessions for the partner are invalidated in KV
**And** the partner's data attribution (created_by, updated_by) is preserved on all existing records
**And** the response confirms revocation

**Given** a valid session as the partner user
**When** `DELETE /api/v1/collaboration/partner` is called
**Then** the response is `{ error: { code: "UNAUTHORIZED", message: "Only the primary user can revoke partner access" } }` with status 403

**Given** no partner exists
**When** `DELETE /api/v1/collaboration/partner` is called
**Then** the response is `{ error: { code: "NO_PARTNER", message: "..." } }` with status 404

**Given** a partner has been revoked
**When** the revoked partner attempts to log in
**Then** the response is `{ error: { code: "ACCOUNT_DEACTIVATED", message: "..." } }` with status 403

**Given** a partner has been revoked
**When** `POST /api/v1/collaboration/invite` is called by the primary user
**Then** a new invite can be generated (allowing a new partner to be invited)
