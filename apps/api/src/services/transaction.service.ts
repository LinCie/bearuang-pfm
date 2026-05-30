import { and, eq, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { accounts, categories, transactions } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { add, subtract } from "../lib/decimal";
import type {
  Transaction,
  TransactionDetail,
  TransactionType,
} from "../schemas/transaction.schema";

interface CreateTransactionInput {
  id?: string;
  type: TransactionType;
  amount: string;
  account_id: string;
  category_id?: string;
  destination_account_id?: string;
  payee?: string;
  notes?: string;
  date?: string;
}

interface CreateTransactionResult {
  transaction: Transaction;
  replayed: boolean;
}

type TransactionRow = typeof transactions.$inferSelect;

const toTransaction = (row: TransactionRow): Transaction => ({
  ...row,
  type: row.type as Transaction["type"],
  is_deleted: row.is_deleted === 1,
});

const findTransactionRow = async (
  db: DrizzleD1Database,
  id: string,
): Promise<TransactionRow | undefined> => {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0];
};

export const createTransaction = async (
  db: DrizzleD1Database,
  input: CreateTransactionInput,
  userId: string,
): Promise<CreateTransactionResult> => {
  if (input.id) {
    const existing = await findTransactionRow(db, input.id);
    if (existing) {
      return { transaction: toTransaction(existing), replayed: true };
    }
  }

  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, input.account_id), eq(accounts.is_active, 1)))
    .limit(1);

  if (!accountRows[0]) {
    throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found");
  }

  if (input.type === "transfer") {
    if (input.account_id === input.destination_account_id) {
      throw new ApiError(400, "TRANSFER_SAME_ACCOUNT", "Source and destination accounts must be different");
    }

    const destRows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, input.destination_account_id ?? ""), eq(accounts.is_active, 1)))
      .limit(1);

    if (!destRows[0]) {
      throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Destination account not found");
    }
  }

  if (input.type !== "transfer") {
    if (!input.category_id) {
      throw new ApiError(
        400,
        "CATEGORY_REQUIRED",
        "category_id is required for expense and income transactions",
      );
    }

    const categoryRows = await db
      .select({ id: categories.id, type: categories.type })
      .from(categories)
      .where(eq(categories.id, input.category_id))
      .limit(1);
    const category = categoryRows[0];

    if (!category) {
      throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found");
    }

    if (category.type !== input.type) {
      throw new ApiError(
        400,
        "CATEGORY_TYPE_MISMATCH",
        `Category type "${category.type}" does not match transaction type "${input.type}"`,
      );
    }
  }

  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const date = input.date ?? new Date().toISOString().slice(0, 10);

  try {
    await db.batch([
      db.insert(transactions).values({
        id,
        type: input.type,
        amount: input.amount,
        account_id: input.account_id,
        destination_account_id: input.type === "transfer" ? (input.destination_account_id ?? null) : null,
        category_id: input.type === "transfer" ? null : (input.category_id ?? null),
        payee: input.payee ?? null,
        notes: input.notes ?? null,
        date,
        created_by: userId,
        updated_by: userId,
        is_deleted: 0,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) {
      const existing = await findTransactionRow(db, id);
      if (existing) {
        return { transaction: toTransaction(existing), replayed: true };
      }
    }
    throw err;
  }

  if (input.type !== "transfer" && input.category_id) {
    await db
      .update(categories)
      .set({
        usage_count: sql`${categories.usage_count} + 1`,
      })
      .where(eq(categories.id, input.category_id));
  }

  const created = await findTransactionRow(db, id);

  if (!created) {
    throw new HTTPException(500, { message: "Failed to load created transaction" });
  }

  return { transaction: toTransaction(created), replayed: false };
};

export const getTransaction = async (
  db: DrizzleD1Database,
  id: string,
): Promise<TransactionDetail> => {
  const transaction = await findTransactionRow(db, id);

  if (!transaction) {
    throw new ApiError(404, "NOT_FOUND", "Transaction not found");
  }

  const accountRows = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, transaction.account_id))
    .limit(1);
  const account = accountRows[0];

  if (!account) {
    throw new HTTPException(500, { message: "Failed to load transaction account" });
  }

  let categoryName: string | null = null;

  if (transaction.category_id) {
    const categoryRows = await db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.id, transaction.category_id))
      .limit(1);
    categoryName = categoryRows[0]?.name ?? null;
  }

  return {
    ...toTransaction(transaction),
    account_name: account.name,
    category_name: categoryName,
  };
};

