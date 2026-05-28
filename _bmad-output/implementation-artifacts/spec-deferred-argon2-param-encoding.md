---
title: 'Argon2 Param Encoding in Stored Hash'
type: 'chore'
created: '2026-05-29'
status: 'done'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `verifyPassword` in `src/lib/crypto.ts` always uses the hardcoded `ARGON2_PARAMS` constant when verifying an argon2id hash. If `ARGON2_PARAMS` ever changes (e.g. increasing `t` or `m` for stronger hashing), all existing stored hashes silently fail verification because the params used to hash no longer match the params used to verify.

**Approach:** Encode `t`, `m`, `p` into the stored hash string at hash time, and decode them from the stored string at verify time. Support both the old format (backward compat for any existing hashes) and the new format.

## Boundaries & Constraints

**Always:**
- New hash format: `argon2id:t=<t>,m=<m>,p=<p>:<salt_hex>:<hash_hex>`
- Old hash format (backward compat): `argon2id:<salt_hex>:<hash_hex>` — must still verify correctly using the current `ARGON2_PARAMS` constant as fallback.
- `pbkdf2` format is unchanged.
- No changes to the HTTP API, DB schema, or any file outside `src/lib/crypto.ts`.

**Ask First:** nothing — fully self-contained.

**Never:**
- Do not break verification of hashes already stored in the DB (old format must still work).
- Do not change the `ARGON2_PARAMS` constant values.
- Do not modify any file outside `src/lib/crypto.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hash new password | any password | returns `argon2id:t=3,m=65536,p=1:<salt_hex>:<hash_hex>` | falls back to pbkdf2 on argon2 error |
| Verify new-format hash | `argon2id:t=3,m=65536,p=1:<salt>:<hash>` + correct password | returns `true` | returns `false` on error |
| Verify old-format hash | `argon2id:<salt>:<hash>` + correct password | returns `true` using `ARGON2_PARAMS` fallback | returns `false` on error |
| Verify new-format hash wrong password | new-format hash + wrong password | returns `false` | — |
| Verify malformed hash | missing segments | returns `false` | — |
| Verify pbkdf2 hash | `pbkdf2:<salt>:<hash>` | unchanged behaviour | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/lib/crypto.ts` -- `hashPassword` and `verifyPassword` — only file that changes

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/src/lib/crypto.ts` -- In `hashPassword`: change the returned string from `` `argon2id:${toHex(salt)}:${toHex(hash)}` `` to `` `argon2id:t=${ARGON2_PARAMS.t},m=${ARGON2_PARAMS.m},p=${ARGON2_PARAMS.p}:${toHex(salt)}:${toHex(hash)}` ``. In `verifyPassword` for the `argon2id` branch: after splitting on `:`, detect whether the second segment starts with `t=` (new format, 4 segments) or is a hex string (old format, 3 segments). For new format, parse `t`, `m`, `p` from the params segment and use them in `argon2idAsync`. For old format, fall back to `ARGON2_PARAMS`.

**Acceptance Criteria:**
- Given `hashPassword` is called, when the result is inspected, then it matches `/^argon2id:t=\d+,m=\d+,p=\d+:[a-f0-9]+:[a-f0-9]+$/` (or starts with `pbkdf2:` on fallback).
- Given a new-format hash and the correct password, when `verifyPassword` is called, then it returns `true`.
- Given a new-format hash and the wrong password, when `verifyPassword` is called, then it returns `false`.
- Given an old-format hash (`argon2id:<salt>:<hash>`) and the correct password, when `verifyPassword` is called, then it returns `true` (backward compat).
- Given `bun run test --run` is executed in `apps/api`, then all tests pass.

## Design Notes

**Param segment detection:** After `storedHash.split(":")`, check if `parts[1]` starts with `t=`. If yes → new format (4 parts: `[algo, params, saltHex, hashHex]`). If no → old format (3 parts: `[algo, saltHex, hashHex]`).

**Param parsing (new format):**
```ts
// params segment: "t=3,m=65536,p=1"
const paramMap = Object.fromEntries(
  paramsSegment.split(",").map((kv) => kv.split("=") as [string, string])
);
const t = Number(paramMap.t);
const m = Number(paramMap.m);
const p = Number(paramMap.p);
// validate: all must be positive integers
```

## Verification

**Commands:**
- `bun run check-types` (in `apps/api`) -- expected: no TypeScript errors
- `bun run test --run` (in `apps/api`) -- expected: all tests pass, exit 0
