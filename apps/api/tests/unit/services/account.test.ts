import { describe, expect, it } from "vitest";
import { classifyAccountType } from "../../../src/services/account.service";

describe("classifyAccountType", () => {
  it("returns asset for asset account types", () => {
    expect(classifyAccountType("bank")).toBe("asset");
    expect(classifyAccountType("cash")).toBe("asset");
    expect(classifyAccountType("ewallet")).toBe("asset");
    expect(classifyAccountType("investment")).toBe("asset");
  });

  it("returns liability for liability account types", () => {
    expect(classifyAccountType("credit_card")).toBe("liability");
    expect(classifyAccountType("loan")).toBe("liability");
  });
});
