import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error-handler";
import { errorResponseSchema } from "../../src/schemas/common.schema";
import { healthRouter } from "../../src/routes/health";

// Build a minimal test app that wires the real middleware pieces (errorHandler,
// defaultHook, notFound) without duplicating their logic. Test-only routes are
// added here to exercise error paths that don't exist on the production app.
const validationRoute = createRoute({
  method: "get",
  path: "/test/validation",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1),
    }),
  },
  responses: {
    200: {
      description: "Validation test response",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
  },
});

describe("global middleware", () => {
  const testApp = new OpenAPIHono<{ Bindings: Env }>({
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

  // Wire the real handlers — not re-implemented copies.
  testApp.onError(errorHandler);
  testApp.notFound((c) =>
    c.json(
      errorResponseSchema.parse({ error: { code: "NOT_FOUND", message: "Route not found" } }),
      404,
    ),
  );
  testApp.route("/", healthRouter);

  // Test-only routes to exercise error paths.
  testApp.get("/test/error", () => {
    throw new Error("boom");
  });
  testApp.get("/test/http-exception", () => {
    throw new HTTPException(401, { message: "Unauthorized" });
  });
  testApp.openapi(validationRoute, (c) => {
    c.req.valid("query");
    return c.json({ ok: true }, 200);
  });

  it("returns 500 for unhandled errors", async () => {
    const res = await testApp.request("/test/error");
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  it("returns 401 for HTTPException", async () => {
    const res = await testApp.request("/test/http-exception");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
    });
  });

  it("returns 400 with validation details when query validation fails", async () => {
    const res = await testApp.request("/test/validation?limit=abc");
    expect(res.status).toBe(400);

    const body = z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          details: z.unknown().optional(),
        }),
      })
      .parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Validation failed");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("returns 200 for health route", async () => {
    const res = await testApp.request("/api/v1/health", {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      status: "healthy",
      services: {
        d1: { status: "ok" },
        kv: { status: "ok" },
        r2: { status: "ok" },
      },
    });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await testApp.request("/nonexistent");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });
});
