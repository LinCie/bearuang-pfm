# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-infrastructure-configuration (2026-05-28)

- `seedUser()` in `tests/setup.ts` duplicates stub instead of composing with `userFactory` from `factories.ts` — Story 1.2+ will fill in real DB seeding and can unify these.
- Cron trigger defined in `wrangler.toml` but no `scheduled()` handler exported from `src/index.ts` — handler is out of scope for Story 1.1; add in the story that implements the backup cron logic.
- No global error handler or 404 handler on the Hono app — Story 1.3 (Global Middleware & Error Handling) is the correct place for this.
