import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { accounts, categories, recurringOccurrences, recurringTemplates } from "../db/schema";
import { ApiError } from "../lib/api-error";
import type {
  CreateRecurringInput,
  RecurringTemplate,
  RecurringTemplateWithNext,
  UpdateRecurringInput,
} from "../schemas/recurring.schema";

type TemplateRow = typeof recurringTemplates.$inferSelect;

const toTemplate = (row: TemplateRow): RecurringTemplate => ({
  ...row,
  type: row.type as RecurringTemplate["type"],
  frequency: row.frequency as RecurringTemplate["frequency"],
  is_active: row.is_active === 1,
});

export const computeNextDueDate = (
  startDate: string,
  frequency: string,
  endDate: string | null,
  processedDates: Set<string>,
): string | null => {
  const today = new Date().toISOString().slice(0, 10);
  let current = startDate;

  for (let i = 0; i < 1000; i++) {
    // ISO date strings (YYYY-MM-DD) compare lexicographically as expected
    if (endDate && current > endDate) return null;
    if (current >= today && !processedDates.has(current)) return current;
    current = advanceDate(current, frequency);
  }
  return null;
};

const advanceDate = (dateStr: string, frequency: string): string => {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];

  switch (frequency) {
    case "daily":
      return formatDate(new Date(y, m - 1, d + 1));
    case "weekly":
      return formatDate(new Date(y, m - 1, d + 7));
    case "biweekly":
      return formatDate(new Date(y, m - 1, d + 14));
    case "monthly": {
      const next = new Date(y, m, 1);
      next.setDate(Math.min(d, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      return formatDate(next);
    }
    case "yearly": {
      const ny = y + 1;
      const lastDayOfMonth = new Date(ny, m - 1 + 1, 0).getDate();
      return formatDate(new Date(ny, m - 1, Math.min(d, lastDayOfMonth)));
    }
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
};

const formatDate = (d: Date): string => {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const createTemplate = async (
  db: DrizzleD1Database,
  input: CreateRecurringInput,
  userId: string,
): Promise<RecurringTemplate> => {
  const accountRows = await db
    .select({ id: accounts.id, is_active: accounts.is_active })
    .from(accounts)
    .where(eq(accounts.id, input.account_id))
    .limit(1);

  if (!accountRows[0]) {
    throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account does not exist");
  }
  if (accountRows[0].is_active === 0) {
    throw new ApiError(400, "ACCOUNT_INACTIVE", "Cannot create recurring template for inactive account");
  }

  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, input.category_id))
    .limit(1);

  if (!categoryRows[0]) {
    throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category does not exist");
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row: typeof recurringTemplates.$inferInsert = {
    id,
    type: input.type,
    amount: input.amount,
    account_id: input.account_id,
    category_id: input.category_id,
    payee: input.payee ?? null,
    notes: input.notes ?? null,
    frequency: input.frequency,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    is_active: 1,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  };

  await db.insert(recurringTemplates).values(row);

  return toTemplate(row as TemplateRow);
};

export const listTemplates = async (
  db: DrizzleD1Database,
): Promise<{ items: RecurringTemplateWithNext[] }> => {
  const rows = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.is_active, 1));

  const occurrences = await db
    .select({ template_id: recurringOccurrences.template_id, due_date: recurringOccurrences.due_date })
    .from(recurringOccurrences)
    .where(inArray(recurringOccurrences.status, ["posted", "skipped"]));

  const processedMap = new Map<string, Set<string>>();
  for (const o of occurrences) {
    if (!processedMap.has(o.template_id)) processedMap.set(o.template_id, new Set());
    processedMap.get(o.template_id)?.add(o.due_date);
  }

  const items: RecurringTemplateWithNext[] = rows.map((row) => {
    const processed = processedMap.get(row.id) ?? new Set();
    const next_due_date = computeNextDueDate(row.start_date, row.frequency, row.end_date, processed);
    return { ...toTemplate(row), next_due_date };
  });

  return { items };
};

export const getTemplate = async (
  db: DrizzleD1Database,
  id: string,
): Promise<RecurringTemplate> => {
  const rows = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, id))
    .limit(1);

  if (!rows[0]) {
    throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Recurring template not found");
  }

  return toTemplate(rows[0]);
};

export const updateTemplate = async (
  db: DrizzleD1Database,
  id: string,
  input: UpdateRecurringInput,
  userId: string,
): Promise<RecurringTemplate> => {
  const existing = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, id))
    .limit(1);

  if (!existing[0]) {
    throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Recurring template not found");
  }

  if (input.category_id) {
    const catRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.category_id))
      .limit(1);
    if (!catRows[0]) {
      throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category does not exist");
    }
  }

  if (input.end_date && input.end_date < existing[0].start_date) {
    throw new ApiError(400, "INVALID_END_DATE", "end_date must be on or after start_date");
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_by: userId, updated_at: now };

  if (input.amount !== undefined) updates.amount = input.amount;
  if (input.category_id !== undefined) updates.category_id = input.category_id;
  if (input.frequency !== undefined) updates.frequency = input.frequency;
  if (input.end_date !== undefined) updates.end_date = input.end_date;
  if (input.payee !== undefined) updates.payee = input.payee;
  if (input.notes !== undefined) updates.notes = input.notes;

  await db.update(recurringTemplates).set(updates).where(eq(recurringTemplates.id, id));

  const updated = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, id))
    .limit(1);

  return toTemplate(updated[0] as TemplateRow);
};

export const deactivateTemplate = async (
  db: DrizzleD1Database,
  id: string,
  userId: string,
): Promise<void> => {
  const existing = await db
    .select({ id: recurringTemplates.id })
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, id))
    .limit(1);

  if (!existing[0]) {
    throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Recurring template not found");
  }

  const now = new Date().toISOString();
  await db
    .update(recurringTemplates)
    .set({ is_active: 0, updated_by: userId, updated_at: now })
    .where(eq(recurringTemplates.id, id));
};
