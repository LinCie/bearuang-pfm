import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import { settings, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { createSession } from "../lib/kv";
import {
  incrementRateLimitCount,
  RATE_LIMIT_KEY,
  RATE_LIMIT_WINDOW_SECONDS,
  resetRateLimitCount,
} from "../lib/rate-limit";

export const login = async (
  db: DrizzleD1Database,
  kv: KVNamespace,
  env: Env,
  password: string,
  ttlSeconds?: number,
): Promise<{ token: string; userId: string }> => {
  const existingUsers = await db.select().from(users).limit(1);

  if (existingUsers.length === 0) {
    if (password !== env.INITIAL_PASSWORD) {
      await incrementRateLimitCount(kv, RATE_LIMIT_KEY, RATE_LIMIT_WINDOW_SECONDS);
      throw new HTTPException(401, { message: "Invalid credentials" });
    }

    const displayNameSetting = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "display_name"))
      .limit(1);

    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      display_name: displayNameSetting[0]?.value ?? "Admin",
      password_hash: await hashPassword(password),
      role: "primary",
      is_active: 1,
      created_at: new Date().toISOString(),
    });

    const token = await createSession(kv, userId, ttlSeconds);
    await resetRateLimitCount(kv, RATE_LIMIT_KEY);

    return { token, userId };
  }

  const user = existingUsers[0];
  const passwordHash = user?.password_hash;

  if (!passwordHash || !(await verifyPassword(password, passwordHash))) {
    await incrementRateLimitCount(kv, RATE_LIMIT_KEY, RATE_LIMIT_WINDOW_SECONDS);
    throw new HTTPException(401, { message: "Invalid credentials" });
  }

  const token = await createSession(kv, user.id, ttlSeconds);
  await resetRateLimitCount(kv, RATE_LIMIT_KEY);

  return { token, userId: user.id };
};

export const changePassword = async (
  db: DrizzleD1Database,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const foundUsers = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = foundUsers[0];

  if (user?.is_active !== 1) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isCurrentPasswordValid) {
    throw new HTTPException(401, { message: "Current password is incorrect" });
  }

  const newHash = await hashPassword(newPassword);
  await db.update(users).set({ password_hash: newHash }).where(eq(users.id, userId));
};

export const getSessionUser = async (
  db: DrizzleD1Database,
  userId: string,
): Promise<{ user_id: string; display_name: string; role: string }> => {
  const foundUsers = await db
    .select({
      id: users.id,
      display_name: users.display_name,
      role: users.role,
      is_active: users.is_active,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = foundUsers[0];

  if (user?.is_active !== 1) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  return {
    user_id: user.id,
    display_name: user.display_name,
    role: user.role,
  };
};
