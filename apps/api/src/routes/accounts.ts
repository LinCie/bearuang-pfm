import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware } from "../middleware/auth";
import {
  accountIdParamsSchema,
  accountListResponseSchema,
  accountSchema,
  createAccountRequestSchema,
  updateAccountRequestSchema,
} from "../schemas/account.schema";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "../services/account.service";

const createAccountRoute = createRoute({
  method: "post",
  path: "/api/v1/accounts",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createAccountRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Account created",
      content: {
        "application/json": {
          schema: accountSchema,
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
  },
});

const listAccountsRoute = createRoute({
  method: "get",
  path: "/api/v1/accounts",
  responses: {
    200: {
      description: "Accounts list",
      content: {
        "application/json": {
          schema: accountListResponseSchema,
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

const getAccountRoute = createRoute({
  method: "get",
  path: "/api/v1/accounts/:id",
  request: {
    params: accountIdParamsSchema,
  },
  responses: {
    200: {
      description: "Account",
      content: {
        "application/json": {
          schema: accountSchema,
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
      description: "Account not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const updateAccountRoute = createRoute({
  method: "put",
  path: "/api/v1/accounts/:id",
  request: {
    params: accountIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateAccountRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Account updated",
      content: {
        "application/json": {
          schema: accountSchema,
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
      description: "Account not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/api/v1/accounts/:id",
  request: {
    params: accountIdParamsSchema,
  },
  responses: {
    204: {
      description: "Account deleted",
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
      description: "Account not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

export const accountsRouter = new OpenAPIHono<{
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

accountsRouter.use("/api/v1/accounts", authMiddleware);
accountsRouter.use("/api/v1/accounts/:id", authMiddleware);

accountsRouter.openapi(createAccountRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const input = c.req.valid("json");
  const account = await createAccount(db, input, userId);

  return c.json(account, 201);
});

accountsRouter.openapi(listAccountsRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const result = await listAccounts(db);

  return c.json(result, 200);
});

accountsRouter.openapi(getAccountRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id } = c.req.valid("param");
  const account = await getAccount(db, id);

  return c.json(account, 200);
});

accountsRouter.openapi(updateAccountRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const input = c.req.valid("json");
  const account = await updateAccount(db, id, input, userId);

  return c.json(account, 200);
});

accountsRouter.openapi(deleteAccountRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  await deleteAccount(db, id, userId);

  return c.body(null, 204);
});
