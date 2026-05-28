import { z } from "@hono/zod-openapi";

export const loginRequestSchema = z.object({
  password: z.string().min(1),
});

export const loginResponseSchema = z.object({
  token: z.string(),
});

export const changePasswordRequestSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

export const changePasswordResponseSchema = z.object({
  message: z.string(),
});

export const sessionResponseSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  role: z.string(),
});
