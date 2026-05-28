import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { settings } from "../db/schema";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  setupInitializeRequestSchema,
  setupInitializeResponseSchema,
  setupStatusResponseSchema,
} from "../schemas/setup.schema";

const setupStatusRoute = createRoute({
  method: "get",
  path: "/api/v1/setup/status",
  responses: {
    200: {
      description: "Setup status",
      content: {
        "application/json": {
          schema: setupStatusResponseSchema,
        },
      },
    },
  },
});

const setupInitializeRoute = createRoute({
  method: "post",
  path: "/api/v1/setup/initialize",
  request: {
    body: {
      content: {
        "application/json": {
          schema: setupInitializeRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Setup complete",
      content: {
        "application/json": {
          schema: setupInitializeResponseSchema,
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
    409: {
      description: "Setup already completed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const upsertSetting = async (
  db: ReturnType<typeof drizzle>,
  key: string,
  value: string,
  updatedAt: string,
) => {
  await db
    .insert(settings)
    .values({ key, value, updated_at: updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updated_at: updatedAt } });
};

export const setupRouter = new OpenAPIHono<{ Bindings: Env }>();

setupRouter.openapi(setupStatusRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "setup_complete"))
    .limit(1);

  return c.json({ is_setup_complete: rows[0]?.value === "true" }, 200);
});

setupRouter.openapi(setupInitializeRoute, async (c) => {
  const { display_name: displayName, base_currency: baseCurrency, seed_categories: seedCategories } =
    c.req.valid("json");
  const db = drizzle(c.env.DB);
  const current = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "setup_complete"))
    .limit(1);

  if (current[0]?.value === "true") {
    throw new HTTPException(409, { message: "Setup has already been completed" });
  }

  const updatedAt = new Date().toISOString();

  await upsertSetting(db, "display_name", displayName, updatedAt);
  await upsertSetting(db, "base_currency", baseCurrency, updatedAt);
  await upsertSetting(db, "seed_categories_on_first_use", String(seedCategories), updatedAt);
  await upsertSetting(db, "setup_complete", "true", updatedAt);

  return c.json({ message: "Setup complete" }, 200);
});
