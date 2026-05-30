import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { settings } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  settingsListResponseSchema,
  updateSettingsRequestSchema,
  updateSettingsResponseSchema,
} from "../schemas/settings.schema";

const getSettingsRoute = createRoute({
  method: "get",
  path: "/api/v1/settings",
  responses: {
    200: {
      description: "Settings list",
      content: {
        "application/json": {
          schema: settingsListResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const updateSettingsRoute = createRoute({
  method: "put",
  path: "/api/v1/settings",
  request: {
    body: {
      content: {
        "application/json": {
          schema: updateSettingsRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated setting",
      content: {
        "application/json": {
          schema: updateSettingsResponseSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

export const settingsRouter = new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const parsed = errorResponseSchema.safeParse({
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: result.error.issues,
        },
      });

      const errorBody = parsed.success
        ? parsed.data
        : { error: { code: "VALIDATION_ERROR", message: "Validation failed" } };

      return c.json(errorBody, 400);
    }
  },
});

settingsRouter.use("/api/v1/settings", authMiddleware);

settingsRouter.openapi(getSettingsRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(settings);

  return c.json({ items: rows }, 200);
});

settingsRouter.openapi(updateSettingsRoute, async (c) => {
  const { key, value } = c.req.valid("json");
  const db = drizzle(c.env.DB);
  const now = new Date().toISOString();

  await db
    .insert(settings)
    .values({ key, value, updated_at: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updated_at: now } });

  const updatedRows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

  return c.json(updatedRows[0], 200);
});
