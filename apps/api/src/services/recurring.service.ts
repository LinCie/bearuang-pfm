import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { accounts, categories, recurringOccurrences, recurringTemplates } from "../db/schema";
import { ApiError } from "../lib/api-error";
import type {
  CreateRecurringInput,
  RecurringTemplate,
  RecurringTemplateWithNext,
  UpdateRecurringInput,
} from "../schemas/recurring.schema";
import { createTransaction } from "./transaction.service";

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

export const advanceDate = (dateStr: string, frequency: string): string => {
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

export const generateOccurrenceDates = (
  startDate: string,
  frequency: string,
  endDate: string | null,
  limit: number,
): string[] => {
  const dates: string[] = [];
  let current = startDate;
  for (let i = 0; i < limit; i++) {
    if (endDate && current > endDate) break;
    dates.push(current);
    current = advanceDate(current, frequency);
  }
  return dates;
};

type OccurrenceStatus = "pending" | "posted" | "skipped";

interface OccurrenceItem {
  id: string;
  template_id: string;
  due_date: string;
  status: OccurrenceStatus;
  transaction_id: string | null;
}

export const getUpcomingOccurrences = async (
  db: DrizzleD1Database,
  templateId: string,
  limit: number,
): Promise<{ items: OccurrenceItem[] }> => {
  const rows = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, templateId))
    .limit(1);

  if (!rows[0]) {
    throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Recurring template not found");
  }

  const template = rows[0];
  const dates = generateOccurrenceDates(template.start_date, template.frequency, template.end_date, limit);

  const existingOccurrences = await db
    .select()
    .from(recurringOccurrences)
    .where(eq(recurringOccurrences.template_id, templateId));

  const occByDate = new Map<string, typeof existingOccurrences[number]>();
  for (const occ of existingOccurrences) {
    occByDate.set(occ.due_date, occ);
  }

  const items: OccurrenceItem[] = dates.map((date) => {
    const existing = occByDate.get(date);
    if (existing) {
      return {
        id: existing.id,
        template_id: existing.template_id,
        due_date: existing.due_date,
        status: existing.status as OccurrenceStatus,
        transaction_id: existing.transaction_id,
      };
    }
    return {
      id: date,
      template_id: templateId,
      due_date: date,
      status: "pending" as const,
      transaction_id: null,
    };
  });

  return { items };
};

interface UpcomingWithTemplate extends OccurrenceItem {
  template_payee: string | null;
  template_amount: string;
  template_type: "expense" | "income";
  template_frequency: string;
  account_id: string;
}

const skipToNearDate = (startDate: string, frequency: string, targetDate: string): string => {
  let current = startDate;
  if (frequency === "daily") {
    const start = new Date(startDate);
    const target = new Date(targetDate);
    const diffDays = Math.floor((target.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > 1) {
      current = formatDate(new Date(start.getTime() + (diffDays - 1) * 24 * 60 * 60 * 1000));
    }
  } else if (frequency === "weekly") {
    const start = new Date(startDate);
    const target = new Date(targetDate);
    const diffWeeks = Math.floor((target.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks > 1) {
      current = formatDate(new Date(start.getTime() + (diffWeeks - 1) * 7 * 24 * 60 * 60 * 1000));
    }
  } else if (frequency === "biweekly") {
    const start = new Date(startDate);
    const target = new Date(targetDate);
    const diffPeriods = Math.floor((target.getTime() - start.getTime()) / (14 * 24 * 60 * 60 * 1000));
    if (diffPeriods > 1) {
      current = formatDate(new Date(start.getTime() + (diffPeriods - 1) * 14 * 24 * 60 * 60 * 1000));
    }
  } else if (frequency === "monthly") {
    const [sy, sm] = startDate.split("-").map(Number) as [number, number];
    const [ty, tm] = targetDate.split("-").map(Number) as [number, number];
    const diffMonths = (ty - sy) * 12 + (tm - sm);
    if (diffMonths > 1) {
      let cur = startDate;
      for (let i = 0; i < diffMonths - 1; i++) cur = advanceDate(cur, "monthly");
      current = cur;
    }
  } else if (frequency === "yearly") {
    const sy = Number(startDate.split("-")[0]);
    const ty = Number(targetDate.split("-")[0]);
    if (ty - sy > 1) {
      let cur = startDate;
      for (let i = 0; i < ty - sy - 1; i++) cur = advanceDate(cur, "yearly");
      current = cur;
    }
  }
  return current;
};

export const getUpcomingAcrossTemplates = async (
  db: DrizzleD1Database,
  days: number,
): Promise<{ items: UpcomingWithTemplate[] }> => {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = formatDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

  const templates = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.is_active, 1));

  if (templates.length === 0) return { items: [] };

  const allOccurrences = await db
    .select()
    .from(recurringOccurrences)
    .where(inArray(recurringOccurrences.template_id, templates.map((t) => t.id)));

  const occByTemplateDate = new Map<string, typeof allOccurrences[number]>();
  for (const occ of allOccurrences) {
    occByTemplateDate.set(`${occ.template_id}:${occ.due_date}`, occ);
  }

  const items: UpcomingWithTemplate[] = [];

  for (const template of templates) {
    const start = template.start_date < today
      ? skipToNearDate(template.start_date, template.frequency, today)
      : template.start_date;
    const dates = generateOccurrenceDates(start, template.frequency, template.end_date, days + 1);
    for (const date of dates) {
      if (date < today) continue;
      if (date > cutoff) break;
      const existing = occByTemplateDate.get(`${template.id}:${date}`);
      items.push({
        id: existing ? existing.id : date,
        template_id: template.id,
        due_date: date,
        status: existing ? (existing.status as OccurrenceStatus) : "pending",
        transaction_id: existing ? existing.transaction_id : null,
        template_payee: template.payee,
        template_amount: template.amount,
        template_type: template.type as "expense" | "income",
        template_frequency: template.frequency,
        account_id: template.account_id,
      });
    }
  }

  items.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  return { items };
};

