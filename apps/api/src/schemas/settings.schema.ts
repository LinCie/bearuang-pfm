import { z } from "zod";

export const settingsItemSchema = z.object({
  key: z.string(),
  value: z.string(),
  updated_at: z.string(),
});

export const settingsListResponseSchema = z.object({
  items: z.array(settingsItemSchema),
});

export const updateSettingsRequestSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const updateSettingsResponseSchema = settingsItemSchema;
