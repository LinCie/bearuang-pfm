import { asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { accounts } from "../db/schema";
import type { Account, AccountType } from "../schemas/account.schema";

const ASSET_TYPES = new Set<string>(["bank", "cash", "ewallet", "investment"]);

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
): Promise<{ items: Account[] }> => {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.is_active, 1))
    .orderBy(asc(accounts.created_at), asc(accounts.name), asc(accounts.id));

  return { items: rows.map(toAccount) };
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
