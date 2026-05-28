---
title: 'Structured Error Logging in Error Handler'
type: 'chore'
created: '2026-05-29'
status: 'done'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The unhandled-error path in `error-handler.ts` builds its log line by passing a single pre-serialised JSON string to `console.error`. This means all fields are serialised together in one shot, which prevents log aggregators from indexing individual fields and creates a log-injection risk if any field is ever concatenated rather than serialised. Additionally, `err.stack` is never captured, making production debugging harder.

**Approach:** Replace the `JSON.stringify(...)` call with a plain object passed directly to `console.error` so the runtime serialises each field independently. Add `stack: err.stack` to the logged object (server-side only — never in the HTTP response).

## Boundaries & Constraints

**Always:**
- `err.stack` must only appear in the server-side log — never in the HTTP response body.
- The HTTP response shape must remain identical (status 500, `INTERNAL_ERROR` code, generic message).
- No new dependencies — use `console.error` with a plain object literal.

**Ask First:** nothing — change is fully self-contained.

**Never:**
- Do not change the HTTP response body or status code.
- Do not log stack traces for `HTTPException` paths (those are expected errors, not bugs).
- Do not introduce a logging library or abstraction layer.

</frozen-after-approval>

## Code Map

- `apps/api/src/middleware/error-handler.ts` -- unhandled-error logging block — the only file that changes

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/src/middleware/error-handler.ts` -- Replace `console.error(JSON.stringify({ level, action, error: message }))` with `console.error({ level: "error", action: "unhandled_error", error: message, stack: err.stack })`. Remove the `JSON.stringify` wrapper entirely.

**Acceptance Criteria:**
- Given an unhandled error is thrown, when the error handler runs, then `console.error` is called with a plain object containing `level`, `action`, `error`, and `stack` fields — not a pre-serialised JSON string.
- Given an unhandled error is thrown, when the HTTP response is inspected, then the body contains only `{ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } }` — no stack trace.
- Given an `HTTPException` is thrown, when the error handler runs, then `console.error` is NOT called (HTTPExceptions are expected errors).
- Given `bun run test --run` is executed in `apps/api`, then all tests pass.

## Verification

**Commands:**
- `bun run check-types` (in `apps/api`) -- expected: no TypeScript errors
- `bun run test --run` (in `apps/api`) -- expected: all tests pass, exit 0
