# Story 2.3: String Decimal Math Library & Account Balance Derivation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the app owner,
I want to see accurate current balances for each account and my total net worth,
so that I know exactly how much money I have without floating-point rounding errors.

## Acceptance Criteria

1. **AC-1 `add` and `subtract`:** A new module `apps/api/src/lib/decimal.ts` exports `add(a: string, b: string): string` and `subtract(a: string, b: string): string`. `add("12.50", "3.75")` returns `"16.25"`; `subtract("100.00", "33.33")` returns `"66.67"`. Both operate purely on the decimal strings via integer/BigInt arithmetic — never `parseFloat`/`Number`/`+` on the values. [Source: epics.md#Story-2.3, architecture.md#Data-Architecture, architecture.md#Anti-Patterns]

2. **AC-2 `sum`:** `decimal.ts` exports `sum(values: string[]): string`. `sum(["1.10", "2.20", "3.30"])` returns `"6.60"` (note the preserved trailing zero — see Dev Notes "Why not big.js"). `sum([])` returns `"0"`. `sum(["1.10"])` returns `"1.10"`. [Source: epics.md#Story-2.3]

3. **AC-3 `compare`:** `decimal.ts` exports `compare(a: string, b: string): -1 | 0 | 1`. `compare("10.00", "9.99")` returns `1`; `compare("5.00", "5.00")` returns `0`; `compare("1.00", "2.00")` returns `-1`. Comparison aligns scales before comparing, so `compare("1.0", "1.00")` returns `0`. [Source: epics.md#Story-2.3]

4. **AC-4 Precision, negatives, and no-float invariants:** Operations preserve precision as-entered — the result scale equals the **maximum** fractional-digit count among the operands (e.g. `add("1000.00", "0")` returns `"1000.00"`, NOT `"1000"`). Negative amounts are supported (`subtract("0.00", "50.00")` returns `"-50.00"`; `add("-50.00", "50.00")` returns `"0.00"` — never `"-0.00"`). The classic float trap `add("0.1", "0.2")` returns exactly `"0.3"`. No operation uses floating-point arithmetic internally at any point. [Source: epics.md#Story-2.3, architecture.md#Amount-Format]

5. **AC-5 `current_balance` on account listing:** `GET /api/v1/accounts` returns each account item with an added `current_balance` string field where `current_balance = initial_balance + (sum of all non-deleted transactions affecting the account)`. Because the `transactions` table does not exist until Epic 3, the transaction sum is `"0"` for every account in this story, so `current_balance` equals `initial_balance` (with scale preserved). [Source: epics.md#Story-2.3]

6. **AC-6 Forward-compatible balance derivation:** The balance derivation logic gracefully returns `initial_balance` when the `transactions` table does not yet exist or is empty. It MUST NOT throw or 500 when no `transactions` table is present (the integration test DB has no such table this epic). The derivation is structured with a single clearly-marked seam (`getTransactionDeltas`) that Epic 3 will fill in — see Dev Notes. [Source: epics.md#Story-2.3 (forward-compatible with Epic 3)]

7. **AC-7 `current_balance` equals `initial_balance` with no transactions:** Given an account with `initial_balance "1000.00"` and no transactions, when `GET /api/v1/accounts` is called, that account's `current_balance` is exactly `"1000.00"`. [Source: epics.md#Story-2.3]

8. **AC-8 `summary` object on account listing:** `GET /api/v1/accounts` includes a top-level `summary` object with string-decimal fields `total_assets`, `total_liabilities`, and `net_worth`. `total_assets` is the `sum` of `current_balance` for accounts classified as assets (`bank`, `cash`, `ewallet`, `investment`); `total_liabilities` is the `sum` of `current_balance` for accounts classified as liabilities (`credit_card`, `loan`). With no accounts, all three are `"0"`. Classification reuses the existing `classifyAccountType` helper (Story 2.2). [Source: epics.md#Story-2.3, epics.md#Story-2.2 (asset/liability classification)]

9. **AC-9 `net_worth` formula:** `net_worth = total_assets - total_liabilities` computed via `subtract`. All three summary amounts are string decimals. [Source: epics.md#Story-2.3]

10. **AC-10 Soft-deleted accounts excluded from listing and net worth:** A soft-deleted account (`is_active = 0`) is excluded from the `GET /api/v1/accounts` `items` array AND from the `summary` totals. This is automatic: the listing query already filters `is_active = 1` (Story 2.2), and the summary is computed only from the returned items. [Source: epics.md#Story-2.3]

11. **AC-11 No new table / no schema migration:** This story introduces NO database migration and NO new Drizzle table. The `transactions` table is created in Epic 3 (Story 3.1), not here. `current_balance` and `summary` are computed in the service layer at request time (TypeScript aggregation, not SQL SUM) — no stored running total. [Source: epics.md#Story-3.1 (transactions table), architecture.md#Data-Architecture (Aggregation = TypeScript service layer)]

12. **AC-12 Type-check, lint, and tests pass:** `bun run check-types`, `bun run lint`, and `bun run test --run` (from `apps/api/`) all exit 0. A new unit test `apps/api/tests/unit/lib/decimal.test.ts` covers AC-1 through AC-4. The existing `apps/api/tests/integration/accounts.test.ts` is updated: the obsolete `"list omits current_balance and summary"` test (a Story 2.2 scope guard) is replaced with coverage asserting `current_balance` and `summary` are now present and correct. No regressions in any other suite (`auth`, `categories`, `health`, `middleware`, `schema`, `settings`, `setup`, and the rest of `accounts`). [Source: architecture.md#Test-Organization, apps/api/tests/integration/accounts.test.ts]

## Tasks / Subtasks

- [x] **Task 1: Create the string-decimal math library** (AC: 1, 2, 3, 4)
  - [x] 1.1 Create `apps/api/src/lib/decimal.ts`. It imports NOTHING internal (lib/ must not import from services/ or routes/ — enforced by eslint `no-restricted-imports`). Use the BigInt fixed-point reference implementation in Dev Notes verbatim (DO NOT use `big.js`/`decimal.js-light` — they strip trailing zeros and fail AC-2; see "Why not big.js").
  - [x] 1.2 Export exactly four pure functions: `add(a, b)`, `subtract(a, b)`, `sum(values)`, `compare(a, b)`. Each parses operands to `{ negative, digits, scale }`, aligns to the max scale, does BigInt arithmetic, and formats back. Result scale = max input scale (AC-4). Normalize negative zero to `"0"`/`"0.00"` (no `"-0.00"`).
  - [x] 1.3 `parse` validates against `/^-?\d+(\.\d+)?$/` and throws `RangeError` on malformed input (defensive — API inputs are already Zod-validated upstream, but the lib must be self-contained for unit tests). `sum([])` returns `"0"`.

- [x] **Task 2: Extend account schemas with balance + summary** (AC: 5, 8, 9)
  - [x] 2.1 In `apps/api/src/schemas/account.schema.ts`, add (keep `import { z } from "zod"` — do NOT switch to the openapi import):
    ```typescript
    export const accountWithBalanceSchema = accountSchema.extend({
      current_balance: z.string(),
    });

    export const accountSummarySchema = z.object({
      total_assets: z.string(),
      total_liabilities: z.string(),
      net_worth: z.string(),
    });
    ```
  - [x] 2.2 MODIFY `accountListResponseSchema` in place (keep the exported name — `routes/accounts.ts` and the integration test already import it) to:
    ```typescript
    export const accountListResponseSchema = z.object({
      items: z.array(accountWithBalanceSchema),
      summary: accountSummarySchema,
    });
    ```
  - [x] 2.3 Add exported types: `export type AccountWithBalance = z.infer<typeof accountWithBalanceSchema>;` and `export type AccountListResponse = z.infer<typeof accountListResponseSchema>;`. Do NOT add `current_balance` to the base `accountSchema` — create/get/update still return the plain account (AC scope: balance only on the LIST endpoint).

- [x] **Task 3: Implement balance derivation in the account service** (AC: 5, 6, 7, 8, 9, 10, 11)
  - [x] 3.1 In `apps/api/src/services/account.service.ts`, add `sql` to the drizzle import (`import { asc, eq, sql } from "drizzle-orm";`) and import the math helpers (`import { add, subtract, sum } from "../lib/decimal";`). Import the new types from `../schemas/account.schema`.
  - [x] 3.2 Add the forward-compatible transactions seam (this is the ONLY place Epic 3 will need to change for balance math):
    ```typescript
    const ZERO = "0";

    // Forward-compatible seam for Epic 3. The `transactions` table does not exist
    // until Story 3.1, so today every account has a zero delta and current_balance
    // equals initial_balance (AC-6). We probe for the table rather than run a real
    // query because transaction sign/transfer semantics are undefined until Epic 3
    // — DO NOT fabricate a `SUM(amount)` here (see Anti-Patterns). When the table
    // lands, Epic 3 fills the existence branch with real per-account summation.
    //
    // This is the same "gracefully tolerate the missing transactions table" need
    // that category.service.ts (Story 2.1) already solves; see the Dev Note below
    // for why this seam probes instead of using that file's run-and-catch guard.
    const getTransactionDeltas = async (
      db: DrizzleD1Database,
    ): Promise<Map<string, string>> => {
      const tables = await db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'`,
      );
      if (tables.length === 0) {
        return new Map();
      }
      // Epic 3 (Story 3.1+) implements per-account transaction summation here.
      return new Map();
    };
    ```
  - [x] 3.3 Rewrite `listAccounts` to return `{ items, summary }`. Keep the existing `is_active = 1` filter and the `created_at, name, id` ordering. For each row, `current_balance = add(account.initial_balance, deltas.get(account.id) ?? ZERO)`. Compute `total_assets = sum(asset current_balances)`, `total_liabilities = sum(liability current_balances)` using the existing `classifyAccountType`, and `net_worth = subtract(total_assets, total_liabilities)`. Return type `Promise<AccountListResponse>`. See the reference snippet in Dev Notes.
  - [x] 3.4 Do NOT change `createAccount`, `getAccount`, `updateAccount`, `deleteAccount`, or `classifyAccountType` — they keep returning the plain `Account`. Do NOT add a migration. Do NOT query/define a `transactions` Drizzle table.

- [x] **Task 4: Confirm the route layer needs no change** (AC: 5, 8)
  - [x] 4.1 `apps/api/src/routes/accounts.ts` already wires `listAccountsRoute` to `accountListResponseSchema` and the handler returns `c.json(result, 200)`. Because the service now returns the `{ items, summary }` shape and the schema was updated in Task 2, `check-types` keeps the handler return type aligned automatically. Verify no edit is required; only touch this file if `bun run check-types` reports a mismatch.

- [x] **Task 5: Unit tests for `decimal.ts`** (AC: 1, 2, 3, 4, 12)
  - [x] 5.1 Create `apps/api/tests/unit/lib/decimal.test.ts` (this adds the first test under `tests/unit/lib/`). Import `{ add, subtract, sum, compare } from "../../../src/lib/decimal"`.
  - [x] 5.2 Cover: the exact AC examples for `add`/`subtract`/`sum`/`compare`; scale preservation (`add("1000.00", "0") === "1000.00"`, `sum(["1.10","2.20","3.30"]) === "6.60"`); negatives (`subtract("0.00","50.00") === "-50.00"`, `add("-50.00","50.00") === "0.00"`); the float trap (`add("0.1","0.2") === "0.3"`); cross-scale compare (`compare("1.0","1.00") === 0`); `sum([]) === "0"` and `sum(["1.10"]) === "1.10"`.

- [x] **Task 6: Update the accounts integration tests** (AC: 5, 7, 8, 9, 10, 12)
  - [x] 6.1 In `apps/api/tests/integration/accounts.test.ts`, REPLACE the `"list omits current_balance and summary"` test (it was a Story 2.2 scope guard and is now wrong) with `"list includes current_balance and summary"`: create one asset account with `initial_balance "1000.00"`, GET the list, parse with `accountListResponseSchema`, assert the item's `current_balance === "1000.00"` (AC-7) and that `summary` exists.
  - [x] 6.2 Add `"summary computes net worth from assets and liabilities"`: seed (via `accountFactory` + direct insert, with `created_by/updated_by` = the logged-in `userId`) e.g. a `bank` asset `"5000000.00"`, a `cash` asset `"1000.00"`, and a `credit_card` liability `"2000000.00"`; GET; assert `summary.total_assets === "5001000.00"`, `summary.total_liabilities === "2000000.00"`, `summary.net_worth === "3001000.00"`. (Use scales that exercise the decimal math.)
  - [x] 6.3 Add `"excludes soft-deleted accounts from listing and net worth"` (AC-10): seed one active asset `"100.00"` and one `is_active: 0` asset `"999.99"`; GET; assert the deleted account is absent from `items` and `summary.total_assets === "100.00"` (the deleted balance is NOT counted).
  - [x] 6.4 Confirm the remaining tests still pass unchanged — they parse responses with `accountListResponseSchema`, which now requires `summary` and `current_balance`; the service always supplies both, so `lists only active accounts...`, `soft-deletes an account`, and `restores a soft-deleted account...` continue to parse cleanly. Add `30_000` ms timeouts to any new test that calls `login()`.

- [x] **Task 7: Verification gate** (AC: 12)
  - [x] 7.1 `bun run check-types` from `apps/api/` — exit 0.
  - [x] 7.2 `bun run lint` from `apps/api/` — exit 0.
  - [x] 7.3 `bun run test --run` from `apps/api/` — all suites pass (existing + new). If the full run hits the known argon2/Miniflare timeout in `auth.test.ts`, it is environmental and unrelated to this story (accounts/decimal touch no auth code); the accounts + decimal suites must be green.
  - [x] 7.4 Update the Dev Agent Record below with the file list and any deviations.

## Dev Notes

### Critical scope boundary — what this story is and is NOT

Story 2.2 deliberately deferred three things to THIS story; everything else about accounts is already done. This story delivers ONLY:

- ✅ `src/lib/decimal.ts` — string-decimal math (`add`, `subtract`, `sum`, `compare`).
- ✅ `current_balance` on each item of `GET /api/v1/accounts`.
- ✅ `summary` (`total_assets`, `total_liabilities`, `net_worth`) on `GET /api/v1/accounts`.

This story MUST NOT:

- ❌ Create or migrate a `transactions` table — that is Epic 3 / Story 3.1. **No `bun run db:generate` in this story; no new file under `src/db/migrations/`; no new file under `src/db/schema/`.**
- ❌ Add `current_balance` to `createAccount`/`getAccount`/`updateAccount` responses or to the base `accountSchema` — only the LIST endpoint gains balances (per the epic ACs).
- ❌ Implement real transaction summation, signs, or transfer logic — only the empty `getTransactionDeltas` seam. Epic 3 owns transaction math.
- ❌ Store a running balance column — balances are derived at request time (architecture: TypeScript aggregation, no stored total).

[Source: epics.md#Story-2.2 (scope boundary notes), epics.md#Story-2.3, epics.md#Story-3.1, architecture.md#Data-Architecture]

### Why NOT big.js / decimal.js-light (the single biggest trap in this story)

The architecture lists `decimal.js-light`, `big.js`, or "manual fixed-point" as candidates and leaves the choice to implementation time. **Choose manual fixed-point (BigInt).** Reason: AC-2 requires `sum(["1.10","2.20","3.30"]) === "6.60"` and AC-4 requires `add("1000.00","0") === "1000.00"`. `big.js` and `decimal.js-light` **normalize away trailing zeros** in `toString()` — they would return `"6.6"` and `"1000"` and fail these ACs. Getting padded output back would require knowing a fixed target scale and calling `toFixed(n)`, which contradicts "preserve precision as-entered". A BigInt fixed-point implementation that carries the **max operand scale** through to the result is both correct and dependency-free (BigInt is native in the Workers runtime — no `bun add`, no bundle cost, no float fallback path). Do not add a decimal dependency.

### Reference implementation — `src/lib/decimal.ts` (use verbatim)

```typescript
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

interface ParsedDecimal {
  negative: boolean;
  digits: string; // integer + fractional digits, no sign, no dot
  scale: number; // count of fractional digits
}

const parse = (value: string): ParsedDecimal => {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new RangeError(`Invalid decimal string: "${value}"`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  return { negative, digits: `${intPart}${fracPart}`, scale: fracPart.length };
};

const toScaledBigInt = (parsed: ParsedDecimal, targetScale: number): bigint => {
  const padded = parsed.digits + "0".repeat(targetScale - parsed.scale);
  const magnitude = BigInt(padded);
  return parsed.negative ? -magnitude : magnitude;
};

const format = (value: bigint, scale: number): string => {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  if (scale === 0) {
    return negative && value !== 0n ? `-${digits}` : digits;
  }
  const padded = digits.padStart(scale + 1, "0");
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  const sign = negative && value !== 0n ? "-" : "";
  return `${sign}${intPart}.${fracPart}`;
};

export const add = (a: string, b: string): string => {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  return format(toScaledBigInt(pa, scale) + toScaledBigInt(pb, scale), scale);
};

export const subtract = (a: string, b: string): string => {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  return format(toScaledBigInt(pa, scale) - toScaledBigInt(pb, scale), scale);
};

export const sum = (values: string[]): string => {
  if (values.length === 0) return "0";
  const parsed = values.map(parse);
  const scale = parsed.reduce((max, p) => Math.max(max, p.scale), 0);
  const total = parsed.reduce((acc, p) => acc + toScaledBigInt(p, scale), 0n);
  return format(total, scale);
};

export const compare = (a: string, b: string): -1 | 0 | 1 => {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  const diff = toScaledBigInt(pa, scale) - toScaledBigInt(pb, scale);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
};
```

Worked checks: `add("1000.00","0")` → max scale 2 → `100000 + 0` → `format(100000,2)` → `"1000.00"`. `sum(["1.10","2.20","3.30"])` → scale 2 → `660` → `"6.60"`. `add("0.1","0.2")` → scale 1 → `3` → `"0.3"`. `add("-50.00","50.00")` → `0` → `"0.00"` (negative-zero normalized).

### Balance derivation — reference `listAccounts` rewrite

```typescript
export const listAccounts = async (
  db: DrizzleD1Database,
): Promise<AccountListResponse> => {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.is_active, 1))
    .orderBy(asc(accounts.created_at), asc(accounts.name), asc(accounts.id));

  const deltas = await getTransactionDeltas(db);

  const items: AccountWithBalance[] = rows.map((row) => {
    const account = toAccount(row);
    return {
      ...account,
      current_balance: add(account.initial_balance, deltas.get(account.id) ?? ZERO),
    };
  });

  const assetBalances = items
    .filter((item) => classifyAccountType(item.type) === "asset")
    .map((item) => item.current_balance);
  const liabilityBalances = items
    .filter((item) => classifyAccountType(item.type) === "liability")
    .map((item) => item.current_balance);

  const total_assets = sum(assetBalances);
  const total_liabilities = sum(liabilityBalances);

  return {
    items,
    summary: {
      total_assets,
      total_liabilities,
      net_worth: subtract(total_assets, total_liabilities),
    },
  };
};
```

### Why a `sqlite_master` probe is acceptable here

Architecture lists "Raw SQL strings — always use Drizzle query builder" as an anti-pattern, but `sqlite_master` is a SQLite metadata table with no Drizzle model, and the probe uses the parameterless `sql` tagged template (the sanctioned escape hatch — `tests/integration/accounts.test.ts` already queries `sqlite_master` the same way). `DrizzleD1Database` exposes `db.all<T>(sql\`...\`)` (confirmed in Story 2.2 Dev Notes and used live in `category.service.ts`). The probe makes AC-6's "table does not yet exist" branch real and self-documenting, and gives Epic 3 exactly one function to extend. If you prefer to skip the probe entirely (return `new Map()` unconditionally with the same comment), behavior is identical and ACs still pass — but the probe is the chosen design for explicit forward-compatibility. Do NOT throw if the table is missing.

### Precedent: how `category.service.ts` already tolerates the missing `transactions` table — and why this story differs

Story 2.1's `deleteCategory` (`src/services/category.service.ts`) ALREADY faces the "transactions table doesn't exist until Epic 3" problem. Its solution: run the real query and catch the failure —

```typescript
try {
  const rows = await db.all<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM transactions WHERE category_id = ${id}`,
  );
  inUseCount = rows[0]?.count ?? 0;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("no such table")) {
    throw err; // only swallow the missing-table case
  }
}
```

This story deliberately uses an **existence probe instead of run-and-catch**, for one concrete reason: `deleteCategory` has a meaningful query to run TODAY (`COUNT(*) WHERE category_id = ?`), so running-and-catching is natural. Balance derivation has NO valid query to run today — summing transactions requires expense/income/transfer **sign semantics that are undefined until Epic 3**. A `SELECT SUM(amount) ...` here would be actively wrong (it would add transfers and incomes with the wrong signs). So the seam must return an empty delta map without pretending to do transaction math; probing `sqlite_master` expresses that intent cleanly and leaves Epic 3 a single obvious place to implement the real signed summation. Either approach satisfies AC-6 (both must NOT throw on the missing table) — but do NOT copy `category.service.ts`'s run-and-catch and then invent a `SUM` inside it. [Source: apps/api/src/services/category.service.ts (deleteCategory), epics.md#Story-3.1]

### Net worth sign convention

`net_worth = total_assets - total_liabilities`, where each total is the `sum` of the `current_balance`s within that class as returned (no sign flipping). A liability `current_balance` of `"2000000.00"` therefore *reduces* net worth by 2,000,000 — matching Story 2.2's "credit_card/loan: positive balance decreases net worth". Use the existing `classifyAccountType` (assets: `bank`, `cash`, `ewallet`, `investment`; liabilities: `credit_card`, `loan`) — do not re-derive the classification. [Source: epics.md#Story-2.2, epics.md#Story-2.3]

### Regression alert — the Story 2.2 "list omits..." test now inverts

`tests/integration/accounts.test.ts` currently has a test `"list omits current_balance and summary"` that asserts the raw response has NO `summary` and items have NO `current_balance`. That was a 2.2 scope guard and will FAIL once this story ships. You MUST replace it (Task 6.1) — do not leave it. All other `accountListResponseSchema.parse(...)` calls in that file keep working because the service always returns the new shape. This is the only existing test that must change semantics.

### Existing code state (from Stories 1.1–2.2)

- `src/lib/` has `crypto.ts`, `kv.ts`, `rate-limit.ts` (kebab-case, pure helpers, no internal service imports). Add `decimal.ts` alongside.
- `src/schemas/account.schema.ts` exports `accountSchema`, `accountListResponseSchema`, request/params schemas, and types `Account`/`AccountType`. Extend it (Task 2).
- `src/services/account.service.ts` exports `classifyAccountType`, `toAccount` (private), `createAccount`, `listAccounts`, `getAccount`, `updateAccount`, `deleteAccount`. Only `listAccounts` changes.
- `src/routes/accounts.ts` mounts five routes; `listAccountsRoute` already references `accountListResponseSchema`. Likely no edit needed (Task 4).
- `tests/unit/services/account.test.ts` already covers `classifyAccountType`. The new `tests/unit/lib/decimal.test.ts` is the first test under `tests/unit/lib/`.
- `tests/fixtures/factories.ts` has `accountFactory(overrides)` returning a DB insert row (`is_active` is INTEGER `1`, `initial_balance` is a string). Reuse it for seeding.
- Migrations: `0000`, `0001`, `0002` exist. **No `0003` in this story.**

### Files to Create

All under `apps/api/`:
- `src/lib/decimal.ts` — NEW
- `tests/unit/lib/decimal.test.ts` — NEW

### Files to Update

- `src/schemas/account.schema.ts` — add `accountWithBalanceSchema`, `accountSummarySchema`, new types; modify `accountListResponseSchema` in place
- `src/services/account.service.ts` — add `getTransactionDeltas` seam + decimal imports; rewrite `listAccounts`
- `tests/integration/accounts.test.ts` — replace the obsolete "omits" test; add balance + summary + soft-delete-exclusion tests

### Files NOT to Change

- `src/routes/accounts.ts` — should require no edit (verify via `check-types`; touch only if a type mismatch is reported)
- `src/db/schema/*`, `src/db/migrations/*` — NO new table, NO new migration (transactions are Epic 3)
- `src/services/account.service.ts` functions other than `listAccounts` — `createAccount`/`getAccount`/`updateAccount`/`deleteAccount`/`classifyAccountType` unchanged
- `src/middleware/*`, other `src/lib/*`, other `src/services/*`, other `src/routes/*`, other `src/schemas/*` — no changes
- `tests/setup.ts`, `tests/fixtures/factories.ts` — no changes (reuse existing helpers)
- `wrangler.toml`, `drizzle.config.ts`, `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json` — no changes (no new dependency)

### Anti-Patterns to Avoid

- ❌ Adding `big.js`/`decimal.js-light` (fails trailing-zero ACs) or any `bun add` — use the BigInt reference impl.
- ❌ `parseFloat`, `Number(...)`, `+value`, or float math anywhere in `decimal.ts` — BigInt only.
- ❌ Generating a migration or a `transactions` schema/table in this story — Epic 3 owns it.
- ❌ Adding `current_balance` to the base `accountSchema` or to create/get/update responses — list endpoint only.
- ❌ Leaving the old `"list omits current_balance and summary"` test in place — it will fail.
- ❌ Throwing/500 when the `transactions` table is absent — return an empty delta map.
- ❌ Copying `category.service.ts`'s run-and-catch and inventing a `SUM(amount)` inside it — transaction signs are Epic 3; the seam returns an empty map today.
- ❌ Re-implementing asset/liability classification — reuse `classifyAccountType`.
- ❌ Computing balances with SQL `SUM` — string amounts can't be summed in SQLite; aggregate in TypeScript (architecture).
- ❌ `import { z } from "@hono/zod-openapi"` in `account.schema.ts` — keep `import { z } from "zod"`.
- ❌ Importing from `../services/*` or `../routes/*` inside `src/lib/decimal.ts` — eslint will error.

### Previous Story Learnings (Stories 2.1–2.2, non-obvious only)

- **Child routers need their own `defaultHook`** — already present in `accountsRouter`; no new router here, so nothing to add.
- **`.returning()` is unreliable on D1/Drizzle** — not relevant (no inserts in this story), but keep the select-back pattern if you ever add one.
- **30-second timeout on tests that call `login`** — argon2id in Miniflare is slow; every new integration test that logs in needs `30_000`.
- **`beforeEach` clears `accounts`, `users`, `settings`, KV sessions, and `rate_limit:login:global`** — already in `accounts.test.ts`; reuse it as-is.
- **Integration tests call `app.request(path, options, env)`** with `env` third.
- **Assert raw JSON when checking for the ABSENCE of a key** (Zod strips unknowns). When asserting PRESENCE/values of `current_balance`/`summary`, parsing with `accountListResponseSchema` is correct and preferred.
- **Stable list ordering** uses `created_at, name, id` — preserved in the `listAccounts` rewrite.

### Git Intelligence Summary

Recent commits (newest first): `4b7eeff feat: add account crud balance` (Story 2.2 — direct predecessor, created every file you touch here), `b4781fe feat: category crud seed` (Story 2.1), `d7a96ff feat: fix deferred works`. Story 2.2 is the template: it established `account.schema.ts`, `account.service.ts`, `accounts.ts`, and the `accounts.test.ts` patterns this story extends. All stories 1.1–2.2 landed with `check-types`, `lint`, and `test --run` green — that is the bar. No item in `deferred-work.md` blocks this story; the deferred `initial_balance` max-length bound and accounts edge-case coverage are independent hardening items, not part of 2.3. [Source: git log, _bmad-output/implementation-artifacts/deferred-work.md]

### Project Structure Notes

Maps 1:1 onto the architecture's mandated structure with no variance:
- `src/lib/decimal.ts` — matches "Project Organization → lib/decimal.ts # String decimal math utilities".
- `src/services/account.service.ts` (balance derivation) — matches "services/account.service.ts # Account CRUD, balance derivation".
- `tests/unit/lib/decimal.test.ts` — matches "Test Organization → unit/lib/ # Utility function tests" (first test in that dir).
[Source: architecture.md#Project-Structure-and-Boundaries, architecture.md#Test-Organization]

### Latest Tech Information

Verified against installed versions (locked via `bun.lock`; `apps/api/package.json`, 2026-05-29):
- **No new dependency required.** `BigInt` is natively available in the Cloudflare Workers runtime and in Miniflare/`@cloudflare/vitest-pool-workers` v0.16.10 — `decimal.ts` needs no import.
- **`drizzle-orm` v0.36.4** — `sql` tagged template for the `sqlite_master` probe; `db.all<T>(sql\`...\`)` returns typed rows on `DrizzleD1Database` (`drizzle-orm/d1`).
- **`zod` v4.4.3** — `accountSchema.extend({ ... })` and `z.infer<typeof ...>` for the new `AccountWithBalance`/`AccountListResponse` types.
- **`@hono/zod-openapi` v1.4.0** — `.openapi(route, handler)` type-checks the handler's `c.json(...)` against the route's response schema, so updating `accountListResponseSchema` + the service return type keeps the route honest with no manual edit.
- **`vitest` v4.1.7** — unit tests under `tests/unit/lib/` run in the pool-workers environment; pure functions work fine there.

### Project Context Reference

No `project-context.md` is configured for this workspace; persistent facts derive from the architecture and epics documents directly. Canonical pattern references for this story:
- Pure lib helper style (kebab-case, no internal imports): `apps/api/src/lib/kv.ts`, `apps/api/src/lib/crypto.ts`
- Account service + `classifyAccountType` + `toAccount`: `apps/api/src/services/account.service.ts`
- Account schemas (`import { z } from "zod"`): `apps/api/src/schemas/account.schema.ts`
- Account route (list endpoint wiring): `apps/api/src/routes/accounts.ts`
- Integration test bootstrapping + `sqlite_master` probe + login helper: `apps/api/tests/integration/accounts.test.ts`
- Missing-`transactions`-table tolerance precedent (run-and-catch): `apps/api/src/services/category.service.ts` (`deleteCategory`)
- Unit test style: `apps/api/tests/unit/services/account.test.ts`
- Architecture document: `_bmad-output/planning-artifacts/architecture.md`
- Epic + stories source: `_bmad-output/planning-artifacts/epics.md` (Story 2.3 section)

### References

- [Source: epics.md#Story-2.3] — decimal ops, current_balance, summary, net_worth, forward-compatibility ACs
- [Source: epics.md#Story-2.2] — asset/liability classification, scope boundary deferring decimal/balance/summary to 2.3
- [Source: epics.md#Story-3.1] — transactions table belongs to Epic 3 (not this story)
- [Source: architecture.md#Data-Architecture] — amounts as TEXT string decimal; aggregation in TypeScript service layer, not SQL SUM; decimal library "TBD at implementation"
- [Source: architecture.md#Amount-Format] — never floating-point for amounts anywhere
- [Source: architecture.md#Anti-Patterns] — no `amount: number`, no float arithmetic, no raw SQL strings (sqlite_master probe justified above)
- [Source: architecture.md#Project-Structure-and-Boundaries] — `lib/decimal.ts`, `services/account.service.ts`, `tests/unit/lib/`
- [Source: apps/api/eslint.config.mjs] — `lib/**` must not import from `services/**` or `routes/**`

## Review Findings

_Code review 2026-05-29 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor confirmed all 12 ACs satisfied with no violations. Verification gates re-run during review: `check-types`, `lint`, and `tests/unit/lib/decimal.test.ts` all pass. No `decision-needed` and no `patch` findings; the items below are deferrals._

- [x] [Review][Defer] Summary totals ignore per-account `currency` (sums mixed currencies) [apps/api/src/services/account.service.ts:101-120] — deferred; matches AC-8 as written (sum of `current_balance` with no currency grouping). Only `IDR` is exercised today; multi-currency aggregation is undefined in the epic.
- [x] [Review][Defer] Inconsistent decimal scale in output (`"0"` vs `"1000.00"`) [blind+edge] [apps/api/src/lib/decimal.ts:70-72] — deferred; spec-mandated (`sum([]) === "0"`, AC-8 empty case, and the Task 6.1 test asserts `total_liabilities: "0"` next to `total_assets: "1000.00"`). Flagged as a cross-cutting consumer concern for a future normalization pass.
- [x] [Review][Defer] Leading-zero representation mismatch: `initial_balance "007.50"` yields `current_balance "7.50"` [apps/api/src/services/account.service.ts:102] — deferred; `decimalStringSchema` (Story 2.2) accepts leading zeros while `add(initial_balance,"0")` normalizes. Ties into the already-deferred 2.2 `initial_balance` bounds item.
- [x] [Review][Defer] `getTransactionDeltas` runs a `sqlite_master` probe whose result is discarded every `listAccounts` call [blind+edge] [apps/api/src/services/account.service.ts:40-55] — deferred; intentional forward-compat seam per AC-6/Dev Notes (spec sanctions an unconditional empty Map). Epic 3 makes the probe meaningful; minor wasted round-trip until then.
- [x] [Review][Defer] `toScaledBigInt` unguarded negative repeat count [apps/api/src/lib/decimal.ts:29] — deferred; unreachable today (callers use `Math.max`, `parse`/`toScaledBigInt` are private), latent defensive-hardening only.
- [x] [Review][Resolved] Added edge-case test coverage [apps/api/tests/unit/lib/decimal.test.ts, apps/api/tests/integration/accounts.test.ts] — resolved 2026-05-29. Added unit cases for scale-0 formatting, negative-zero at scale 0, negative/mixed-scale `compare` and `sum`, negative totals, and malformed-input rejections (`""`, `"-"`, `".5"`, `"+5"`, `"1e5"`, `"1.2.3"`, `"5."`). Added integration cases for the empty-account zeroed summary and a liabilities-exceed-assets negative net worth. All gates green (`check-types`, `lint`, 27 unit+integration tests pass).

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `bun run check-types` passed in `apps/api/`.
- `bun run lint` passed in `apps/api/`.
- `bun run test --run tests/unit/lib/decimal.test.ts` passed: 1 file, 5 tests.
- `bun run test --run tests/integration/accounts.test.ts` passed: 1 file, 17 tests.
- `bun run test --run` hit the known unrelated timeout in `tests/integration/auth.test.ts > auth routes > change password > changes password and allows login with the new password` after 463.99s; the remaining 10 files and 71 tests passed.

### Completion Notes List

- Added `apps/api/src/lib/decimal.ts` with BigInt-backed fixed-point `add`, `subtract`, `sum`, and `compare` helpers that preserve max operand scale and normalize negative zero.
- Extended the account list response schema to include per-item `current_balance` plus top-level `summary` totals and kept create/get/update responses on the existing plain `Account` shape.
- Rewrote `listAccounts` to derive balances in the service layer, reuse `classifyAccountType`, and tolerate the missing Epic 3 `transactions` table through the explicit `getTransactionDeltas` seam.
- Replaced the old scope-guard list assertion with balance/summary coverage and added decimal unit coverage plus net-worth and soft-delete summary assertions.

### File List

- `apps/api/src/lib/decimal.ts`
- `apps/api/src/schemas/account.schema.ts`
- `apps/api/src/services/account.service.ts`
- `apps/api/tests/unit/lib/decimal.test.ts`
- `apps/api/tests/integration/accounts.test.ts`

### Change Log

- 2026-05-29: Story 2.3 created by create-story workflow; status set to ready-for-dev
- 2026-05-29: Implemented string-decimal math, account balance derivation, account-list summary totals, and supporting tests; status set to done
