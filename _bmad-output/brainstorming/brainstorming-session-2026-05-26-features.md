---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - '_bmad-output/planning-artifacts/research/domain-personal-financial-management-for-privacy-conscious-individuals-research-2026-05-26.md'
  - '_bmad-output/planning-artifacts/research/market-personal-financial-management-software-privacy-conscious-data-ownership-low-cost-low-complexity-research-2026-05-25.md'
  - '_bmad-output/planning-artifacts/research/technical-private-low-cost-low-maintenance-personal-financial-management-application-for-individual-users-research-2026-05-26.md'
session_topic: 'MVP feature set for bearuang — a private, self-deployed personal finance manager on Cloudflare'
session_goals: 'Produce a prioritized MVP feature list starting from confirmed essentials, exploring simple-but-helpful additions'
selected_approach: 'progressive-flow'
techniques_used: ['morphological-analysis']
ideas_generated: 85
context_file: ''
session_active: false
workflow_completed: true
---

# Brainstorming Session Results

**Facilitator:** LinCie
**Date:** 2026-05-26

## Session Overview

**Topic:** MVP features for bearuang — a private, low-cost personal finance manager
**Goals:** Produce a feature list that includes confirmed essentials plus discovered "simple but helpful" additions

**Architecture Context:**
- Self-deployed on Cloudflare infrastructure (D1, R2, KV)
- User owns the infrastructure and data
- PWA with offline-first support
- Multi-user data model from day one (collaboration-ready)

**Confirmed Essentials (User-Stated):**
- Multi-account tracking (wallets, banks, online wallets, cash on hand, etc.)
- Expense recording
- Receipt attachment/storage linked to expenses
- Recurring payments
- Net worth display (total + per-account breakdown)

**Constraint:** Features should be simple — low implementation complexity, low operational burden, high user value

### Context Guidance

Three research artifacts informed this session:
1. **Domain Research** — core PFM concepts, workflows, data entities, integrity rules, edge cases, and failure modes
2. **Market Research** — competitive landscape across SaaS, local-first, open-source, and self-hosted tools; user segments and pain points
3. **Technical Research** — architecture, storage, security, backup, sync, and deployment models for private, low-cost PFM

Key opportunity: a privacy-first, data-ownership-oriented personal finance tool that avoids the tradeoff between convenience and control.

## Technique Selection

**Approach:** Progressive Technique Flow
**Journey Design:** Systematic development from exploration to action

**Progressive Techniques:**
- **Phase 1 - Exploration:** Morphological Analysis for maximum idea generation across parameter dimensions
- **Phase 2 - Pattern Recognition:** Constraint Mapping for filtering against MVP criteria
- **Phase 3 - Development:** SCAMPER Method for refining feature definitions
- **Phase 4 - Action Planning:** Decision Tree Mapping for prioritization and sequencing

**Journey Rationale:** The morphological approach was chosen because a finance manager has clear parameter dimensions (data entities, user actions, views, automation levels, privacy controls) that can be systematically combined to surface non-obvious features.

## Technique Execution Results

**Morphological Analysis:**
- **Parameter Dimensions Explored:** Data Entities, User Actions, Views/Insights, Automation Level, Privacy/Data Control
- **Domains Covered:** Core financial record, receipts, recurring payments, views/insights, reporting, collaboration, data integrity, infrastructure/security, budgeting, onboarding/UX, notifications, API/extensibility, real-life edge cases
- **Total Ideas Generated:** 85

**Key Decisions During Exploration:**
- Architecture confirmed as Cloudflare (D1, R2, KV) — not local-only
- Auth model: env-variable password, changeable in-app (passkey deferred)
- Hierarchical categories and tags deferred as overkill
- Auto-categorization and last-used suggestions deferred as too complex
- Collaboration confirmed as MVP to establish multi-user data model early
- Monthly Summary Report confirmed as essential; other reports are nice-to-have

## Idea Organization and Prioritization

### Tier 1 — MVP Must-Have

These features ship in v1 or the app doesn't fulfill its core promise.

