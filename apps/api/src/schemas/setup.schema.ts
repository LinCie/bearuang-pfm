import { z } from "zod";

export const setupStatusResponseSchema = z.object({
  is_setup_complete: z.boolean(),
});

export const setupInitializeRequestSchema = z.object({
  display_name: z.string().min(1).max(100),
  base_currency: z.string().min(1).max(10),
  seed_categories: z.boolean(),
});

export const setupInitializeResponseSchema = z.object({
  message: z.string(),
});
