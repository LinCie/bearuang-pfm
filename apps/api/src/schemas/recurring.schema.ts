import { z } from "zod";

export const frequencySchema = z.enum(["daily", "weekly", "biweekly", "monthly", "yearly"]);

const positiveAmountSchema = z
  .string()
  .trim()
  .max(30, "Must be at most 30 characters")
  .regex(/^\d+(\.\d+)?$/, "Must be a positive decimal string")
  .refine((value) => /[1-9]/.test(value), "Must be greater than zero");

export const createRecurringRequestSchema = z
  .object({
    type: z.enum(["expense", "income"]),
    amount: positiveAmountSchema,
    account_id: z.string().trim().min(1),
    category_id: z.string().trim().min(1),
    frequency: frequencySchema,
    start_date: z.iso.date(),
    end_date: z.iso.date().optional(),
    payee: z.string().trim().max(255).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(
    (data) => !data.end_date || data.end_date >= data.start_date,
    { message: "end_date must be on or after start_date", path: ["end_date"] },
  );

export const updateRecurringRequestSchema = z
  .object({
    amount: positiveAmountSchema.optional(),
    category_id: z.string().trim().min(1).optional(),
    frequency: frequencySchema.optional(),
    end_date: z.iso.date().nullable().optional(),
    payee: z.string().trim().max(255).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  });

export const recurringIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const recurringTemplateSchema = z.object({
  id: z.string(),
  type: z.enum(["expense", "income"]),
  amount: z.string(),
  account_id: z.string(),
  category_id: z.string(),
  payee: z.string().nullable(),
  notes: z.string().nullable(),
  frequency: frequencySchema,
  start_date: z.string(),
  end_date: z.string().nullable(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const recurringTemplateWithNextSchema = recurringTemplateSchema.extend({
  next_due_date: z.string().nullable(),
});

export const recurringListResponseSchema = z.object({
  items: z.array(recurringTemplateWithNextSchema),
});

export const upcomingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(52).default(12),
});

export const upcomingDaysQuerySchema = z.object({
  upcoming_days: z.coerce.number().int().min(1).max(365).optional(),
});

export const occurrenceParamsSchema = z.object({
  id: z.string().min(1),
  occId: z.string().min(1),
});

export const occurrenceResponseSchema = z.object({
  id: z.string(),
  template_id: z.string(),
  due_date: z.string(),
  status: z.enum(["pending", "posted", "skipped"]),
  transaction_id: z.string().nullable(),
});

export const upcomingResponseSchema = z.object({
  items: z.array(occurrenceResponseSchema),
});

export const upcomingWithTemplateSchema = occurrenceResponseSchema.extend({
  template_payee: z.string().nullable(),
  template_amount: z.string(),
  template_type: z.enum(["expense", "income"]),
  template_frequency: frequencySchema,
  account_id: z.string(),
});

export const upcomingAcrossResponseSchema = z.object({
  items: z.array(upcomingWithTemplateSchema),
});

export const confirmResponseSchema = z.object({
  occurrence: occurrenceResponseSchema,
  transaction: z.object({
    id: z.string(),
    type: z.enum(["expense", "income"]),
    amount: z.string(),
    account_id: z.string(),
    destination_account_id: z.string().nullable(),
    category_id: z.string().nullable(),
    payee: z.string().nullable(),
    notes: z.string().nullable(),
    date: z.string(),
    created_by: z.string(),
    updated_by: z.string(),
    is_deleted: z.boolean(),
    deleted_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
});

export type CreateRecurringInput = z.infer<typeof createRecurringRequestSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringRequestSchema>;
export type RecurringTemplate = z.infer<typeof recurringTemplateSchema>;
export type RecurringTemplateWithNext = z.infer<typeof recurringTemplateWithNextSchema>;
