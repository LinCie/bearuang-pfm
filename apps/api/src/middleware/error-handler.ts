import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { errorResponseSchema } from "../schemas/common.schema";

const deriveCode = (status: number): string => {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 410:
      return "GONE";
    case 422:
      return "UNPROCESSABLE_ENTITY";
    case 429:
      return "RATE_LIMITED";
    default:
      // 5xx and any unmapped codes → INTERNAL_ERROR; other 4xx → CLIENT_ERROR
      return status >= 500 ? "INTERNAL_ERROR" : "CLIENT_ERROR";
  }
};

export const errorHandler = (err: Error, c: Context): Response => {
  if (err instanceof HTTPException) {
    const parsed = errorResponseSchema.safeParse({
      error: {
        code: deriveCode(err.status),
        message: err.message,
      },
    });

    const errorBody = parsed.success
      ? parsed.data
      : { error: { code: deriveCode(err.status), message: err.message } };

    return c.json(errorBody, err.status);
  }

  const message = err instanceof Error ? err.message : String(err);

  console.error(
    JSON.stringify({
      level: "error",
      action: "unhandled_error",
      error: message,
    }),
  );

  const parsed = errorResponseSchema.safeParse({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });

  const errorBody = parsed.success
    ? parsed.data
    : { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } };

  return c.json(errorBody, 500);
};
