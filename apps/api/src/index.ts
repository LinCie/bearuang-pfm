import { OpenAPIHono } from "@hono/zod-openapi";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ name: "bearuang-api", version: "0.1.0" });
});

export default app;
