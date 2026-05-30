import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  createTransactionRequestSchema,
  transactionDetailSchema,
  transactionIdParamsSchema,
  transactionSchema,
} from "../schemas/transaction.schema";
import {
  createTransaction,
  getTransaction,
} from "../services/transaction.service";

const createTransactionRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createTransactionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Transaction replayed",
      content: {
        "application/json": {
          schema: transactionSchema,
        },
      },
    },
    201: {
      description: "Transaction created",
      content: {
        "application/json": {
          schema: transactionSchema,
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
    404: {
      description: "Domain not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    501: {
      description: "Not implemented",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const getTransactionRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/{id}",
  request: {
    params: transactionIdParamsSchema,
  },
  responses: {
    200: {
      description: "Transaction detail",
      content: {
        "application/json": {
          schema: transactionDetailSchema,
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
    404: {
      description: "Transaction not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

export const transactionsRouter = new OpenAPIHono<{
  Bindings: Env;
  Variables: { userId: string };
}>({
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

transactionsRouter.use("/api/v1/transactions", authMiddleware);
transactionsRouter.use("/api/v1/transactions/:id", authMiddleware);

transactionsRouter.openapi(createTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const input = c.req.valid("json");
  const result = await createTransaction(db, input, userId);

  return c.json(result.transaction, result.replayed ? 200 : 201);
});

transactionsRouter.openapi(getTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id } = c.req.valid("param");
  const transaction = await getTransaction(db, id);

  return c.json(transaction, 200);
});
