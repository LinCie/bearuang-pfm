const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

interface ParsedDecimal {
  negative: boolean;
  digits: string;
  scale: number;
}

const parse = (value: string): ParsedDecimal => {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new RangeError(`Invalid decimal string: "${value}"`);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split(".");
  const intPart = parts[0] ?? "";
  const fracPart = parts[1] ?? "";

  return {
    negative,
    digits: `${intPart}${fracPart}`,
    scale: fracPart.length,
  };
};

const toScaledBigInt = (parsed: ParsedDecimal, targetScale: number): bigint => {
  if (targetScale < parsed.scale) {
    throw new RangeError(
      `targetScale (${String(targetScale)}) must be >= the value's own scale (${String(parsed.scale)})`,
    );
  }

  const padded = parsed.digits + "0".repeat(targetScale - parsed.scale);
  const magnitude = BigInt(padded);

  return parsed.negative ? -magnitude : magnitude;
};

const format = (value: bigint, scale: number): string => {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();

  if (scale === 0) {
    return negative && value !== 0n ? `-${digits}` : digits;
  }

  const padded = digits.padStart(scale + 1, "0");
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  const sign = negative && value !== 0n ? "-" : "";

  return `${sign}${intPart}.${fracPart}`;
};

export const add = (a: string, b: string): string => {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);

  return format(toScaledBigInt(pa, scale) + toScaledBigInt(pb, scale), scale);
};

export const subtract = (a: string, b: string): string => {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);

  return format(toScaledBigInt(pa, scale) - toScaledBigInt(pb, scale), scale);
};

export const sum = (values: string[]): string => {
  if (values.length === 0) {
    return "0";
  }

  const parsed = values.map(parse);
  const scale = parsed.reduce((max, value) => Math.max(max, value.scale), 0);
  const total = parsed.reduce((acc, value) => acc + toScaledBigInt(value, scale), 0n);

  return format(total, scale);
};

export const compare = (a: string, b: string): -1 | 0 | 1 => {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  const diff = toScaledBigInt(pa, scale) - toScaledBigInt(pb, scale);

  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
};
