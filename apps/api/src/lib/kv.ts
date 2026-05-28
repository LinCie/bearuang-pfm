import { generateSessionToken } from "./crypto";

export const DEFAULT_SESSION_TTL = 1800;

export const createSession = async (
  kv: KVNamespace,
  userId: string,
  ttlSeconds = DEFAULT_SESSION_TTL,
): Promise<string> => {
  const token = generateSessionToken();
  await kv.put(token, userId, { expirationTtl: ttlSeconds });
  return token;
};

export const getSession = (kv: KVNamespace, token: string): Promise<string | null> => kv.get(token);

export const refreshSession = async (
  kv: KVNamespace,
  token: string,
  userId: string,
  ttlSeconds = DEFAULT_SESSION_TTL,
): Promise<void> => {
  await kv.put(token, userId, { expirationTtl: ttlSeconds });
};

export const deleteSession = (kv: KVNamespace, token: string): Promise<void> => kv.delete(token);
