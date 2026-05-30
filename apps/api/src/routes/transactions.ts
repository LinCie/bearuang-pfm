import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema, paginatedResponseSchema } from "../schemas/common.schema";
import {
  createTransactionRequestSchema,
  listTransactionsQuerySchema,
  purgeResponseSchema,
  transactionDetailSchema,
  transactionIdParamsSchema,
  transactionSchema,
  trashListSchema,
  updateTransactionRequestSchema,
} from "../schemas/transaction.schema";
import {
  createTransaction,
  getTransaction,
  listTrash,
  listTransactions,
  purgeTrash,
  restoreTransaction,
  softDeleteTransaction,
  updateTransaction,
} from "../services/transaction.service";

const createTransactionRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions",
  security: [{ Bearer: [] }],
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

  },
});

const listTransactionsRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions",
  security: [{ Bearer: [] }],
  request: {
    query: listTransactionsQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated transaction list",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(transactionSchema),
        },
      },
    },
    400: {
      description: "Invalid cursor or query params",
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

const getTransactionRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/{id}",
  security: [{ Bearer: [] }],
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

const updateTransactionRoute = createRoute({
  method: "put",
  path: "/api/v1/transactions/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: transactionIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateTransactionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Transaction updated",
      content: { "application/json": { schema: transactionSchema } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const deleteTransactionRoute = createRoute({
  method: "delete",
  path: "/api/v1/transactions/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: transactionIdParamsSchema,
  },
  responses: {
    204: { description: "Transaction soft-deleted" },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const listTrashRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/trash",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "Trash listing",
      content: { "application/json": { schema: trashListSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const restoreTransactionRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions/{id}/restore",
  security: [{ Bearer: [] }],
  request: {
    params: transactionIdParamsSchema,
  },
  responses: {
    200: {
      description: "Transaction restored",
      content: { "application/json": { schema: transactionSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    409: {
      description: "Account inactive",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const purgeTrashRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions/trash/purge",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "Trash purged",
      content: { "application/json": { schema: purgeResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
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
transactionsRouter.use("/api/v1/transactions/:id/restore", authMiddleware);
transactionsRouter.use("/api/v1/transactions/trash/purge", authMiddleware);

transactionsRouter.openapi(createTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const input = c.req.valid("json");
  const result = await createTransaction(db, input, userId);

  return c.json(result.transaction, result.replayed ? 200 : 201);
});

transactionsRouter.openapi(listTransactionsRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const query = c.req.valid("query");
  const result = await listTransactions(db, query);
  return c.json(result, 200);
});

// Register literal paths before parameterized paths
transactionsRouter.openapi(listTrashRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const items = await listTrash(db);
  return c.json({ items }, 200);
});

transactionsRouter.openapi(purgeTrashRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const purged_count = await purgeTrash(db, c.env.RECEIPTS);
  return c.json({ purged_count }, 200);
});

transactionsRouter.openapi(getTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id } = c.req.valid("param");
  const transaction = await getTransaction(db, id);

  return c.json(transaction, 200);
});

transactionsRouter.openapi(updateTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const input = c.req.valid("json");
  const transaction = await updateTransaction(db, id, input, userId);
  return c.json(transaction, 200);
});

transactionsRouter.openapi(deleteTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  await softDeleteTransaction(db, id, userId);
  return c.body(null, 204);
});

transactionsRouter.openapi(restoreTransactionRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const transaction = await restoreTransaction(db, id, userId);
  return c.json(transaction, 200);
});
