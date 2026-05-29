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

export const accountListResponseSchema = z.object({
  items: z.array(accountSchema),
});

export const accountIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type AccountType = z.infer<typeof accountTypeSchema>;
export type Account = z.infer<typeof accountSchema>;
