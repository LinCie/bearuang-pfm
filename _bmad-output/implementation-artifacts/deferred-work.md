# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-infrastructure-configuration (2026-05-28)

- `seedUser()` in `tests/setup.ts` duplicates stub instead of composing with `userFactory` from `factories.ts` — Story 1.2+ will fill in real DB seeding and can unify these.
- Cron trigger defined in `wrangler.toml` but no `scheduled()` handler exported from `src/index.ts` — handler is out of scope for Story 1.1; add in the story that implements the backup cron logic.
- No global error handler or 404 handler on the Hono app — Story 1.3 (Global Middleware & Error Handling) is the correct place for this.

## Deferred from: code review of 1-2-database-schema-migration-workflow (2026-05-28)

- No DB-level constraints on `is_active` (any integer), `display_name` (empty string), `created_at`/`updated_at` (non-ISO strings) — pre-existing design decision; enforced at app layer via Zod in Story 1.4.
- `settings` table has no `created_at` audit column — spec-level design choice; revisit if audit requirements change.
- No CI enforcement of schema/migration drift — a `drizzle-kit check` step in CI would catch Drizzle schema vs committed SQL divergence; add when CI pipeline is established.

## Deferred from: code review of 1-3-global-middleware-error-handling (2026-05-28)

- Log injection risk: `err.message` is user-controlled and embedded in a manually-built JSON string via `JSON.stringify` — use a structured logger that serialises fields independently to prevent log-line forgery in aggregators.
- `err.stack` is never logged in the unhandled error path — makes production debugging harder; consider logging the stack trace server-side (never to the client) when available.
- Test app in `middleware.test.ts` duplicates production middleware wiring instead of importing the real app — creates a false sense of coverage; consider refactoring to import the real `app` instance once the app bootstrap is stable.

## Deferred from: code review of 1-4-authentication-login-session-management (2026-05-28)

- Argon2 params not encoded in hash format (`src/lib/crypto.ts`) — If ARGON2_PARAMS change, existing hashes silently fail verification. Consider encoding params (t, m, p) in the stored hash string.
- refreshSession TTL not wired to settings (`src/middleware/auth.ts`) — Middleware has no DB access; Story 1.5 will need to thread TTL through or restructure middleware to accept a DB reference.
- SQL migration split on `;` is fragile (`tests/setup.ts`) — Bare semicolon split will break on any future migration with a semicolon inside a string literal.

## Deferred from: code review of 1-5-authentication-password-change-rate-limiting (2026-05-28)

- No rate limit on change-password endpoint — An attacker with a valid session token could brute-force the current password without restriction. Deferred: single-user app behind auth, minimal threat model; revisit in a future hardening pass.
- No integration tests for settings endpoints — `GET /api/v1/settings` and `PUT /api/v1/settings` have zero integration test coverage. The session_timeout → login TTL flow is also untested. Deferred: settings tests to be added in Story 1.6 which also uses settings.

## Deferred from: code review of 1-6-setup-wizard-health-check (2026-05-29)

- TOCTOU race condition on `POST /api/v1/setup/initialize` — two concurrent requests can both pass the `setup_complete` guard before either writes it; D1 has no transaction support for Drizzle query builders and the app is single-owner, so risk is acceptable at this scale.
- `POST /api/v1/setup/initialize` is unauthenticated and can be hijacked before the owner completes setup — protecting it requires a pre-shared secret or one-time token; out of scope for this story, revisit if multi-deployment or public-facing scenarios arise.
- No timeout on D1/KV/R2 health-check probes — a hanging service call can block the health endpoint for the Workers wall-clock limit; no `Promise.race` or `AbortSignal` bounds the probe duration; revisit when health endpoint SLA requirements are defined.
