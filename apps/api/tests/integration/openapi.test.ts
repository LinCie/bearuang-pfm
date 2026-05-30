import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../../src/index";

interface RouteOperation {
  security?: Record<string, unknown>[];
}

interface OpenApiDoc {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, RouteOperation>>;
  components?: { securitySchemes?: Record<string, unknown> };
}

describe("OpenAPI document", () => {
  it("serves a valid 3.1 spec at /doc", async () => {
    const res = await app.request("/doc", {}, env);
    expect(res.status).toBe(200);

    const doc: OpenApiDoc = await res.json();

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("bearuang API");

    // A representative sample of routes from each finished epic is present.
    expect(doc.paths["/api/v1/auth/login"]).toBeDefined();
    expect(doc.paths["/api/v1/accounts"]).toBeDefined();
    expect(doc.paths["/api/v1/categories"]).toBeDefined();
    expect(doc.paths["/api/v1/transactions"]).toBeDefined();

    // Bearer security scheme is registered for client generators.
    expect(doc.components?.securitySchemes?.Bearer).toEqual({
      type: "http",
      scheme: "bearer",
    });

    // Protected routes advertise the Bearer requirement; public ones do not.
    expect(doc.paths["/api/v1/accounts"]?.get?.security).toEqual([{ Bearer: [] }]);
    expect(doc.paths["/api/v1/auth/login"]?.post?.security).toBeUndefined();
  });

  it("serves the Scalar API reference UI at /scalar", async () => {
    const res = await app.request("/scalar", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    // The Scalar UI bootstraps from our OpenAPI document.
    expect(html).toContain("/doc");
  });
});
