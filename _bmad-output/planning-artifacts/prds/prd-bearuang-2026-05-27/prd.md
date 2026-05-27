---
title: "bearuang Backend API — MVP PRD"
status: final
created: 2026-05-27
updated: 2026-05-27
scope: backend-only
---

# bearuang Backend API — MVP Product Requirements Document

## 1. Product Overview

**bearuang** is a private, self-deployed personal finance manager built on Cloudflare infrastructure. This PRD covers the **backend API only** — the Hono-based REST API running on Cloudflare Workers with D1 (database), R2 (file storage), and KV (sessions/config).

**Core value proposition:** A privacy-first personal finance API where the user owns the infrastructure and data. No third-party data access, no SaaS dependency, no recurring subscription beyond Cloudflare's free/low-cost tier.

**Design philosophy:**
- Simple over clever — defer automation, prefer user control
- Data model over UI polish — get the schema right for future growth
- Ownership over convenience — user deploys, user controls, user exports
- Collaboration-aware from start — multi-user data model from day one

## 2. Architecture Context

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Cloudflare Workers | API execution |
| Database | Cloudflare D1 (SQLite) | Structured data |
| File Storage | Cloudflare R2 | Receipts, backups |
| Session/Config | Cloudflare KV | Auth sessions, app config |
| Framework | Hono | HTTP routing and middleware |
| Language | TypeScript | Type-safe implementation |

**Deployment model:** User deploys to their own Cloudflare account via Wrangler CLI. Single Worker binding to D1, R2, and KV namespaces.

## 3. Functional Requirements

### 3.1 Authentication & Sessions

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-AUTH-01 | Password-based authentication using a secret initially set via Cloudflare Worker environment variable | Password stored as bcrypt/argon2 hash in D1 |
| FR-AUTH-02 | In-app password change endpoint | Replaces env-defined initial password with user-chosen password stored in D1 |
| FR-AUTH-03 | Session token management via KV | Issue opaque session token on login, store in KV with TTL |
| FR-AUTH-04 | Configurable session timeout | Default 30 minutes inactivity, configurable via settings endpoint |
| FR-AUTH-05 | Logout endpoint that invalidates session in KV | Immediate session revocation |
| FR-AUTH-06 | Rate limiting on login attempts | Prevent brute-force; use KV counter with sliding window |

### 3.2 Accounts

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-ACCT-01 | CRUD operations for financial accounts | Create, read, update, soft-delete |
| FR-ACCT-02 | Support account types: bank, cash, e-wallet, credit card, loan, investment | Enum field with correct balance semantics |
| FR-ACCT-03 | Asset vs liability balance logic | Banks/cash/e-wallet/investment = asset (positive increases net worth); credit card/loan = liability (positive balance decreases net worth) |
| FR-ACCT-04 | Initial balance entry on account creation | Stored as opening balance, not counted as income transaction |
| FR-ACCT-05 | Per-account current balance calculation | Derived from initial balance + sum of transactions affecting the account |
| FR-ACCT-06 | Account listing with balances | Return all active accounts with computed current balance |
| FR-ACCT-07 | Account currency assignment | Each account has a base currency (single currency per account for MVP) |

### 3.3 Transactions

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-TXN-01 | Create expense transaction | Amount, account, category, date (default now), optional payee, optional notes |
| FR-TXN-02 | Create income transaction | Amount, account, category (salary/freelance/gift/refund/interest/other), date, optional notes |
| FR-TXN-03 | Create transfer between accounts | Single logical event: debit source, credit destination, no double-counting in reports |
| FR-TXN-04 | Update transaction | All mutable fields editable; recalculates affected account balances |
| FR-TXN-05 | Soft-delete transaction | Moves to trash, recoverable for 30 days, then permanently purged |
| FR-TXN-06 | Transaction attribution | Records which user created/modified each transaction (user_id foreign key) |
| FR-TXN-07 | Notes/memo field | Free-text field on every transaction |
| FR-TXN-08 | Transaction listing with pagination | Paginated list, sorted by date descending by default |
| FR-TXN-09 | Transaction search and filter | Filter by: date range, account, category, amount range, text search on description/notes/payee |
| FR-TXN-10 | Offline transaction queue support | Accept transactions with client-generated UUID and created_at timestamp; idempotent upsert by UUID |

