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
    const params = `t=${String(ARGON2_PARAMS.t)},m=${String(ARGON2_PARAMS.m)},p=${String(ARGON2_PARAMS.p)}`;
    return `argon2id:${params}:${toHex(salt)}:${toHex(hash)}`;
  } catch {
    const hash = await pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
    return `pbkdf2:${toHex(salt)}:${toHex(hash)}`;
  }
};

export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const parts = storedHash.split(":");
  const algorithm = parts[0];

  if (!algorithm) {
    return false;
  }

  if (algorithm === "argon2id") {
    // Detect format by checking whether the second segment is a param string (new)
    // or a hex salt (old). New format: argon2id:t=<t>,m=<m>,p=<p>:<salt>:<hash>
    // Old format: argon2id:<salt>:<hash>
    const isNewFormat = parts[1]?.startsWith("t=") ?? false;

    let argon2Params: { t: number; m: number; p: number; dkLen: number };
    let saltHex: string | undefined;
    let hashHex: string | undefined;

    if (isNewFormat) {
      const [, paramsSegment, sHex, hHex] = parts;
      if (!paramsSegment || !sHex || !hHex) {
        return false;
      }
      const paramMap = Object.fromEntries(
        paramsSegment.split(",").map((kv) => kv.split("=") as [string, string]),
      );
      const t = Number(paramMap.t);
      const m = Number(paramMap.m);
      const p = Number(paramMap.p);
      if (!Number.isInteger(t) || t <= 0 || !Number.isInteger(m) || m <= 0 || !Number.isInteger(p) || p <= 0) {
        return false;
      }
      argon2Params = { t, m, p, dkLen: ARGON2_PARAMS.dkLen };
      saltHex = sHex;
      hashHex = hHex;
    } else {
      // Old format — fall back to current ARGON2_PARAMS constant
      const [, sHex, hHex] = parts;
      if (!sHex || !hHex) {
        return false;
      }
      argon2Params = ARGON2_PARAMS;
      saltHex = sHex;
      hashHex = hHex;
    }

    const salt = fromHex(saltHex);
    const expectedHash = fromHex(hashHex);

    if (!salt || !expectedHash) {
      return false;
    }

    try {
      const computed = await argon2idAsync(password, salt, argon2Params);
      return timingSafeEqual(computed, expectedHash);
    } catch {
      return false;
    }
  }

  if (algorithm === "pbkdf2") {
    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex) {
      return false;
    }
    const salt = fromHex(saltHex);
    const expectedHash = fromHex(hashHex);
    if (!salt || !expectedHash) {
      return false;
    }
    const computed = await pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
    return timingSafeEqual(computed, expectedHash);
  }

  return false;
};
