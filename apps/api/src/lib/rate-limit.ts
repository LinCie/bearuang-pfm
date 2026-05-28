export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_SECONDS = 900;
export const RATE_LIMIT_KEY = "rate_limit:login:global";

export const getRateLimitCount = async (kv: KVNamespace, key: string): Promise<number> => {
  const raw = await kv.get(key);
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const incrementRateLimitCount = async (
  kv: KVNamespace,
  key: string,
  windowSeconds: number,
): Promise<number> => {
  const current = await getRateLimitCount(kv, key);
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: windowSeconds });
  return next;
};

export const resetRateLimitCount = (kv: KVNamespace, key: string): Promise<void> => kv.delete(key);
