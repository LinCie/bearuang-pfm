import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { settings } from "../db/schema";
import { DEFAULT_SESSION_TTL, deleteSession } from "../lib/kv";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  sessionResponseSchema,
} from "../schemas/auth.schema";
import { changePassword, getSessionUser, login } from "../services/auth.service";

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
  security: [{ Bearer: [] }],
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
  security: [{ Bearer: [] }],
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

const changePasswordRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/change-password",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: changePasswordRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Password changed successfully",
      content: {
        "application/json": {
          schema: changePasswordResponseSchema,
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

export const authRouter = new OpenAPIHono<{ Bindings: Env; Variables: { userId: string } }>();

authRouter.use("/api/v1/auth/login", rateLimitMiddleware);

authRouter.openapi(loginRoute, async (c) => {
  const { password } = c.req.valid("json");
  const db = drizzle(c.env.DB);
  const timeoutSetting = await db.select().from(settings).where(eq(settings.key, "session_timeout")).limit(1);
  const parsedTtl = timeoutSetting[0] ? Number.parseInt(timeoutSetting[0].value, 10) : DEFAULT_SESSION_TTL;
  const ttl = Number.isNaN(parsedTtl) || parsedTtl < 60 ? DEFAULT_SESSION_TTL : parsedTtl;
  const { token } = await login(
    db,
    c.env.SESSIONS,
    c.env,
    password,
    ttl,
  );

  return c.json({ token }, 200);
});

authRouter.use("/api/v1/auth/logout", authMiddleware);
authRouter.use("/api/v1/auth/session", authMiddleware);
authRouter.use("/api/v1/auth/change-password", authMiddleware);

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

authRouter.openapi(changePasswordRoute, async (c) => {
  const { current_password: currentPassword, new_password: newPassword } = c.req.valid("json");
  const userId = c.get("userId");
  await changePassword(drizzle(c.env.DB), userId, currentPassword, newPassword);
  return c.json({ message: "Password changed successfully" }, 200);
});
