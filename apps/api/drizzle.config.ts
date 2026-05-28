import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // No driver needed for local-only `drizzle-kit generate` flow.
  // d1-http driver requires remote Cloudflare credentials; omit until remote introspection is needed.
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
});
