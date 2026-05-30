import { ApiError } from "./api-error";

export const encodeCursor = (date: string, id: string): string =>
  btoa(`${date}\n${id}`);

export const decodeCursor = (cursor: string): { date: string; id: string } => {
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "Invalid pagination cursor");
  }

  const parts = decoded.split("\n");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ApiError(400, "INVALID_CURSOR", "Invalid pagination cursor");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    throw new ApiError(400, "INVALID_CURSOR", "Invalid pagination cursor");
  }

  return { date: parts[0], id: parts[1] };
};
