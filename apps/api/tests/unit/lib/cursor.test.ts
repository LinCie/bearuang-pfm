import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../../src/lib/cursor";

describe("cursor", () => {
  it("encodes and decodes a cursor round-trip", () => {
    const cursor = encodeCursor("2026-05-28", "abc-123");
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual({ date: "2026-05-28", id: "abc-123" });
  });

  it("produces a base64 string", () => {
    const cursor = encodeCursor("2026-01-01", "id-1");
    expect(cursor).toBe(btoa("2026-01-01\nid-1"));
  });

  it("throws INVALID_CURSOR for non-base64 input", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow("Invalid pagination cursor");
  });

  it("throws INVALID_CURSOR for wrong format after decode", () => {
    const bad = btoa("no-newline-here");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });

  it("throws INVALID_CURSOR for empty parts", () => {
    const bad = btoa("\n");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });

  it("throws INVALID_CURSOR for invalid date format", () => {
    const bad = btoa("not-a-date\nsome-id");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });
});