### 3.4 Categories

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-CAT-01 | CRUD for flat expense categories | No hierarchy, no nesting for MVP |
| FR-CAT-02 | Starter category seed endpoint | Populate sensible defaults on first-run (Food, Transport, Housing, Utilities, Entertainment, Health, Shopping, Education, Other) |
| FR-CAT-03 | Income category types | Predefined: salary, freelance, gift, refund, interest, other |
| FR-CAT-04 | Category usage tracking | Track which categories are used, for ordering suggestions |

### 3.5 Recurring Transactions

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-REC-01 | Create recurring transaction template | Amount, account, category, frequency (daily/weekly/biweekly/monthly/yearly), start date, optional end date |
| FR-REC-02 | Generate upcoming entries | Compute next N occurrences based on template frequency |
| FR-REC-03 | Confirm/post a recurring entry | User confirms before it becomes an actual transaction |
| FR-REC-04 | Skip a recurring entry | Mark a single occurrence as skipped without deleting the template |
| FR-REC-05 | Update/delete recurring template | Changes apply to future occurrences only |
| FR-REC-06 | Upcoming payments list | Return all expected recurring payments within next 30 days |

### 3.6 Receipts

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-RCP-01 | Upload receipt file to R2 | Accept image (JPEG, PNG, WebP, HEIC) and PDF; max 10MB per file |
| FR-RCP-02 | Link receipt to transaction | Many-to-one: multiple receipts can attach to one transaction |
| FR-RCP-03 | Generate presigned download URL | Time-limited URL for client to fetch receipt from R2 |
| FR-RCP-04 | Delete receipt | Remove from R2 and unlink from transaction |
| FR-RCP-05 | List receipts for a transaction | Return metadata and download URLs for all receipts on a transaction |

### 3.7 Views & Reporting

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-VIEW-01 | Net worth calculation | Total assets minus total liabilities across all active accounts |
| FR-VIEW-02 | Net worth breakdown by account | Per-account balance with asset/liability classification |
| FR-VIEW-03 | Spending by category for a given month | Aggregate expense amounts grouped by category, with previous month comparison |
| FR-VIEW-04 | Dashboard data endpoint | Single endpoint returning: net worth, account balances, income vs expenses for current month, upcoming payments (next 7 days) |
| FR-VIEW-05 | Monthly summary report | Total income, total expenses, net savings, top 5 categories, top 5 payees, net worth change from previous month |
| FR-VIEW-06 | Monthly cash flow | Total income minus total expenses for a given month |

### 3.8 Collaboration

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-COLLAB-01 | Solo mode as default | App starts single-user; collaboration is opt-in |
| FR-COLLAB-02 | Generate partner invite link | One-time secret link stored in KV with configurable expiry (default 24h) |
| FR-COLLAB-03 | Accept invite and create partner account | Partner sets their own password; becomes second user with equal data access |
| FR-COLLAB-04 | Shared data access | Both users see all accounts, transactions, categories, recurring templates |
| FR-COLLAB-05 | Per-transaction user attribution | Every transaction records created_by and updated_by user ID |
| FR-COLLAB-06 | Activity log | Append-only log of mutations: "User X created/updated/deleted transaction Y" |
| FR-COLLAB-07 | Revoke partner access | Primary user can remove partner; partner's data attribution preserved |

### 3.9 Data Export

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-EXP-01 | Full JSON export | All accounts, transactions, categories, recurring templates, settings in a single documented JSON structure with schema version |
| FR-EXP-02 | CSV export of transactions | Standard columns: date, type, amount, account, category, payee, notes, receipt_attached |
| FR-EXP-03 | Export includes metadata | Schema version, export timestamp, account count, transaction count for integrity verification |

### 3.10 Onboarding & Setup

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-SETUP-01 | First-run detection | Endpoint to check if initial setup has been completed |
| FR-SETUP-02 | Initial setup wizard endpoint | Accept: display name, base currency, initial accounts (optional), seed categories (yes/no) |
| FR-SETUP-03 | Currency configuration | Set base currency for the instance (single currency for MVP) |

### 3.11 Soft Delete & Recovery

