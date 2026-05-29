import { describe, expect, it } from "vitest";
import { add, compare, subtract, sum } from "../../../src/lib/decimal";

describe("decimal helpers", () => {
  it("adds and subtracts decimal strings exactly", () => {
    expect(add("12.50", "3.75")).toBe("16.25");
    expect(subtract("100.00", "33.33")).toBe("66.67");
  });

  it("sums values while preserving trailing zero precision", () => {
    expect(sum(["1.10", "2.20", "3.30"])).toBe("6.60");
    expect(sum([])).toBe("0");
    expect(sum(["1.10"])).toBe("1.10");
  });

  it("compares values after aligning scale", () => {
    expect(compare("10.00", "9.99")).toBe(1);
    expect(compare("5.00", "5.00")).toBe(0);
    expect(compare("1.00", "2.00")).toBe(-1);
    expect(compare("1.0", "1.00")).toBe(0);
  });

  it("preserves max input scale and supports negatives without negative zero", () => {
    expect(add("1000.00", "0")).toBe("1000.00");
    expect(subtract("0.00", "50.00")).toBe("-50.00");
    expect(add("-50.00", "50.00")).toBe("0.00");
    expect(add("0.1", "0.2")).toBe("0.3");
  });

  it("formats scale-0 results and normalizes negative zero at scale 0", () => {
    expect(add("1", "2")).toBe("3");
    expect(subtract("5", "8")).toBe("-3");
    expect(add("-0", "0")).toBe("0");
    expect(subtract("7", "7")).toBe("0");
  });

  it("handles negative and mixed-scale comparisons", () => {
    expect(compare("-1.00", "1.00")).toBe(-1);
    expect(compare("-5.00", "-4.99")).toBe(-1);
    expect(compare("-5.00", "-5.000")).toBe(0);
    expect(compare("0.10", "0.1")).toBe(0);
  });

  it("sums mixed scales and produces negative totals", () => {
    expect(sum(["1.5", "2.25", "0.025"])).toBe("3.775");
    expect(sum(["-10.00", "2.50", "2.50"])).toBe("-5.00");
    expect(subtract("0.00", "0.05")).toBe("-0.05");
  });

  it("rejects malformed decimals", () => {
    expect(() => add("abc", "1.00")).toThrow(RangeError);
    expect(() => compare("1.", "1.0")).toThrow(RangeError);
    expect(() => add("", "1.00")).toThrow(RangeError);
    expect(() => add("-", "1.00")).toThrow(RangeError);
    expect(() => add(".5", "1.00")).toThrow(RangeError);
    expect(() => add("+5", "1.00")).toThrow(RangeError);
    expect(() => add("1e5", "1.00")).toThrow(RangeError);
    expect(() => add("1.2.3", "1.00")).toThrow(RangeError);
    expect(() => sum(["1.00", "5."])).toThrow(RangeError);
  });
});