| # | Feature | Theme |
|---|---------|-------|
| 1 | **Multi-Type Account Registry** — bank, cash, e-wallet, credit card, loan, investment with correct balance logic (asset vs liability) | Accounts |
| 3 | **Quick Expense Entry** — amount, account, category with smart defaults (date = now, everything else optional) | Transactions |
| 4 | **Income Tracking** — record income with source categorization (salary, freelance, gift, refund, interest) | Transactions |
| 5 | **Transfer Between Accounts** — single logical event, debit one account, credit another, no double-counting | Transactions |
| 6 | **Receipt Attachment** — attach one or more images/files to any transaction | Receipts |
| 29 | **Receipt Storage on R2** — files stored in user's own R2 bucket, linked by transaction ID | Receipts |
| 7 | **Recurring Transaction Templates** — define template with frequency, auto-generate upcoming entries, user confirms before posting | Recurring |
| 9 | **Net Worth Dashboard** — total assets minus liabilities, breakdown by account, real-time updates | Views |
| 10 | **Spending by Category (Monthly)** — bar/list showing per-category spending with previous month comparison | Views |
| 45 | **Dashboard Home Screen** — net worth, account balances, income vs expenses, upcoming payments, alerts in one view | Views |
| 51 | **Monthly Summary Report Page** — total income, expenses, net savings, top categories, top payees, net worth change | Reporting |
| 61 | **Shared Access for Partner** — invite one additional user with equal access to shared data | Collaboration |
| 66 | **Partner Invite via Secret Link** — one-time link stored in KV with expiry, no email service needed | Collaboration |
| 67 | **Solo Mode Toggle** — collaboration is optional, app starts single-user, enable/disable as needed | Collaboration |
| 63 | **Per-Transaction Attribution** — records which user created each transaction | Collaboration |
| 27 | **Offline Transaction Queue** — PWA saves locally when offline, syncs on reconnect, visible "pending sync" indicator | Infrastructure |
| 36r | **Auth (env password)** — initial password from Cloudflare Worker secret, changeable in-app, stored in KV/D1 | Security |
| 50 | **Session Timeout** — auto-logout after configurable inactivity period | Security |
| 83 | **Initial Balance Entry** — set starting balance when adding account (not counted as income) | Transactions |
| 17 | **Full Data Export (JSON/CSV)** — one-click export of all data in documented, versioned format | Data |
| 18 | **Transaction Search and Filter** — search by text, filter by date/account/category/amount range | Data |
| 43 | **First-Run Setup Wizard** — guided account creation, currency selection, optional import | Onboarding |
| 44 | **Starter Category Suggestions** — sensible flat default list, fully editable | Onboarding |
| 75 | **Responsive Mobile-First PWA** — works from 320px phone to wide desktop, mobile is primary | UX |
| 20 | **Notes/Memo Field** — free-text note on any transaction for personal context | Transactions |

### Tier 2 — MVP Should-Have

High value, relatively simple. Include if scope allows.

| # | Feature | Theme |
|---|---------|-------|
| 8 | **Upcoming Payments List** — next 30 days of expected recurring payments as timeline/list | Recurring |
| 23 | **Monthly Cash Flow Summary** — total income minus total expenses for the month | Views |
| 14 | **Soft Delete with Recovery** — 30-day trash before permanent removal | Data Integrity |
| 15 | **CSV Import with Column Mapping** — map columns, preview before commit | Import |
| 16 | **Duplicate Detection on Import** — flag potential duplicates for user decision | Import |
| 46 | **Quick-Add Floating Button (FAB)** — persistent mobile button for instant expense entry | UX |
| 47 | **Date Range Picker for All Views** — consistent selector (this month, last month, custom, year) | UX |
| 62 | **Activity Log** — "Partner added $45 to Groceries" feed for coordination | Collaboration |
| 32 | **Variable Recurring Amounts** — template stores expected range, user enters actual each cycle | Recurring |
| 41 | **Monthly Spending Limit per Category** — set ceiling, show progress bar | Budgeting |
| 42 | **Over-Budget Alert Indicator** — visual flag when category exceeds limit | Budgeting |
| 40 | **Single Base Currency with Manual Rate** — one base currency, enter foreign amount + rate for travel/online purchases | Currency |
| 38 | **Payee/Merchant Field** — optional "who" field with autocomplete from history | Transactions |
| 76 | **Dark Mode / High Contrast** — system preference + manual toggle | UX |