| ID | Requirement | Notes |
|----|-------------|-------|
| FR-DEL-01 | Soft delete for transactions | Mark as deleted, retain for 30 days |
| FR-DEL-02 | List deleted items | Endpoint to view trash |
| FR-DEL-03 | Restore deleted item | Undelete within 30-day window |
| FR-DEL-04 | Permanent purge | Background or on-demand cleanup of items past 30-day retention |

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|-------------|
| NFR-PERF-01 | API response time < 200ms for standard CRUD operations (p95) on Cloudflare Workers |
| NFR-PERF-02 | Dashboard endpoint < 500ms including aggregation queries |
| NFR-PERF-03 | Receipt upload < 5s for 10MB file |
| NFR-PERF-04 | Transaction listing pagination: max 50 items per page, cursor-based |

### 4.2 Security

| ID | Requirement |
|----|-------------|
| NFR-SEC-01 | All endpoints require valid session token except: login, accept-invite, first-run check |
| NFR-SEC-02 | Passwords hashed with bcrypt (cost 10+) or argon2id |
| NFR-SEC-03 | Session tokens: cryptographically random, 256-bit minimum entropy |
| NFR-SEC-04 | CORS configured for the specific frontend origin only |
| NFR-SEC-05 | Input validation on all endpoints — reject malformed requests before processing |
| NFR-SEC-06 | Rate limiting: 5 failed login attempts per 15 minutes, then 15-minute lockout |
| NFR-SEC-07 | No sensitive data in URL query parameters (tokens, passwords) |
| NFR-SEC-08 | R2 receipts accessible only via presigned URLs with short TTL (15 minutes) |

### 4.3 Data Integrity

| ID | Requirement |
|----|-------------|
| NFR-DATA-01 | Transfers are atomic: both legs succeed or neither does (single D1 transaction) |
| NFR-DATA-02 | Account balances are always derivable from transactions + initial balance (no stored running total as source of truth) |
| NFR-DATA-03 | Client-generated UUIDs for offline support; server enforces uniqueness |
| NFR-DATA-04 | Schema migrations are versioned and forward-only |
| NFR-DATA-05 | Export format is versioned; importers must handle version differences |

### 4.4 Reliability

| ID | Requirement |
|----|-------------|
| NFR-REL-01 | Idempotent transaction creation (by client UUID) to handle retry-after-timeout |
| NFR-REL-02 | Graceful handling of D1 row limits and R2 storage limits with clear error messages |
| NFR-REL-03 | Health check endpoint returning D1/R2/KV connectivity status |

### 4.5 Maintainability

| ID | Requirement |
|----|-------------|
| NFR-MAINT-01 | TypeScript strict mode, no `any` types in domain logic |
| NFR-MAINT-02 | Database schema managed via numbered migration files |
| NFR-MAINT-03 | API versioning via URL prefix (`/api/v1/`) to allow future breaking changes |
| NFR-MAINT-04 | Structured JSON error responses with error codes |
| NFR-MAINT-05 | OpenAPI spec generated or maintained alongside implementation |

### 4.6 Deployment & Operations

| ID | Requirement |
|----|-------------|
| NFR-OPS-01 | Single `wrangler deploy` command deploys the complete backend |
| NFR-OPS-02 | Environment configuration via wrangler.toml bindings (D1, R2, KV) and secrets |
| NFR-OPS-03 | Zero-downtime deployments (Cloudflare Workers default behavior) |
| NFR-OPS-04 | D1 point-in-time recovery available via Cloudflare dashboard |

## 5. Data Model (Conceptual)

```
users
  id (UUID), display_name, password_hash, role (primary|partner), created_at

accounts
  id (UUID), name, type (bank|cash|ewallet|credit_card|loan|investment),
  currency, initial_balance, is_active, created_by, created_at, updated_at

categories
  id (UUID), name, type (expense|income), usage_count, created_at

transactions
  id (UUID, client-generated), type (expense|income|transfer),
  amount, account_id, destination_account_id (transfers only),
  category_id, payee, notes, date, created_by, updated_by,
  is_deleted, deleted_at, created_at, updated_at

recurring_templates
  id (UUID), type (expense|income), amount, account_id, category_id,
  payee, notes, frequency (daily|weekly|biweekly|monthly|yearly),
  start_date, end_date, is_active, created_by, created_at, updated_at

recurring_occurrences
  id (UUID), template_id, due_date, status (pending|posted|skipped),
  transaction_id (if posted), created_at

receipts
  id (UUID), transaction_id, r2_key, filename, content_type,
  size_bytes, created_by, created_at

activity_log
  id (auto), user_id, action, entity_type, entity_id,
  summary, created_at

settings
  key, value, updated_at

invite_links (KV)
  key: invite token, value: {created_by, expires_at, used: bool}
```

