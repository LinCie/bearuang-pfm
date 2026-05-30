import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler";
import { accountsRouter } from "./routes/accounts";
import { authRouter } from "./routes/auth";
import { categoriesRouter } from "./routes/categories";
import { healthRouter } from "./routes/health";
import { setupRouter } from "./routes/setup";
import { settingsRouter } from "./routes/settings";
import { recurringRouter } from "./routes/recurring";
import { receiptsRouter } from "./routes/receipts";
import { transactionsRouter } from "./routes/transactions";
import { errorResponseSchema } from "./schemas/common.schema";

const app = new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>({
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

app.use(
  "*",
  cors({
    origin: (_origin: string, c: { env: { CORS_ORIGIN?: string } }) =>
      c.env.CORS_ORIGIN ?? "",
  }),
);
app.onError(errorHandler);
app.notFound((c) =>
  c.json(
    errorResponseSchema.parse({
      error: { code: "NOT_FOUND", message: "Route not found" },
    }),
    404,
  ),
);
app.route("/", healthRouter);
app.route("/", setupRouter);
app.route("/", authRouter);
app.route("/", settingsRouter);
app.route("/", categoriesRouter);
app.route("/", accountsRouter);
app.route("/", transactionsRouter);
app.route("/", recurringRouter);
app.route("/", receiptsRouter);

// Bearer session-token auth scheme, referenced by protected routes via `security: [{ Bearer: [] }]`.
app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
});

// OpenAPI 3.1 document (Zod v4 → 3.1 avoids 3.0 nullable/serialization quirks).
// Served at GET /doc; point a client generator (openapi-typescript, orval, etc.) at it.
app.doc31("/doc", {
  openapi: "3.1.0",
  info: {
    version: "1.0.0",
    title: "bearuang API",
    description:
      "Private, self-deployed personal finance API (Hono on Cloudflare Workers).",
  },
  servers: [{ url: "/", description: "Current origin" }],
});

// Scalar interactive API reference UI, rendered from the /doc spec.
app.get(
  "/scalar",
  Scalar({ url: "/doc", pageTitle: "bearuang API Reference", theme: "bluePlanet" }),
);

export default app;
