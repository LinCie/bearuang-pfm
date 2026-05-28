import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const serviceHealthSchema = z.object({
  status: z.enum(["ok", "error"]),
  message: z.string().optional(),
});

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  services: z.object({
    d1: serviceHealthSchema,
    kv: serviceHealthSchema,
    r2: serviceHealthSchema,
  }),
});

const healthRoute = createRoute({
  method: "get",
  path: "/api/v1/health",
  responses: {
    200: {
      description: "Health check response",
      content: {
        "application/json": {
          schema: healthResponseSchema,
        },
      },
    },
  },
});

export const healthRouter = new OpenAPIHono<{ Bindings: Env }>();

healthRouter.openapi(healthRoute, async (c) => {
  const services: {
    d1: { status: "ok" | "error"; message?: string };
    kv: { status: "ok" | "error"; message?: string };
    r2: { status: "ok" | "error"; message?: string };
  } = {
    d1: { status: "ok" },
    kv: { status: "ok" },
    r2: { status: "ok" },
  };

  // Demonstrate ctx.waitUntil() pattern for non-blocking post-response work.
  // The executionCtx getter throws when called outside a real Workers request
  // (e.g. testApp.request() in unit tests) — suppress only that specific case.
  try {
    c.executionCtx.waitUntil(Promise.resolve());
  } catch (err) {
    if (!(err instanceof Error && err.message === "This context has no ExecutionContext")) {
      throw err;
    }
  }

  try {
    const db = drizzle(c.env.DB);
    await db.run(sql`SELECT 1`);
  } catch {
    services.d1 = { status: "error", message: "D1 unreachable" };
  }

  try {
    await c.env.SESSIONS.get("__health_check__");
  } catch {
    services.kv = { status: "error", message: "KV unreachable" };
  }

  try {
    await c.env.RECEIPTS.head("__health_check__");
  } catch {
    services.r2 = { status: "error", message: "R2 unreachable" };
  }

  const status =
    services.d1.status === "ok" && services.kv.status === "ok" && services.r2.status === "ok"
      ? "healthy"
      : "degraded";

  return c.json({ status, services }, 200);
});
