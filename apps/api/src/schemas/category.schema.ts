import { z } from "zod";

export const categoryTypeSchema = z.enum(["expense", "income"]);

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: categoryTypeSchema,
  usage_count: z.number().int().nonnegative(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: categoryTypeSchema,
});

export const updateCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const listCategoriesQuerySchema = z.object({
  type: categoryTypeSchema.optional(),
});

export const categoryListResponseSchema = z.object({
  items: z.array(categorySchema),
});

export const categoryIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type CategoryType = z.infer<typeof categoryTypeSchema>;
export type Category = z.infer<typeof categorySchema>;