const isDateOnSchedule = (date: string, startDate: string, frequency: string, endDate: string | null): boolean => {
  if (endDate && date > endDate) return false;
  if (date < startDate) return false;
  let current = startDate;
  // For efficiency, skip forward close to the target date
  current = skipToNearDate(startDate, frequency, date);
  for (let i = 0; i < 400; i++) {
    if (current === date) return true;
    if (current > date) return false;
    current = advanceDate(current, frequency);
  }
  return false;
};

const resolveOccurrence = async (
  db: DrizzleD1Database,
  templateId: string,
  occId: string,
  template: { start_date: string; frequency: string; end_date: string | null },
): Promise<typeof recurringOccurrences.$inferSelect> => {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(occId);
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(occId);

  if (isUUID) {
    const occRows = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.id, occId))
      .limit(1);
    const occ = occRows[0];
    if (!occ) {
      throw new ApiError(404, "OCCURRENCE_NOT_FOUND", "Occurrence not found");
    }
    if (occ.template_id !== templateId) {
      throw new ApiError(404, "OCCURRENCE_NOT_FOUND", "Occurrence not found");
    }
    return occ;
  }

  if (isDate) {
    if (!isDateOnSchedule(occId, template.start_date, template.frequency, template.end_date)) {
      throw new ApiError(404, "OCCURRENCE_NOT_FOUND", "Date is not a valid occurrence for this template");
    }

    const occRows = await db
      .select()
      .from(recurringOccurrences)
      .where(and(eq(recurringOccurrences.template_id, templateId), eq(recurringOccurrences.due_date, occId)));
    if (occRows[0]) return occRows[0];

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(recurringOccurrences).values({
      id: newId,
      template_id: templateId,
      due_date: occId,
      status: "pending",
      transaction_id: null,
      created_at: now,
    });
    const inserted = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.id, newId)).limit(1);
    if (!inserted[0]) throw new ApiError(500, "INTERNAL_ERROR", "Failed to create occurrence");
    return inserted[0];
  }

  throw new ApiError(404, "OCCURRENCE_NOT_FOUND", "Occurrence not found");
};

export const confirmOccurrence = async (
  db: DrizzleD1Database,
  templateId: string,
  occId: string,
  userId: string,
): Promise<{ occurrence: OccurrenceItem; transaction: { id: string; type: string; amount: string; account_id: string; destination_account_id: string | null; category_id: string | null; payee: string | null; notes: string | null; date: string; created_by: string; updated_by: string; is_deleted: boolean; deleted_at: string | null; created_at: string; updated_at: string } }> => {
  const templateRows = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, templateId))
    .limit(1);

  if (!templateRows[0]) {
    throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Recurring template not found");
  }

  const template = templateRows[0];
  const occurrence = await resolveOccurrence(db, templateId, occId, template);

  if (occurrence.status !== "pending") {
    throw new ApiError(409, "OCCURRENCE_ALREADY_PROCESSED", "This occurrence has already been processed");
  }

  const { transaction } = await createTransaction(db, {
    type: template.type as "expense" | "income",
    amount: template.amount,
    account_id: template.account_id,
    category_id: template.category_id,
    payee: template.payee ?? undefined,
    notes: template.notes ?? undefined,
    date: occurrence.due_date,
  }, userId);

  await db
    .update(recurringOccurrences)
    .set({ status: "posted", transaction_id: transaction.id })
    .where(eq(recurringOccurrences.id, occurrence.id));

  return {
    occurrence: {
      id: occurrence.id,
      template_id: occurrence.template_id,
      due_date: occurrence.due_date,
      status: "posted" as const,
      transaction_id: transaction.id,
    },
    transaction,
  };
};

export const skipOccurrence = async (
  db: DrizzleD1Database,
  templateId: string,
  occId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userId: string,
): Promise<OccurrenceItem> => {
  const templateRows = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, templateId))
    .limit(1);

  if (!templateRows[0]) {
    throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Recurring template not found");
  }

  const occurrence = await resolveOccurrence(db, templateId, occId, templateRows[0]);

  if (occurrence.status !== "pending") {
    throw new ApiError(409, "OCCURRENCE_ALREADY_PROCESSED", "This occurrence has already been processed");
  }

  await db
    .update(recurringOccurrences)
    .set({ status: "skipped" })
    .where(eq(recurringOccurrences.id, occurrence.id));

  return {
    id: occurrence.id,
    template_id: occurrence.template_id,
    due_date: occurrence.due_date,
    status: "skipped" as const,
    transaction_id: null,
  };
};