## 6. API Structure

```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/change-password
GET    /api/v1/auth/session          (validate current session)

GET    /api/v1/setup/status
POST   /api/v1/setup/initialize

GET    /api/v1/accounts
POST   /api/v1/accounts
GET    /api/v1/accounts/:id
PUT    /api/v1/accounts/:id
DELETE /api/v1/accounts/:id

GET    /api/v1/categories
POST   /api/v1/categories
PUT    /api/v1/categories/:id
DELETE /api/v1/categories/:id
POST   /api/v1/categories/seed

GET    /api/v1/transactions
POST   /api/v1/transactions
GET    /api/v1/transactions/:id
PUT    /api/v1/transactions/:id
DELETE /api/v1/transactions/:id
POST   /api/v1/transactions/:id/restore

GET    /api/v1/transactions/trash
POST   /api/v1/transactions/trash/purge

GET    /api/v1/recurring
POST   /api/v1/recurring
GET    /api/v1/recurring/:id
PUT    /api/v1/recurring/:id
DELETE /api/v1/recurring/:id
GET    /api/v1/recurring/:id/upcoming
POST   /api/v1/recurring/:id/occurrences/:occId/confirm
POST   /api/v1/recurring/:id/occurrences/:occId/skip

POST   /api/v1/transactions/:id/receipts
GET    /api/v1/transactions/:id/receipts
DELETE /api/v1/receipts/:id

GET    /api/v1/dashboard
GET    /api/v1/reports/monthly-summary?month=YYYY-MM
GET    /api/v1/reports/spending-by-category?month=YYYY-MM
GET    /api/v1/reports/cash-flow?month=YYYY-MM
GET    /api/v1/reports/net-worth

POST   /api/v1/collaboration/invite
POST   /api/v1/collaboration/accept-invite
DELETE /api/v1/collaboration/partner
GET    /api/v1/collaboration/activity-log

GET    /api/v1/export/json
GET    /api/v1/export/csv

GET    /api/v1/health
GET    /api/v1/settings
PUT    /api/v1/settings
```

## 7. Success Metrics

| Metric | Target | Counter-Metric |
|--------|--------|----------------|
| API response time (p95) | < 200ms for CRUD, < 500ms for aggregations | Error rate stays < 1% |
| Deployment success | Single command, < 60s | No manual post-deploy steps required |
| Data export completeness | 100% of user data exportable | Export file size remains reasonable (< 50MB for typical use) |
| Offline sync reliability | 0 lost transactions from offline queue | No duplicate transactions created |
| Session security | No session fixation or hijacking vectors | Legitimate users not locked out by rate limiting |

## 8. Out of Scope (MVP)

- Frontend/PWA implementation (separate PRD)
- Hierarchical categories or tags
- Auto-categorization or ML-based suggestions
- Bank aggregator integrations (Plaid, etc.)
- Multi-currency with automatic exchange rates
- Passkey/WebAuthn authentication
- Split transactions
- Budget tracking beyond simple category limits
- Push notifications
- Scheduled automatic backups (manual export only for MVP)
- CSV/OFX/QIF import (post-MVP)
- Audit trail / edit history on transactions
- End-to-end encryption

## 9. Open Questions

| # | Question | Impact | Owner |
|---|----------|--------|-------|
| 1 | Should D1's 10GB database limit be surfaced to the user proactively? | UX for long-term users with many receipts | PM |
| 2 | Is 30-day soft-delete retention sufficient, or should it be configurable? | Data recovery expectations | PM |
| 3 | Should the activity log be prunable, or grow indefinitely? | Storage management | Engineering |

## 10. Dependencies & Constraints

- **Cloudflare Workers free tier:** 100k requests/day, 10ms CPU time per request (paid plan removes limits)
- **D1 limits:** 500MB free storage per database, 1MB max row size
- **R2 limits:** 10GB free storage, then $0.015/GB/month
- **KV limits:** 1GB free storage, eventually consistent reads
- **Hono framework:** Must be compatible with Cloudflare Workers runtime (no Node.js-specific APIs)
- **No external network calls** in critical transaction paths (privacy constraint)
