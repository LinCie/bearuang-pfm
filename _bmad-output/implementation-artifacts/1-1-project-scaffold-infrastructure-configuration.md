# Story 1.1: Project Scaffold & Infrastructure Configuration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a fully configured Hono project on Cloudflare Workers with all dependencies, bindings, and tooling ready,
so that I can immediately start building features without infrastructure setup blocking me.

## Acceptance Criteria

1. **AC-1 Dependencies (declared, not ghost):** All required runtime dependencies are added to `apps/api/package.json` via `bun add` and reflected in the workspace `bun.lock`: `hono` (already present), `drizzle-orm`, `@hono/zod-openapi`, `zod`, `@noble/hashes`, `aws4fetch`. All required dev dependencies are added via `bun add -D`: `drizzle-kit`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `vitest`, `wrangler`. `typescript` stays at the workspace root version. `bun install` from the repo root resolves cleanly. [Source: epics.md#Story-1.1, architecture.md#Starter-Template-Evaluation]
2. **AC-2 wrangler.toml exists at `apps/api/wrangler.toml` and configures:**
   - `name = "bearuang-api"`, `main = "src/index.ts"`, `compatibility_date` set to a current date, `compatibility_flags = ["nodejs_compat"]`.
   - `[observability] enabled = true`.
   - `[[d1_databases]]` with `binding = "DB"`, `database_name = "bearuang"`, `database_id = "<placeholder>"` and `migrations_dir = "src/db/migrations"`.
   - `[[r2_buckets]]` with `binding = "RECEIPTS"`, `bucket_name = "bearuang-receipts"`.
   - `[[kv_namespaces]]` with `binding = "SESSIONS"`, `id = "<placeholder>"`.
   - `[triggers] crons = ["0 3 * * 0"]` (weekly Sunday 03:00 UTC backup).
   - Placeholders documented in `.env.example` so the user replaces them with real IDs from `wrangler d1 create`, `wrangler r2 bucket create`, `wrangler kv namespace create` before deploy. [Source: architecture.md#Infrastructure-&-Deployment, epics.md#Story-1.1]
3. **AC-3 TypeScript strict mode:** `apps/api/tsconfig.json` extends `@repo/typescript-config/base.json` (which already has `"strict": true`), adds `"types": ["@cloudflare/workers-types"]` (replacing the inherited `["bun"]`), and includes `src` and the generated `worker-configuration.d.ts`. The eslint shared config already enforces strict TypeScript via `typescript-eslint/strict-type-checked`; do NOT relax it. [Source: architecture.md#Implementation-Patterns, packages/typescript-config/base.json]
4. **AC-4 Type generation works:** `bunx wrangler types` runs successfully and produces `apps/api/worker-configuration.d.ts` with `interface Env { DB: D1Database; RECEIPTS: R2Bucket; SESSIONS: KVNamespace; INITIAL_PASSWORD: string }`. The file is gitignored. [Source: architecture.md#Project-Structure, epics.md#Story-1.1]
5. **AC-5 Drizzle config:** `apps/api/drizzle.config.ts` exists with `dialect: "sqlite"`, `driver: "d1-http"` (or D1 driver appropriate for drizzle-kit 0.31.x), `schema: "./src/db/schema/index.ts"`, `out: "./src/db/migrations"`. The file is functional even though no schema files exist yet (Story 1.2 adds the first table). [Source: architecture.md#Decision-Impact-Analysis]
6. **AC-6 Vitest pool-workers config:** `apps/api/vitest.config.ts` uses the **current** `@cloudflare/vitest-pool-workers` API (v0.16+), wires the test pool through `wrangler.toml` so bindings are available in tests, and a sample test in `tests/setup.test.ts` proves the pool boots and can read `env.SESSIONS` (a KV `put`/`get` round-trip). `bun run test --run` exits 0. [Source: architecture.md#Testing-Notes]
7. **AC-7 Project directory skeleton exists** under `apps/api/src/` (empty `.gitkeep` placeholder files are acceptable so the dirs survive git): `routes/`, `services/`, `middleware/`, `db/schema/`, `db/migrations/`, `lib/`, `schemas/`, `types/`. `tests/` directory tree contains `setup.ts`, `fixtures/`, `unit/services/`, `unit/lib/`, `integration/`. [Source: architecture.md#Complete-Project-Directory-Structure]
8. **AC-8 Test setup helper:** `apps/api/tests/setup.ts` exports a minimal factory pattern (e.g., `createTestEnv()`, `seedUser()`) — stubbed implementations are fine; Stories 1.2 and 1.4 will fill them in. The factory file `tests/fixtures/factories.ts` exists with the same approach. [Source: architecture.md#Test-Organization]
9. **AC-9 `.env.example` documents required secrets and binding IDs:** `INITIAL_PASSWORD` (required for first login per Story 1.4), and clearly-commented placeholders the user must populate in `wrangler.toml` before deploy (`d1_databases[0].database_id`, `kv_namespaces[0].id`). `.dev.vars` is created locally (gitignored) and contains `INITIAL_PASSWORD=...`. [Source: epics.md#Story-1.1, architecture.md#Authentication-&-Security]
10. **AC-10 .gitignore additions** in `apps/api/.gitignore`: `.wrangler/`, `.dev.vars`, `worker-configuration.d.ts`. (Workspace root `.gitignore` already covers `node_modules`, `.turbo`, `.env*`.) [Source: epics.md#Story-1.1]
11. **AC-11 ESLint import restriction:** `apps/api/eslint.config.mjs` extends the shared `@repo/eslint-config/base` (already set up) and adds an `import/no-restricted-paths` rule (or equivalent via `no-restricted-imports`) that fails if any file under `src/lib/**` imports from `src/services/**` or `src/routes/**`. A trivial verification: a sample lib file that imports a service triggers a lint error; remove the offending import before merging. The rule must NOT trigger any errors on the empty skeleton. [Source: architecture.md#Architectural-Boundaries, epics.md#Story-1.1]
12. **AC-12 Hono `OpenAPIHono` app boots:** `src/index.ts` instantiates `new OpenAPIHono<{ Bindings: Env }>()`, exports `default app`, and `bunx wrangler dev` (run from `apps/api/`) responds 200 to `GET /` (a placeholder route returning `{ name: "bearuang-api", version: "0.1.0" }` is acceptable). [Source: architecture.md#API-&-Communication-Patterns]
13. **AC-13 Scripts:** `apps/api/package.json` exposes scripts: `dev` (uses `wrangler dev`, replaces the current `bun run --hot src/index.ts`), `deploy` (`wrangler deploy`), `lint` (existing), `check-types` (existing — must pass), `test` (`vitest`), `db:generate` (`drizzle-kit generate`), `db:migrate:local` (`wrangler d1 migrations apply DB --local`), `db:migrate:remote` (`wrangler d1 migrations apply DB --remote`), `cf:types` (`wrangler types`). [Source: architecture.md#Development-Workflow-Integration]
14. **AC-14 Verification gate (must all pass before marking done):**
    - `bun install` (from repo root) — clean.
    - `bun run check-types` (from repo root via Turbo) — clean.
    - `bun run lint` — clean.
    - `bun run test --run` (in `apps/api/`) — sample KV round-trip test passes.
    - `bunx wrangler dev` boots locally and `GET /` returns 200 (manual smoke; document the steps if blocked by environment).

- [x] **Task 1: Declare dependencies properly** (AC: 1)
  - [x] 1.1 From `apps/api/`, run `bun add hono drizzle-orm @hono/zod-openapi zod @noble/hashes aws4fetch`
  - [x] 1.2 From `apps/api/`, run `bun add -D drizzle-kit @cloudflare/vitest-pool-workers @cloudflare/workers-types vitest wrangler`
  - [x] 1.3 Confirm `apps/api/package.json` lists every dependency with a pinned caret range and `bun.lock` (workspace root) is updated
  - [x] 1.4 Verify no stray `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` exist
- [x] **Task 2: Create wrangler.toml** (AC: 2, 4)
  - [x] 2.1 Create `apps/api/wrangler.toml` with `name`, `main`, `compatibility_date`, `compatibility_flags = ["nodejs_compat"]`
  - [x] 2.2 Add `[observability] enabled = true`
  - [x] 2.3 Add D1 binding (`DB`), R2 binding (`RECEIPTS`), KV binding (`SESSIONS`) with placeholder IDs and an explanatory comment
  - [x] 2.4 Add `[triggers] crons = ["0 3 * * 0"]`
  - [x] 2.5 Add `migrations_dir = "src/db/migrations"` under the D1 binding
  - [x] 2.6 Run `bunx wrangler types` from `apps/api/`; verify `worker-configuration.d.ts` is generated
- [x] **Task 3: TypeScript configuration** (AC: 3, 4)
  - [x] 3.1 Update `apps/api/tsconfig.json`: replace inherited `types` with `["@cloudflare/workers-types"]`, ensure `include` covers `src` and `worker-configuration.d.ts`
  - [x] 3.2 Remove `jsx: "react-jsx"` and `jsxImportSource: "hono/jsx"` overrides — backend has no JSX (the base already sets jsx: "react-jsx" but it's harmless; remove the redundant overrides for cleanliness)
  - [x] 3.3 Run `bun run check-types` from repo root; must pass
- [x] **Task 4: Drizzle configuration** (AC: 5)
  - [x] 4.1 Create `apps/api/drizzle.config.ts` (use `import { defineConfig } from "drizzle-kit"`)
  - [x] 4.2 Set `dialect: "sqlite"`, `schema: "./src/db/schema/index.ts"`, `out: "./src/db/migrations"`
  - [x] 4.3 For `driver`: use the appropriate D1 driver for `drizzle-kit@0.31.x` (consult drizzle-kit docs via context7 if uncertain — likely `driver: "d1-http"` with HTTP credentials for remote schema introspection, or omit driver entirely for purely local generate-only flow)
  - [x] 4.4 Create empty barrel `apps/api/src/db/schema/index.ts` (`export {}` is fine — Story 1.2 adds tables)
- [x] **Task 5: Vitest pool-workers configuration** (AC: 6)
  - [x] 5.1 Create `apps/api/vitest.config.ts` using the `cloudflareTest` Vite plugin from `@cloudflare/vitest-pool-workers` (the v0.16.10 canonical API — see Dev Notes for full snippet). Wire it to `wrangler.toml` via `wrangler: { configPath: "./wrangler.toml" }`.
  - [x] 5.2 Add `compatibilityFlags: ["nodejs_compat"]` in the `miniflare` block to match production runtime
  - [x] 5.3 Create `apps/api/tests/setup.ts` exporting `createTestEnv()` factory stub (returns the typed `env` from `cloudflare:test` for now)
  - [x] 5.4 Create `apps/api/tests/fixtures/factories.ts` with stub builders
  - [x] 5.5 Create `apps/api/tests/setup.test.ts` that imports `env` from `cloudflare:test` and does `await env.SESSIONS.put("test-key", "ok"); expect(await env.SESSIONS.get("test-key")).toBe("ok")`
  - [x] 5.6 Add `@cloudflare/vitest-pool-workers/types` (which provides `cloudflare:test` typings) to the test tsconfig — either via `apps/api/tsconfig.json` `types` array, or create a dedicated `apps/api/tests/tsconfig.json` extending the root tsconfig
  - [x] 5.7 Run `bunx vitest --run` from `apps/api/`; sample test must pass
- [x] **Task 6: Project directory skeleton** (AC: 7)
  - [x] 6.1 Create `apps/api/src/{routes,services,middleware,db/schema,db/migrations,lib,schemas,types}/.gitkeep`
  - [x] 6.2 Create `apps/api/tests/{unit/services,unit/lib,integration,fixtures}/.gitkeep`
- [x] **Task 7: Environment / secrets / gitignore** (AC: 9, 10)
  - [x] 7.1 Create `apps/api/.env.example` documenting `INITIAL_PASSWORD` and the wrangler.toml placeholder IDs the user must replace
  - [x] 7.2 Create `apps/api/.dev.vars` locally with a sample `INITIAL_PASSWORD` (do NOT commit — gitignored)
  - [x] 7.3 Add `.wrangler/`, `.dev.vars`, `worker-configuration.d.ts` to `apps/api/.gitignore`
- [x] **Task 8: ESLint import restriction** (AC: 11)
  - [x] 8.1 Extend `apps/api/eslint.config.mjs` to add a flat-config block with `no-restricted-imports` (or `import/no-restricted-paths` if `eslint-plugin-import` is acceptable to add) that forbids `src/lib/**` from importing `src/services/**` or `src/routes/**`
  - [x] 8.2 Confirm `bun run lint` is clean on the empty skeleton
  - [x] 8.3 (Optional sanity check) Temporarily add a test fixture importing a service from a lib file, run lint, observe the error, then remove the fixture
- [x] **Task 9: Hono OpenAPI app boot** (AC: 12)
  - [x] 9.1 Replace `apps/api/src/index.ts` body: `import { OpenAPIHono } from "@hono/zod-openapi"; const app = new OpenAPIHono<{ Bindings: Env }>(); app.get("/", (c) => c.json({ name: "bearuang-api", version: "0.1.0" })); export default app;`
  - [x] 9.2 Run `bunx wrangler dev` from `apps/api/`; smoke-test `GET /` returns 200 + JSON body
- [x] **Task 10: package.json scripts** (AC: 13)
  - [x] 10.1 Replace `dev` script with `wrangler dev`
  - [x] 10.2 Add `deploy`, `test`, `db:generate`, `db:migrate:local`, `db:migrate:remote`, `cf:types` scripts
  - [x] 10.3 Keep existing `lint` and `check-types` scripts
- [x] **Task 11: Final verification gate** (AC: 14)
  - [x] 11.1 `bun install` clean from repo root
  - [x] 11.2 `bun run check-types` clean from repo root
  - [x] 11.3 `bun run lint` clean from repo root
  - [x] 11.4 `bun run test --run` clean in `apps/api/`
  - [x] 11.5 Manual: `bunx wrangler dev` boots and `GET /` returns 200
  - [x] 11.6 Update Dev Agent Record with file list and any deviations


### Critical Context (read before writing any code)

**Project layout reality (verify before assuming):**
- This is a **Turborepo monorepo** with `apps/*` and `packages/*` workspaces (see `package.json` at repo root). The pinned package manager is `bun@1.3.14`.
- `apps/api/` already exists and currently has a minimal Hono app at `src/index.ts` (`Hono` not `OpenAPIHono`).
- Shared config packages exist: `@repo/typescript-config` (`packages/typescript-config/base.json`) and `@repo/eslint-config` (`packages/eslint-config/base.js`). The shared eslint config enables `typescript-eslint/strict-type-checked` and `stylistic-type-checked` — do not weaken these.
- The shared `tsconfig` already sets `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`. **Do not override these.**
- `apps/api/node_modules/` currently contains `drizzle-orm`, `drizzle-kit`, `@hono/zod-openapi`, `zod`, `@noble/hashes`, `aws4fetch`, `vitest`, `@cloudflare/vitest-pool-workers`, `wrangler`, `@cloudflare/workers-types` — but **none of them are declared in `apps/api/package.json` and none are in `bun.lock`**. They are ghost installs from earlier exploration. Task 1 (`bun add`) is mandatory to fix this — do NOT skip it.
- `bun.lock` is the only lockfile. Do not generate `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.

**Versions actually installed (as of this story creation, 2026-05-28) — use these as the floor:**
- `hono@4.12.23`
- `drizzle-orm@0.36.4`, `drizzle-kit@0.31.10`
- `@hono/zod-openapi@1.4.0`, `zod@3.25.76`
- `@noble/hashes@2.2.0`
- `aws4fetch@1.0.20`
- `wrangler@4.95.0`
- `vitest@4.1.7`, `@cloudflare/vitest-pool-workers@0.16.10`
- `@cloudflare/workers-types@latest`

The architecture document was written when versions were lower (vitest ^3.2.x, drizzle-kit ^0.27.x). The installed versions ARE the source of truth for this story — keep them as written above when running `bun add`.

**Vitest pool-workers config — verified API for v0.16.10:**
- The package's only main export (verified in `apps/api/node_modules/@cloudflare/vitest-pool-workers/dist/pool/index.d.mts`) exposes `cloudflareTest(options)` which returns a Vite plugin. There is no `defineWorkersConfig` / `defineConfig` re-export in v0.16.x — that pattern is from older versions. Use `cloudflareTest` as a Vite plugin.
- Canonical config:
  ```ts
  // apps/api/vitest.config.ts
  import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Pull bindings from wrangler.toml; add any test-only overrides here
          compatibilityFlags: ["nodejs_compat"],
        },
      }),
    ],
  });
  ```
- Bindings declared in `wrangler.toml` (DB, RECEIPTS, SESSIONS) are automatically available in tests via the `cloudflare:test` import:
  ```ts
  // tests/setup.test.ts
  import { env } from "cloudflare:test";
  import { test, expect } from "vitest";

  test("KV pool round-trip", async () => {
    await env.SESSIONS.put("test-key", "ok");
    expect(await env.SESSIONS.get("test-key")).toBe("ok");
  });
  ```
- For TypeScript: add `@cloudflare/vitest-pool-workers/types` to `tsconfig.json` `types` array (or create a `tests/tsconfig.json` that does so) and run `bunx wrangler types --include-env=true` if needed for `cloudflare:test` typings. Verify in the package's `types/cloudflare-test.d.ts` file.

**Drizzle config — minimal for this story:**
- Story 1.2 generates the first migration. This story just needs the config file in place + an empty barrel at `src/db/schema/index.ts`. Do not over-engineer.

**Architectural decisions you MUST follow (from architecture.md):**
- `OpenAPIHono` (from `@hono/zod-openapi`) is the base app class — NOT plain `Hono`.
- Routes layer is thin — only validation + service call + response.
- Services receive deps as parameters (`db`, `kv`, `env`, `userId`) — never read from Hono context.
- `lib/` never imports from `services/` or `routes/` — enforced via eslint (Task 8).
- All amounts as TEXT string decimals (relevant for future stories — keep it in mind).
- Snake_case for DB columns + API JSON; camelCase for TS code.
- Structured error shape: `{ error: { code, message, details? } }`.

**Anti-patterns to avoid (from architecture.md):**
- ❌ Module-level mutable state (`let`/`var` at module scope) — Workers reuse isolates across requests.
- ❌ `Math.random()` for security values — use `crypto.getRandomValues()`.
- ❌ Floating-point for money — string decimals.
- ❌ `SELECT *` — always select explicit columns.
- ❌ Raw SQL — always use Drizzle.
- ❌ `any` in domain code (eslint will catch this; don't disable the rule).

**Wrangler config format choice:**
- Architecture says `wrangler.toml`. Stay with TOML for this project. Do not use `wrangler.jsonc` even though Cloudflare docs increasingly favor it.

**Bun-vs-node command rule (workspace AGENTS.md):**
- Always `bun add` / `bun run` / `bunx` — never `npm`/`yarn`/`pnpm`/`npx`.
- Run a TS file directly with `bun <file>` if needed for ad-hoc scripts (not applicable here).

**Wrangler dev caveats:**
- `wrangler dev` runs in Miniflare locally. D1/KV/R2 state is in `.wrangler/state/` (gitignored).
- For the smoke test, `GET /` should respond 200 even with placeholder D1/KV/R2 IDs because the route doesn't touch them.
- If `wrangler dev` complains about missing real IDs, that is fine for `dev` but will fail on `wrangler deploy` until the user populates them.

**Type generation flow:**
- `bunx wrangler types` reads `wrangler.toml` and produces `worker-configuration.d.ts` with the `Env` interface. Run it AFTER `wrangler.toml` is correct. The generated file is gitignored.
- Reference `Env` from `worker-configuration.d.ts` everywhere — do not hand-write the bindings interface.

**INITIAL_PASSWORD handling (relevant context, used in Story 1.4):**
- Set in `.dev.vars` for local dev (gitignored), and via `bunx wrangler secret put INITIAL_PASSWORD` in production.
- This story only needs to document the variable in `.env.example` and ensure the typed `Env` includes it. Wrangler types pulls it from the `[vars]` table only if declared; for secrets, declare a `[vars]` placeholder in `wrangler.toml` purely to drive type generation — value gets overridden by the actual secret. Alternatively, augment the `Env` interface in `src/types/env.ts`. Use whichever is cleaner with current wrangler types behavior.

**ESLint flat config — adding the import restriction:**
- The shared config (`packages/eslint-config/base.js`) is a flat config. Append a new block (don't replace the import). Pattern:
  ```js
  // apps/api/eslint.config.mjs
  import { config } from "@repo/eslint-config/base";

  export default [
    ...config,
    {
      files: ["src/lib/**/*.ts"],
      rules: {
        "no-restricted-imports": ["error", {
          patterns: [
            { group: ["**/services/**", "**/routes/**", "../services/*", "../routes/*", "../../services/*", "../../routes/*"], message: "lib/ must not import from services/ or routes/" }
          ]
        }]
      }
    }
  ];
  ```
- Pure `no-restricted-imports` patterns are sufficient and avoid adding `eslint-plugin-import` as a new dependency. Verify the patterns actually trigger via the optional sanity check in Task 8.3.

**Test pool-workers gotcha:**
- Tests run inside the actual Workers runtime — `process` and Node.js APIs are not available unless `nodejs_compat` is on (which we set in `wrangler.toml`).
- The KV/D1/R2 bindings in tests are isolated per test run by default. State does not bleed between test files unless `singleWorker: true` is set in pool options.

### Project Structure Notes

This story creates the **scaffold** for the directory tree below (Story 1.2+ fill in the implementation files). All paths are relative to `apps/api/`:

```
apps/api/
├── package.json                     # Updated: deps + scripts
├── tsconfig.json                    # Updated: types: ["@cloudflare/workers-types"]
├── wrangler.toml                    # NEW: D1/R2/KV bindings + cron
├── drizzle.config.ts                # NEW
├── vitest.config.ts                 # NEW
├── eslint.config.mjs                # Updated: + import restriction
├── .gitignore                       # Updated: + .wrangler, .dev.vars, worker-configuration.d.ts
├── .env.example                     # NEW
├── .dev.vars                        # NEW (gitignored, local-only)
├── worker-configuration.d.ts        # NEW (generated, gitignored)
├── src/
│   ├── index.ts                     # Updated: OpenAPIHono base + placeholder GET /
│   ├── routes/.gitkeep              # NEW
│   ├── services/.gitkeep            # NEW
│   ├── middleware/.gitkeep          # NEW
│   ├── db/
│   │   ├── schema/index.ts          # NEW (empty barrel: export {})
│   │   └── migrations/.gitkeep      # NEW
│   ├── lib/.gitkeep                 # NEW
│   ├── schemas/.gitkeep             # NEW
│   └── types/.gitkeep               # NEW
└── tests/
    ├── setup.ts                     # NEW
    ├── setup.test.ts                # NEW (smoke test: KV round-trip)
    ├── fixtures/factories.ts        # NEW (stub)
    ├── unit/services/.gitkeep       # NEW
    ├── unit/lib/.gitkeep            # NEW
    └── integration/.gitkeep         # NEW
```

**Detected variances vs architecture (handle as documented):**
1. Architecture lists vitest `^3.2.x`; installed is `4.1.7`. **Use 4.1.7** — the architecture is older. The pool-workers v0.16.10 supports vitest 4.x.
2. Architecture lists drizzle-kit `^0.27.x`; installed is `0.31.10`. **Use 0.31.10**. The drizzle-kit config API for D1 may differ slightly — verify via `apps/api/node_modules/drizzle-kit/README.md` or context7 before finalizing the config.
3. Architecture lists `db/schema.ts` (single file) in one section but `db/schema/` (per-domain) in the detailed structure. **Use `db/schema/`** (per-domain). Story 1.2 confirms this.
4. Architecture mentions `@hono/zod-validator` in passing in Decision Impact Analysis but Story 1.3 clarifies `@hono/zod-openapi` provides built-in validation. **Do not install `@hono/zod-validator`.**
5. The current `apps/api/package.json` `dev` script uses `bun run --hot src/index.ts` (runs Hono on Bun, not Workers runtime). **Replace with `wrangler dev`** — Bun is the package manager, but the runtime is Cloudflare Workers.

### Testing Standards Summary

For this story, tests are minimal (one smoke test proving the pool-workers harness works). The full testing pattern is established here for all subsequent stories:

- **Unit tests** (`tests/unit/`): mock the `db` parameter, no Miniflare. Fast, run in plain Node. Use for pure service logic.
- **Integration tests** (`tests/integration/`): real D1/KV/R2 via pool-workers. Use for full route lifecycle.
- **Test data factories** (`tests/fixtures/factories.ts`): shared builders for users, accounts, transactions. Each subsequent story extends this file.
- **Test runner**: `bun run test --run` (single execution). Watch mode is OK locally but never in scripts.
- **Coverage targets**: not specified for MVP — focus on critical paths (auth, balance derivation, transfers).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1-Story-1.1-Project-Scaffold-Infrastructure-Configuration]
- [Source: _bmad-output/planning-artifacts/architecture.md#Starter-Template-Evaluation]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries#Complete-Project-Directory-Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural-Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation-Patterns-&-Consistency-Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision-Impact-Analysis]
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-05-28.md (greenfield section, package manager alignment, @hono/zod-openapi clarification)]
- [Source: AGENTS.md (workspace package manager rules — bun only)]
- [Source: packages/typescript-config/base.json (inherited strict TS options)]
- [Source: packages/eslint-config/base.js (inherited strict-type-checked rules)]

## Latest Tech Information

The following are confirmed against current Cloudflare Workers documentation (verified 2026-05-28):

- **wrangler.toml vs wrangler.jsonc**: Both are fully supported in Wrangler v4. Cloudflare docs increasingly favor `wrangler.jsonc` for new projects, but TOML remains first-class. **This project uses `wrangler.toml` per architecture.**
- **`@cloudflare/vitest-pool-workers` v0.16.10**: Verified by inspecting `dist/pool/index.d.mts` — the canonical export is `cloudflareTest(options)` returning a Vite plugin. There is no `defineWorkersConfig` re-export in this version. Configure via `plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })]` in `vitest.config.ts`. Bindings are imported in tests via `import { env } from "cloudflare:test"`.
- **`compatibility_flags = ["nodejs_compat"]`** is required for `@noble/hashes` (uses some Node-style imports under the hood) and for many other ecosystem libs. Keep it on.
- **Drizzle Kit 0.31.x for D1**: Use `dialect: "sqlite"`. The `driver: "d1-http"` driver requires Cloudflare API token + account ID env vars for remote schema introspection. For purely local generate-only flow (which is all this story needs), the driver field can be omitted — `drizzle-kit generate` works from the schema file alone.
- **`bunx wrangler types`** is the supported flow for binding type generation in Wrangler v4. Output file is `worker-configuration.d.ts` at `apps/api/`.

## Project Context Reference

No `project-context.md` was found in this repository at story creation time. The persistent facts file pattern is configured in the workflow but the project has not yet generated one. Authoritative project guidance for AI agents is in:
- `AGENTS.md` (root) — package manager and tool usage rules.
- `_bmad-output/planning-artifacts/architecture.md` — all architectural decisions and patterns.
- `_bmad-output/planning-artifacts/epics.md` — full FR/NFR catalog and epic/story breakdown.

If the dev agent needs more context on a topic not covered here, **read those documents directly** rather than guessing.

## Story Completion Status

This is the **first story** in the project. There is no previous-story intelligence to inherit. Successful completion of this story unlocks all subsequent stories: every other story builds on the scaffold, bindings, type system, test harness, and OpenAPI base app established here.

Critical success signals when this story is done:
1. `bun install` from repo root is clean and `bun.lock` lists every required dependency.
2. `bun run check-types` and `bun run lint` are both green.
3. The Vitest pool-workers smoke test passes (proves bindings flow into tests).
4. `bunx wrangler dev` boots and serves a 200 from `GET /`.
5. The directory tree mirrors `architecture.md#Complete-Project-Directory-Structure`.
6. ESLint correctly forbids `lib/ → services/` and `lib/ → routes/` imports.

After completion, the next story is **1.2: Database Schema & Migration Workflow**, which adds the `users` and `settings` tables and proves the migration generation/apply flow.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `bun add hono drizzle-orm @hono/zod-openapi zod @noble/hashes aws4fetch`
- `bun add -D drizzle-kit @cloudflare/vitest-pool-workers @cloudflare/workers-types vitest wrangler`
- `bunx wrangler types`
- `bun install`
- `bun run check-types`
- `bun run lint`
- `bun run test --run`
- `bunx wrangler dev --port 8787` + `curl http://127.0.0.1:8787/` smoke test

### Completion Notes List

- Completed API scaffold for Cloudflare Workers with Wrangler, Drizzle, Vitest pool-workers, and strict TypeScript/ESLint integration.
- Added required dependency and script setup in `apps/api/package.json` and refreshed `bun.lock` using Bun.
- Generated `worker-configuration.d.ts` from `wrangler.toml`; verified bindings include `DB`, `RECEIPTS`, `SESSIONS`, and `INITIAL_PASSWORD`.
- Implemented OpenAPIHono bootstrap app and verified `GET /` returns `200` with JSON payload.
- Implemented lint boundary to block `src/lib/**` imports from `src/services/**` and `src/routes/**`; confirmed rule triggers on a temporary sanity fixture and removed it.
- Added test harness scaffolding (`tests/setup.ts`, `tests/fixtures/factories.ts`) and passing KV round-trip smoke test.
- Deviation noted: `zod` was finalized at `^4.4.3` to satisfy `@hono/zod-openapi@1.4.0` peer dependency requirements.

### File List

- `apps/api/.env.example` (new)
- `apps/api/.gitignore` (updated)
- `apps/api/.dev.vars` (new, local/gitignored)
- `apps/api/drizzle.config.ts` (new)
- `apps/api/eslint.config.mjs` (updated)
- `apps/api/package.json` (updated)
- `apps/api/src/index.ts` (updated)
- `apps/api/src/db/schema/index.ts` (new)
- `apps/api/src/routes/.gitkeep` (new)
- `apps/api/src/services/.gitkeep` (new)
- `apps/api/src/middleware/.gitkeep` (new)
- `apps/api/src/db/migrations/.gitkeep` (new)
- `apps/api/src/lib/.gitkeep` (new)
- `apps/api/src/schemas/.gitkeep` (new)
- `apps/api/src/types/.gitkeep` (new)
- `apps/api/tests/setup.ts` (new)
- `apps/api/tests/setup.test.ts` (new)
- `apps/api/tests/fixtures/factories.ts` (new)
- `apps/api/tests/fixtures/.gitkeep` (new)
- `apps/api/tests/unit/services/.gitkeep` (new)
- `apps/api/tests/unit/lib/.gitkeep` (new)
- `apps/api/tests/integration/.gitkeep` (new)
- `apps/api/tsconfig.json` (updated)
- `apps/api/vitest.config.ts` (new)
- `apps/api/wrangler.toml` (new)
- `bun.lock` (updated)

## Change Log

- 2026-05-28: Implemented Story 1.1 scaffold and configuration; all verification gates passed and story moved to `review`.

### Review Findings

- [x] [Review][Decision] `@cloudflare/vitest-pool-workers/types` in tsconfig `types` array — AC-3 specifies only `["@cloudflare/workers-types"]`; adding pool-workers types here is an undocumented deviation that may cause duplicate global declarations. Needs decision: keep in tsconfig (simpler) or move to a dedicated `tests/tsconfig.json` (cleaner separation). **Resolved: kept both in root tsconfig.json (no actual conflicts); ESLint unsafe rules disabled for test files since `cloudflare:test` is a virtual module unresolvable by static analysis. `tests/tsconfig.json` created for future tsc-level test isolation.**
- [x] [Review][Patch] `INITIAL_PASSWORD` exposed as plaintext `[vars]` in `wrangler.toml` — AC-9 requires it as a secret in `.dev.vars` only; declaring it under `[vars]` commits a default value to source control and deploys it as a plaintext env var. Remove from `[vars]` and document the `wrangler secret put` flow instead. [`apps/api/wrangler.toml`]
- [x] [Review][Patch] `driver: "d1-http"` in `drizzle.config.ts` requires remote Cloudflare credentials (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, `CLOUDFLARE_D1_TOKEN`) that are not set up — AC-5 requires the config be functional for local `drizzle-kit generate`; omit the `driver` field for the purely local generate-only flow. [`apps/api/drizzle.config.ts`]
- [x] [Review][Patch] `@types/bun` kept in devDependencies while tsconfig replaces Bun types with Workers types — creates a latent type conflict; remove `@types/bun` from `apps/api/package.json` since this is a Workers runtime, not a Bun runtime. [`apps/api/package.json`]
- [x] [Review][Patch] `@types/bun: latest` is unpinned — violates monorepo lockfile discipline; pin to a specific version (e.g. `^1.2.0`). [`apps/api/package.json`]
- [x] [Review][Patch] `.env.example` documents placeholder IDs only in prose comments — AC-9 intent is that developers see assignable variable entries; add `D1_DATABASE_ID=<replace-with-output-of-wrangler-d1-create>` and `KV_SESSIONS_ID=<replace-with-output-of-wrangler-kv-namespace-create>` as actual lines. [`apps/api/.env.example`]
- [x] [Review][Defer] `seedUser()` in `tests/setup.ts` duplicates stub instead of composing with `userFactory` — pre-existing design choice; Story 1.2+ will fill in real DB seeding. [`apps/api/tests/setup.ts`] — deferred, pre-existing
- [x] [Review][Defer] Cron trigger defined in `wrangler.toml` but no `scheduled()` handler exported — intentional scaffold; handler is out of scope for Story 1.1. [`apps/api/wrangler.toml`] — deferred, pre-existing
- [x] [Review][Defer] No global error handler or 404 handler on the Hono app — Story 1.3 scope (Global Middleware & Error Handling). [`apps/api/src/index.ts`] — deferred, pre-existing
