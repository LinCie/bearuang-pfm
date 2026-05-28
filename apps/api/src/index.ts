import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
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
    errorResponseSchema.parse({ error: { code: "NOT_FOUND", message: "Route not found" } }),
    404,
  ),
);
app.route("/", healthRouter);
app.route("/", authRouter);

export default app;
