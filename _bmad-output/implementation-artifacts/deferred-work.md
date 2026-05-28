# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-infrastructure-configuration (2026-05-28)

- Cron trigger defined in `wrangler.toml` but no `scheduled()` handler exported from `src/index.ts` — add in the story that implements the backup cron logic.

## Deferred from: code review of 1-2-database-schema-migration-workflow (2026-05-28)

- `settings` table has no `created_at` audit column — spec-level design choice; revisit if audit requirements change.
- No CI enforcement of schema/migration drift — a `drizzle-kit check` step in CI would catch Drizzle schema vs committed SQL divergence; add when CI pipeline is established.

## Deferred from: code review of 1-4-authentication-login-session-management (2026-05-28)

- refreshSession TTL not wired to settings (`src/middleware/auth.ts`) — Middleware has no DB access; needs to be threaded through or middleware restructured to accept a DB reference in a future story.

## Deferred from: code review of 1-5-authentication-password-change-rate-limiting (2026-05-28)

- No rate limit on change-password endpoint — single-user app behind auth, minimal threat model; revisit in a future hardening pass.

## Deferred from: code review of 1-6-setup-wizard-health-check (2026-05-29)

- TOCTOU race condition on `POST /api/v1/setup/initialize` — D1 has no transaction support for Drizzle query builders and the app is single-owner, so risk is acceptable at this scale.
- `POST /api/v1/setup/initialize` is unauthenticated and can be hijacked before the owner completes setup — revisit if multi-deployment or public-facing scenarios arise.
- No timeout on D1/KV/R2 health-check probes — revisit when health endpoint SLA requirements are defined.
