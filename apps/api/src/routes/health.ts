import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const healthRoute = createRoute({
  method: "get",
  path: "/api/v1/health",
  responses: {
    200: {
      description: "Health check response",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
          }),
        },
      },
    },
  },
});

export const healthRouter = new OpenAPIHono<{ Bindings: Env }>();

healthRouter.openapi(healthRoute, (c) => {
  // Demonstrate ctx.waitUntil() pattern for non-blocking post-response work.
  // The executionCtx getter throws when called outside a real Workers request
  // (e.g. testApp.request() in unit tests) — suppress that specific case.
  try {
    c.executionCtx.waitUntil(Promise.resolve());
  } catch {
    // No ExecutionContext available (test environment).
  }

  return c.json({ status: "ok" }, 200);
});
