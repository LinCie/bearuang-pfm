import { z } from "zod";

// Transaction amounts are always strictly positive — the debit/credit sign is
// derived from `type` (income adds, expense subtracts). Allowing a negative or
// zero amount would silently invert or no-op the balance, so reject them here.
const positiveAmountSchema = z
  .string()
  .trim()
  .max(30, "Must be at most 30 characters")
  .regex(/^\d+(\.\d+)?$/, "Must be a positive decimal string")
  .refine((value) => /[1-9]/.test(value), "Must be greater than zero");

export const transactionTypeSchema = z.enum(["expense", "income", "transfer"]);

export const transactionSchema = z.object({
  id: z.string(),
  type: transactionTypeSchema,
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
});

export const transactionDetailSchema = transactionSchema.extend({
  account_name: z.string(),
  category_name: z.string().nullable(),
});

export const createTransactionRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  type: transactionTypeSchema,
  amount: positiveAmountSchema,
  account_id: z.string().trim().min(1),
  category_id: z.string().trim().min(1).optional(),
  destination_account_id: z.string().trim().min(1).optional(),
  payee: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(1000).optional(),
  date: z.iso.date().optional(),
}).superRefine((data, ctx) => {
  if (data.type === "transfer" && !data.destination_account_id) {
    ctx.addIssue({
      code: "custom",
      path: ["destination_account_id"],
      message: "destination_account_id is required for transfers",
    });
  }
});

export const transactionIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateTransactionRequestSchema = z.object({
  type: transactionTypeSchema.optional(),
  amount: positiveAmountSchema.optional(),
  account_id: z.string().trim().min(1).optional(),
  destination_account_id: z.string().trim().min(1).optional(),
  category_id: z.string().trim().min(1).optional(),
  payee: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(1000).optional(),
  date: z.iso.date().optional(),
});

export const trashListSchema = z.object({
  items: z.array(transactionSchema),
});

export const purgeResponseSchema = z.object({
  purged_count: z.number(),
});

export const listTransactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional().default(50),
  start_date: z.string().date().optional(),
  end_date: z.string().date().optional(),
  account_id: z.string().min(1).optional(),
  category_id: z.string().min(1).optional(),
  min_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  max_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  q: z.string().min(1).max(100).optional(),
});

export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;
