import { z } from "zod";

export const accountTypeSchema = z.enum([
  "bank",
  "cash",
  "ewallet",
  "credit_card",
  "loan",
  "investment",
]);

const decimalStringSchema = z
  .string()
  .trim()
  .max(30, "Must be at most 30 characters")
  .regex(/^-?\d+(\.\d+)?$/, "Must be a valid decimal string");

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  currency: z.string(),
  initial_balance: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createAccountRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: accountTypeSchema,
  currency: z.string().trim().min(1).max(10),
  initial_balance: decimalStringSchema.default("0"),
});

export const updateAccountRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: accountTypeSchema.optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  is_active: z.boolean().optional(),
});

export const accountWithBalanceSchema = accountSchema.extend({
  current_balance: z.string(),
});

export const accountSummarySchema = z.object({
  total_assets: z.string(),
  total_liabilities: z.string(),
  net_worth: z.string(),
});

export const accountListResponseSchema = z.object({
  items: z.array(accountWithBalanceSchema),
  summary: accountSummarySchema,
});

export const accountIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type AccountType = z.infer<typeof accountTypeSchema>;
export type Account = z.infer<typeof accountSchema>;
export type AccountWithBalance = z.infer<typeof accountWithBalanceSchema>;
export type AccountListResponse = z.infer<typeof accountListResponseSchema>;
