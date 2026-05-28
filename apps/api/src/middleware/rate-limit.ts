import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getRateLimitCount, RATE_LIMIT_KEY, RATE_LIMIT_MAX_ATTEMPTS } from "../lib/rate-limit";

export const rateLimitMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const count = await getRateLimitCount(c.env.SESSIONS, RATE_LIMIT_KEY);

  if (count >= RATE_LIMIT_MAX_ATTEMPTS) {
    throw new HTTPException(429, { message: "Too many login attempts. Try again in 15 minutes." });
  }

  await next();
});
