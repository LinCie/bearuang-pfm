import { argon2idAsync } from "@noble/hashes/argon2.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const ARGON2_PARAMS = {
  t: 3,
  m: 65_536,
  p: 1,
  dkLen: 32,
} as const;

const PBKDF2_ITERATIONS = 600_000;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    const value = Number.parseInt(hex.slice(i, i + 2), 16);

    if (Number.isNaN(value)) {
      return null;
    }

    bytes[i / 2] = value;
  }

  return bytes;
};

const createSalt = (): Uint8Array => crypto.getRandomValues(new Uint8Array(16));

const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(a, b);
};

export const generateSessionToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = createSalt();

  try {
    const hash = await argon2idAsync(password, salt, ARGON2_PARAMS);
    return `argon2id:${toHex(salt)}:${toHex(hash)}`;
  } catch {
    const hash = await pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
    return `pbkdf2:${toHex(salt)}:${toHex(hash)}`;
  }
};

export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const [algorithm, saltHex, hashHex] = storedHash.split(":");

  if (!algorithm || !saltHex || !hashHex) {
    return false;
  }

  const salt = fromHex(saltHex);
  const expectedHash = fromHex(hashHex);

  if (!salt || !expectedHash) {
    return false;
  }

  if (algorithm === "argon2id") {
    try {
      const computed = await argon2idAsync(password, salt, ARGON2_PARAMS);
      return timingSafeEqual(computed, expectedHash);
    } catch {
      return false;
    }
  }

  if (algorithm === "pbkdf2") {
    const computed = await pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
    return timingSafeEqual(computed, expectedHash);
  }

  return false;
};
