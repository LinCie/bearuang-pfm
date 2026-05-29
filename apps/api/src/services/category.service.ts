import { asc, desc, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { categories } from "../db/schema";
import type { Category } from "../schemas/category.schema";

const EXPENSE_DEFAULTS = [
  "Food",
  "Transport",
  "Housing",
  "Utilities",
  "Entertainment",
  "Health",
  "Shopping",
  "Education",
  "Other",
] as const;

const INCOME_DEFAULTS = ["Salary", "Freelance", "Gift", "Refund", "Interest", "Other"] as const;

type CategoryType = "expense" | "income";

interface CreateCategoryInput {
  name: string;
  type: CategoryType;
}

interface UpdateCategoryInput {
  name: string;
}

interface CategoryFilter {
  type?: Category["type"];
}

export const createCategory = async (
  db: DrizzleD1Database,
  input: CreateCategoryInput,
  userId: string,
): Promise<Category> => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db.insert(categories).values({
      id,
      name: input.name,
      type: input.type,
      usage_count: 0,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) {
      throw new HTTPException(409, {
        message: "Category with this name and type already exists",
      });
    }
    throw err;
  }

  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  const category = rows[0] as Category | undefined;

  if (!category) {
    throw new HTTPException(500, { message: "Failed to load created category" });
  }

  return category;
};

export const listCategories = async (
  db: DrizzleD1Database,
  filter: CategoryFilter = {},
): Promise<{ items: Category[] }> => {
  const rows = filter.type
    ? await db
        .select()
        .from(categories)
        .where(eq(categories.type, filter.type))
        .orderBy(desc(categories.usage_count), asc(categories.name))
    : await db.select().from(categories).orderBy(desc(categories.usage_count), asc(categories.name));

  return { items: rows as Category[] };
};

export const updateCategory = async (
  db: DrizzleD1Database,
  id: string,
  input: UpdateCategoryInput,
  userId: string,
): Promise<Category> => {
  const existingRows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  const existing = existingRows[0] as Category | undefined;

  if (!existing) {
    throw new HTTPException(404, { message: "Category not found" });
  }

  const now = new Date().toISOString();

  try {
    await db
      .update(categories)
      .set({
        name: input.name,
        updated_by: userId,
        updated_at: now,
      })
      .where(eq(categories.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) {
      throw new HTTPException(409, {
        message: "Category with this name and type already exists",
      });
    }
    throw err;
  }

  const updatedRows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  const updated = updatedRows[0] as Category | undefined;

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to load updated category" });
  }

  return updated;
};

export const deleteCategory = async (db: DrizzleD1Database, id: string): Promise<void> => {
  const existingRows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  const existing = existingRows[0];

  if (!existing) {
    throw new HTTPException(404, { message: "Category not found" });
  }

  let inUseCount = 0;

  try {
    const rows = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM transactions WHERE category_id = ${id}`,
    );
    inUseCount = rows[0]?.count ?? 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("no such table")) {
      throw err;
    }
  }

  if (inUseCount > 0) {
    throw new HTTPException(409, { message: "Cannot delete category with existing transactions" });
  }

  await db.delete(categories).where(eq(categories.id, id));
};

export const seedCategories = async (
  db: DrizzleD1Database,
  userId: string,
): Promise<{ items: Category[] }> => {
  const now = new Date().toISOString();
  const expenseValues = EXPENSE_DEFAULTS.map((name) => ({
    id: crypto.randomUUID(),
    name,
    type: "expense" as const,
    usage_count: 0,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  }));
  const incomeValues = INCOME_DEFAULTS.map((name) => ({
    id: crypto.randomUUID(),
    name,
    type: "income" as const,
    usage_count: 0,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  }));

  await db.insert(categories).values(expenseValues).onConflictDoNothing({
    target: [categories.name, categories.type],
  });

  await db.insert(categories).values(incomeValues).onConflictDoNothing({
    target: [categories.name, categories.type],
  });

  return listCategories(db, {});
};