### Tier 3 — Post-MVP

Good ideas that can wait for v1.1+.

**Accounts & Transactions:**
- Account Archiving (#2)
- Split Transactions (#19)
- Pending vs Confirmed Status (#34)
- Refund Handling (#80)
- Balance Adjustments/Corrections (#82)
- Scheduled Future Transactions (#84)

**Receipts & Recurring:**
- Receipt Gallery View (#30)
- Credit Card Statement/Due Date Tracking (#33)
- Missed Recurring Payment Alert (#31)
- Recurring Payments Summary — annual total (#57)

**Reporting (Advanced):**
- Export Report as PDF (#52)
- Spending Trends Over Time (#53)
- Income vs Expenses Over Time (#54)
- Net Worth History Chart (#55)
- Category Comparison Month-over-Month (#56)
- Custom Date Range Report (#58)
- Expense Report for Reimbursement (#59)
- Year-End Financial Summary (#60)

**Collaboration (Advanced):**
- Shared vs Personal Accounts (#64)
- Shared Budget Visibility (#65)
- Shared Recurring Payment Ownership (#68)
- Combined vs Individual Net Worth View (#69)
- Expense Splitting Between Partners (#70)

**Data Integrity & Infrastructure:**
- Edit History / Audit Trail (#13)
- Encrypted Backup File (#26)
- Conflict Resolution on Sync (#28)
- Scheduled Automatic Backup to R2 (#35)
- Database Size Indicator (#48)
- Manual Data Purge by Date Range (#49)

**Notifications:**
- In-App Notification Center (#71)
- Recurring Payment Due Reminder (#72)
- Weekly Financial Digest (#73)

**API & Extensibility:**
- Personal REST API (#77)
- Webhook on Transaction Created (#78)
- Import via API Endpoint (#79)
- Reimbursement Tracking (#81)
- Multi-Currency Display — view only (#85)

**UX:**
- Keyboard Navigation (#74)
- Account Balance History Chart (#24)
- Payee-Based Spending View (#39)
- "Where Did It Go?" Quick Breakdown (#37)

### Explicitly Deferred

| # | Feature | Reason |
|---|---------|--------|
| 11 | Hierarchical Category Tree | Overkill for MVP — flat categories are sufficient |
| 12 | Tags as Second Axis | Overkill for MVP |
| 21 | Auto-Categorization Rules | Too complex for MVP |
| 22 | Last-Used Category Suggestion | Too complex for MVP |
| 25 | Local-Only Database | Conflicts with Cloudflare architecture |
| 36-orig | Passkey Auth | Deferred — env password is simpler for v1 |

## Session Summary and Insights

**Key Achievements:**
- Generated 85 feature ideas across 12 domains in a single session
- Established clear architectural decisions (Cloudflare D1/R2/KV, PWA, offline-first, multi-user from day one)
- Produced a prioritized 3-tier feature list with 25 must-haves, 14 should-haves, and 46 post-MVP items
- Identified and deferred 6 features that don't fit MVP constraints

**Architectural Decisions Confirmed:**
- Cloudflare Workers + D1 (database) + R2 (receipts/backups) + KV (sessions/config)
- PWA with offline-first and sync queue
- Multi-user data model from day one (collaboration-ready)
- Simple password auth (env-defined, changeable in-app)
- Flat categories (no hierarchy, no tags for MVP)

**MVP Feature Count:** 25 must-have features forming a complete, usable personal finance manager with:
- Full transaction lifecycle (expenses, income, transfers, recurring)
- Receipt storage linked to transactions
- Net worth and spending visibility
- Basic collaboration (partner access)
- Offline-first PWA with sync
- Data export and search
- Guided onboarding

**Design Philosophy Emerging:**
- Simple over clever — defer automation, prefer user control
- Data model over UI polish — get the schema right for future growth
- Ownership over convenience — user deploys, user controls, user exports
- Collaboration-aware from start — avoid painful migration later
