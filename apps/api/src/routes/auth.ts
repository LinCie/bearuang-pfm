import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { deleteSession } from "../lib/kv";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  loginRequestSchema,
  loginResponseSchema,
  sessionResponseSchema,
} from "../schemas/auth.schema";
import { getSessionUser, login } from "../services/auth.service";

const loginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/login",
  request: {
    body: {
      content: {
        "application/json": {
          schema: loginRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Login successful",
      content: {
        "application/json": {
          schema: loginResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid credentials",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/logout",
  responses: {
    204: {
      description: "Logged out successfully",
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

const sessionRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/session",
  responses: {
    200: {
      description: "Session details",
      content: {
        "application/json": {
          schema: sessionResponseSchema,
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

export const authRouter = new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>();

authRouter.openapi(loginRoute, async (c) => {
  const { password } = c.req.valid("json");
  const { token } = await login(drizzle(c.env.DB), c.env.SESSIONS, c.env, password);

  return c.json({ token }, 200);
});

authRouter.use("/api/v1/auth/logout", authMiddleware);
authRouter.use("/api/v1/auth/session", authMiddleware);

authRouter.openapi(logoutRoute, async (c) => {
  // authMiddleware guarantees Authorization: Bearer <token> is present
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.slice(7);

  await deleteSession(c.env.SESSIONS, token);

  return c.body(null, 204);
});

authRouter.openapi(sessionRoute, async (c) => {
  const userId = c.get("userId");
  const sessionUser = await getSessionUser(drizzle(c.env.DB), userId);

  return c.json(sessionUser, 200);
});
