import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getSession, refreshSession } from "../lib/kv";

const UNAUTHORIZED = () => new HTTPException(401, { message: "Unauthorized" });

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { userId: string } }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      throw UNAUTHORIZED();
    }

    const token = authHeader.slice(7);
    const userId = await getSession(c.env.SESSIONS, token);

    if (!userId) {
      throw UNAUTHORIZED();
    }

    c.set("userId", userId);
    await refreshSession(c.env.SESSIONS, token, userId);

    await next();
  },
);
