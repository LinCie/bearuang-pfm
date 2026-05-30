import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  confirmResponseSchema,
  createRecurringRequestSchema,
  occurrenceParamsSchema,
  occurrenceResponseSchema,
  recurringIdParamsSchema,
  recurringListResponseSchema,
  recurringTemplateSchema,
  updateRecurringRequestSchema,
  upcomingQuerySchema,
  upcomingResponseSchema,
} from "../schemas/recurring.schema";
import {
  confirmOccurrence,
  createTemplate,
  deactivateTemplate,
  getTemplate,
  getUpcomingAcrossTemplates,
  getUpcomingOccurrences,
  listTemplates,
  skipOccurrence,
  updateTemplate,
} from "../services/recurring.service";

const createRecurringRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring",
  security: [{ Bearer: [] }],
  request: {
    body: { content: { "application/json": { schema: createRecurringRequestSchema } }, required: true },
  },
  responses: {
    201: { description: "Template created", content: { "application/json": { schema: recurringTemplateSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Referenced entity not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const listRecurringRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring",
  security: [{ Bearer: [] }],
  responses: {
    200: { description: "Active templates", content: { "application/json": { schema: recurringListResponseSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const getRecurringRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring/{id}",
  security: [{ Bearer: [] }],
  request: { params: recurringIdParamsSchema },
  responses: {
    200: { description: "Template detail", content: { "application/json": { schema: recurringTemplateSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const updateRecurringRoute = createRoute({
  method: "put",
  path: "/api/v1/recurring/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: recurringIdParamsSchema,
    body: { content: { "application/json": { schema: updateRecurringRequestSchema } }, required: true },
  },
  responses: {
    200: { description: "Template updated", content: { "application/json": { schema: recurringTemplateSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const deleteRecurringRoute = createRoute({
  method: "delete",
  path: "/api/v1/recurring/{id}",
  security: [{ Bearer: [] }],
  request: { params: recurringIdParamsSchema },
  responses: {
    204: { description: "Template deactivated" },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const upcomingRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring/{id}/upcoming",
  security: [{ Bearer: [] }],
  request: {
    params: recurringIdParamsSchema,
    query: upcomingQuerySchema,
  },
  responses: {
    200: { description: "Upcoming occurrences", content: { "application/json": { schema: upcomingResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const confirmOccurrenceRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring/{id}/occurrences/{occId}/confirm",
  security: [{ Bearer: [] }],
  request: { params: occurrenceParamsSchema },
  responses: {
    200: { description: "Occurrence confirmed", content: { "application/json": { schema: confirmResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
    409: { description: "Already processed", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const skipOccurrenceRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring/{id}/occurrences/{occId}/skip",
  security: [{ Bearer: [] }],
  request: { params: occurrenceParamsSchema },
  responses: {
    200: { description: "Occurrence skipped", content: { "application/json": { schema: occurrenceResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } },
    409: { description: "Already processed", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

export const recurringRouter = new OpenAPIHono<{
  Bindings: Env;
  Variables: { userId: string };
}>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const parsed = errorResponseSchema.safeParse({
        error: { code: "VALIDATION_ERROR", message: "Validation failed", details: result.error.issues },
      });
      const errorBody = parsed.success
        ? parsed.data
        : { error: { code: "VALIDATION_ERROR", message: "Validation failed" } };
      return c.json(errorBody, 400);
    }
  },
});

recurringRouter.use("/api/v1/recurring", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id/upcoming", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id/occurrences/:occId/confirm", authMiddleware);
recurringRouter.use("/api/v1/recurring/:id/occurrences/:occId/skip", authMiddleware);

recurringRouter.openapi(createRecurringRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const input = c.req.valid("json");
  const template = await createTemplate(db, input, userId);
  return c.json(template, 201);
});

recurringRouter.openapi(listRecurringRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const url = new URL(c.req.url);
  const upcomingDays = url.searchParams.get("upcoming_days");
  if (upcomingDays) {
    const days = Number(upcomingDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "upcoming_days must be an integer between 1 and 365" } }, 400);
    }
    const result = await getUpcomingAcrossTemplates(db, days);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(result as any, 200);
  }
  const result = await listTemplates(db);
  return c.json(result, 200);
});

recurringRouter.openapi(getRecurringRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id } = c.req.valid("param");
  const template = await getTemplate(db, id);
  return c.json(template, 200);
});

recurringRouter.openapi(updateRecurringRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const input = c.req.valid("json");
  const template = await updateTemplate(db, id, input, userId);
  return c.json(template, 200);
});

recurringRouter.openapi(deleteRecurringRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  await deactivateTemplate(db, id, userId);
  return c.body(null, 204);
});

recurringRouter.openapi(upcomingRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id } = c.req.valid("param");
  const { limit } = c.req.valid("query");
  const result = await getUpcomingOccurrences(db, id, limit);
  return c.json(result, 200);
});

recurringRouter.openapi(confirmOccurrenceRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id, occId } = c.req.valid("param");
  const result = await confirmOccurrence(db, id, occId, userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return c.json(result as any, 200);
});

recurringRouter.openapi(skipOccurrenceRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id, occId } = c.req.valid("param");
  const result = await skipOccurrence(db, id, occId, userId);
  return c.json(result, 200);
});