export const getAccountDeltas = async (
  db: DrizzleD1Database,
): Promise<Map<string, string>> => {
  const rows = await db
    .select({
      account_id: transactions.account_id,
      destination_account_id: transactions.destination_account_id,
      type: transactions.type,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(eq(transactions.is_deleted, 0));

  const deltas = new Map<string, string>();

  for (const row of rows) {
    const current = deltas.get(row.account_id) ?? "0";

    if (row.type === "income") {
      deltas.set(row.account_id, add(current, row.amount));
    } else if (row.type === "expense") {
      deltas.set(row.account_id, subtract(current, row.amount));
    } else if (row.type === "transfer") {
      deltas.set(row.account_id, subtract(current, row.amount));
      if (row.destination_account_id) {
        const destCurrent = deltas.get(row.destination_account_id) ?? "0";
        deltas.set(row.destination_account_id, add(destCurrent, row.amount));
      }
    }
  }

  return deltas;
};

interface UpdateTransactionInput {
  type?: string;
  amount?: string;
  account_id?: string;
  destination_account_id?: string;
  category_id?: string;
  payee?: string;
  notes?: string;
  date?: string;
}

export const updateTransaction = async (
  db: DrizzleD1Database,
  id: string,
  input: UpdateTransactionInput,
  userId: string,
): Promise<Transaction> => {
  const row = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.is_deleted, 0)))
    .limit(1);
  const existing = row[0];

  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Transaction not found");
  }

  if (input.type && input.type !== existing.type) {
    throw new ApiError(400, "TYPE_CHANGE_NOT_ALLOWED", "Cannot change transaction type. Delete and recreate instead.");
  }

  const now = new Date().toISOString();
  const updateObj: Record<string, unknown> = { updated_by: userId, updated_at: now };

  if (existing.type === "transfer") {
    if (input.account_id && input.account_id !== existing.account_id) {
      throw new ApiError(400, "TRANSFER_ACCOUNTS_IMMUTABLE", "Cannot change accounts on a transfer. Delete and recreate instead.");
    }
    if (input.destination_account_id && input.destination_account_id !== existing.destination_account_id) {
      throw new ApiError(400, "TRANSFER_ACCOUNTS_IMMUTABLE", "Cannot change accounts on a transfer. Delete and recreate instead.");
    }
    if (input.amount !== undefined) updateObj.amount = input.amount;
    if (input.notes !== undefined) updateObj.notes = input.notes;
    if (input.date !== undefined) updateObj.date = input.date;
  } else {
    if (input.category_id && input.category_id !== existing.category_id) {
      const categoryRows = await db
        .select({ id: categories.id, type: categories.type })
        .from(categories)
        .where(eq(categories.id, input.category_id))
        .limit(1);
      const category = categoryRows[0];

      if (!category) {
        throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found");
      }
      if (category.type !== existing.type) {
        throw new ApiError(400, "CATEGORY_TYPE_MISMATCH", `Category type "${category.type}" does not match transaction type "${existing.type}"`);
      }

      if (existing.category_id) {
        await db.update(categories).set({ usage_count: sql`MAX(${categories.usage_count} - 1, 0)` }).where(eq(categories.id, existing.category_id));
      }
      await db.update(categories).set({ usage_count: sql`${categories.usage_count} + 1` }).where(eq(categories.id, input.category_id));
    }

    if (input.amount !== undefined) updateObj.amount = input.amount;
    if (input.category_id !== undefined) updateObj.category_id = input.category_id;
    if (input.payee !== undefined) updateObj.payee = input.payee;
    if (input.notes !== undefined) updateObj.notes = input.notes;
    if (input.date !== undefined) updateObj.date = input.date;
  }

  await db.update(transactions).set(updateObj).where(eq(transactions.id, id));

  const updated = await findTransactionRow(db, id);
  if (!updated) {
    throw new HTTPException(500, { message: "Failed to load updated transaction" });
  }

  return toTransaction(updated);
};

export const softDeleteTransaction = async (
  db: DrizzleD1Database,
  id: string,
  userId: string,
): Promise<void> => {
  const row = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.is_deleted, 0)))
    .limit(1);

  if (!row[0]) {
    throw new ApiError(404, "NOT_FOUND", "Transaction not found");
  }

  const now = new Date().toISOString();
  await db.update(transactions).set({
    is_deleted: 1,
    deleted_at: now,
    updated_by: userId,
    updated_at: now,
  }).where(eq(transactions.id, id));
};

export const listTrash = async (
  db: DrizzleD1Database,
): Promise<Transaction[]> => {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.is_deleted, 1))
    .orderBy(sql`${transactions.deleted_at} DESC`);

  return rows.map(toTransaction);
};

export const restoreTransaction = async (
  db: DrizzleD1Database,
  id: string,
  userId: string,
): Promise<Transaction> => {
  const row = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.is_deleted, 1)))
    .limit(1);

  if (!row[0]) {
    throw new ApiError(404, "NOT_FOUND", "Transaction not found");
  }

  const acct = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, row[0].account_id), eq(accounts.is_active, 1)))
    .limit(1);

  if (!acct[0]) {
    throw new ApiError(409, "ACCOUNT_INACTIVE", "Cannot restore: source account is inactive");
  }

  if (row[0].destination_account_id) {
    const destAcct = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, row[0].destination_account_id), eq(accounts.is_active, 1)))
      .limit(1);

    if (!destAcct[0]) {
      throw new ApiError(409, "ACCOUNT_INACTIVE", "Cannot restore: destination account is inactive");
    }
  }

  const now = new Date().toISOString();
  await db.update(transactions).set({
    is_deleted: 0,
    deleted_at: null,
    updated_at: now,
    updated_by: userId,
  }).where(eq(transactions.id, id));

  const restored = await findTransactionRow(db, id);
  if (!restored) {
    throw new HTTPException(500, { message: "Failed to load restored transaction" });
  }

  return toTransaction(restored);
};

export const purgeTrash = async (
  db: DrizzleD1Database,
): Promise<number> => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(and(eq(transactions.is_deleted, 1), lt(transactions.deleted_at, cutoff)));
  const purgedCount = countResult[0]?.count ?? 0;

  if (purgedCount > 0) {
    await db.delete(transactions).where(
      and(eq(transactions.is_deleted, 1), lt(transactions.deleted_at, cutoff)),
    );
  }

  return purgedCount;
};
