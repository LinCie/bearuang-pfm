# AGENTS.md

Project-wide guidance for AI agents working in this repository.

## Package Manager

This is a **Bun** project (Turborepo monorepo with `apps/*` and `packages/*` workspaces). The pinned package manager is `bun@1.3.14` (see `package.json` → `packageManager`).

**Always use `bun`. Never use `npm`, `yarn`, or `pnpm`.**

Common commands:

- Install dependencies: `bun install`
- Add a dependency: `bun add <pkg>` (use `-d` for dev, `-w` for workspace root, `--filter <workspace>` for a specific workspace)
- Remove a dependency: `bun remove <pkg>`
- Run a script: `bun run <script>` (e.g. `bun run build`, `bun run dev`, `bun run lint`, `bun run check-types`)
- Execute a binary: `bunx <bin>` instead of `npx <bin>`
- Run a TS/JS file directly: `bun <file>` instead of `node <file>` or `ts-node <file>`

Do not generate or commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`. The single source of truth is `bun.lock`.

If a `README` or doc snippet shows `npm`/`yarn`/`pnpm` commands, translate them to the `bun` equivalent before running.

## Available Tools — Use Them When Relevant

Every agent session in this repo has access to these tools. Reach for them instead of guessing:

### context7

For up-to-date documentation, API references, and code examples for libraries, frameworks, SDKs, and developer tools.

Use it when:

- Working with a library you are not certain about (API shape, current version, breaking changes)
- The user references a specific framework/SDK and you need authoritative docs
- You are about to write non-trivial integration code against a third-party package
- Existing code uses an unfamiliar library and you need to verify correct usage

Prefer `context7` over relying on training-data memory for any library-specific code.

### Web search

For information that is genuinely current or outside training data.

Use it when:

- The user asks about current versions, recent releases, pricing, or changelogs
- You need to verify behavior that may have changed recently
- The user provides a URL or asks you to look something up
- A library is too new or niche for `context7` to have coverage

Order of preference for code/library questions:

1. Read the repository (existing usage, lockfile, types).
2. Use `context7` for library docs.
3. Use web search only if the above do not resolve the question.

Skip these tools for well-established language syntax, basic concepts, or anything already answered by the codebase itself.
