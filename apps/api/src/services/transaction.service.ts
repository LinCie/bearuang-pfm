import { and, eq, sql } from "drizzle-orm";
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
  if (input.type === "transfer") {
    throw new ApiError(501, "NOT_IMPLEMENTED", "Transfers are not yet supported");
  }

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
  const account = accountRows[0];

  if (!account) {
    throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found");
  }

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

  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const date = input.date ?? new Date().toISOString().slice(0, 10);

  try {
    await db.insert(transactions).values({
      id,
      type: input.type,
      amount: input.amount,
      account_id: input.account_id,
      destination_account_id: null,
      category_id: input.category_id,
      payee: input.payee ?? null,
      notes: input.notes ?? null,
      date,
      created_by: userId,
      updated_by: userId,
      is_deleted: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
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

  await db
    .update(categories)
    .set({
      usage_count: sql`${categories.usage_count} + 1`,
    })
    .where(eq(categories.id, input.category_id));

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
      continue;
    }

    if (row.type === "expense") {
      deltas.set(row.account_id, subtract(current, row.amount));
    }
  }

  return deltas;
};
