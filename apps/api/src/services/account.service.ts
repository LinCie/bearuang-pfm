import { asc, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { accounts } from "../db/schema";
import { add, subtract, sum } from "../lib/decimal";
import { getAccountDeltas } from "./transaction.service";
import type {
  Account,
  AccountListResponse,
  AccountType,
  AccountWithBalance,
} from "../schemas/account.schema";

const ASSET_TYPES = new Set<string>(["bank", "cash", "ewallet", "investment"]);
const ZERO = "0";

interface CreateAccountInput {
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: string;
}

interface UpdateAccountInput {
  name?: string;
  type?: AccountType;
  currency?: string;
  is_active?: boolean;
}

const toAccount = (row: typeof accounts.$inferSelect): Account => ({
  ...row,
  type: row.type as Account["type"],
  is_active: row.is_active === 1,
});

export const classifyAccountType = (type: string): "asset" | "liability" =>
  ASSET_TYPES.has(type) ? "asset" : "liability";

// Forward-compatible seam for Epic 3. The `transactions` table does not exist
// until Story 3.1, so every account currently has a zero delta.
const getTransactionDeltas = async (
  db: DrizzleD1Database,
): Promise<Map<string, string>> => {
  const tables = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'`,
  );

  if (tables.length === 0) {
    return new Map();
  }

  return getAccountDeltas(db);
};

export const createAccount = async (
  db: DrizzleD1Database,
  input: CreateAccountInput,
  userId: string,
): Promise<Account> => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(accounts).values({
    id,
    name: input.name,
    type: input.type,
    currency: input.currency,
    initial_balance: input.initial_balance,
    is_active: 1,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  });

  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  const account = rows[0];

  if (!account) {
    throw new HTTPException(500, { message: "Failed to load created account" });
  }

  return toAccount(account);
};

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
  const total_assets = sum(
    items
      .filter((item) => classifyAccountType(item.type) === "asset")
      .map((item) => item.current_balance),
  );
  const total_liabilities = sum(
    items
      .filter((item) => classifyAccountType(item.type) === "liability")
      .map((item) => item.current_balance),
  );

  return {
    items,
    summary: {
      total_assets,
      total_liabilities,
      net_worth: subtract(total_assets, total_liabilities),
    },
  };
};

export const getAccount = async (db: DrizzleD1Database, id: string): Promise<Account> => {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  const account = rows[0];

  if (!account) {
    throw new HTTPException(404, { message: "Account not found" });
  }

  return toAccount(account);
};

export const updateAccount = async (
  db: DrizzleD1Database,
  id: string,
  input: UpdateAccountInput,
  userId: string,
): Promise<Account> => {
  const existingRows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  const existing = existingRows[0];

  if (!existing) {
    throw new HTTPException(404, { message: "Account not found" });
  }

  const now = new Date().toISOString();
  const updateFields: {
    name?: string;
    type?: AccountType;
    currency?: string;
    is_active?: number;
    updated_by: string;
    updated_at: string;
  } = {
    updated_by: userId,
    updated_at: now,
  };

  if (input.name !== undefined) {
    updateFields.name = input.name;
  }

  if (input.type !== undefined) {
    updateFields.type = input.type;
  }

  if (input.currency !== undefined) {
    updateFields.currency = input.currency;
  }

  if (input.is_active !== undefined) {
    updateFields.is_active = input.is_active ? 1 : 0;
  }

  await db.update(accounts).set(updateFields).where(eq(accounts.id, id));

  const updatedRows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  const account = updatedRows[0];

  if (!account) {
    throw new HTTPException(500, { message: "Failed to load updated account" });
  }

  return toAccount(account);
};

export const deleteAccount = async (
  db: DrizzleD1Database,
  id: string,
  userId: string,
): Promise<void> => {
  const existingRows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  const existing = existingRows[0];

  if (!existing) {
    throw new HTTPException(404, { message: "Account not found" });
  }

  await db
    .update(accounts)
    .set({
      is_active: 0,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .where(eq(accounts.id, id));
};
