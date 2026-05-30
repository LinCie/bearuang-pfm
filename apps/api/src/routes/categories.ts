import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema } from "../schemas/common.schema";
import {
  categoryIdParamsSchema,
  categoryListResponseSchema,
  categorySchema,
  createCategoryRequestSchema,
  listCategoriesQuerySchema,
  updateCategoryRequestSchema,
} from "../schemas/category.schema";
import {
  createCategory,
  deleteCategory,
  listCategories,
  seedCategories,
  updateCategory,
} from "../services/category.service";

const createCategoryRoute = createRoute({
  method: "post",
  path: "/api/v1/categories",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCategoryRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Category created",
      content: {
        "application/json": {
          schema: categorySchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const listCategoriesRoute = createRoute({
  method: "get",
  path: "/api/v1/categories",
  request: {
    query: listCategoriesQuerySchema,
  },
  responses: {
    200: {
      description: "Categories list",
      content: {
        "application/json": {
          schema: categoryListResponseSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const seedCategoriesRoute = createRoute({
  method: "post",
  path: "/api/v1/categories/seed",
  responses: {
    200: {
      description: "Seeded categories",
      content: {
        "application/json": {
          schema: categoryListResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const updateCategoryRoute = createRoute({
  method: "put",
  path: "/api/v1/categories/{id}",
  request: {
    params: categoryIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateCategoryRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Category updated",
      content: {
        "application/json": {
          schema: categorySchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Category not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const deleteCategoryRoute = createRoute({
  method: "delete",
  path: "/api/v1/categories/{id}",
  request: {
    params: categoryIdParamsSchema,
  },
  responses: {
    204: {
      description: "Category deleted",
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Category not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Category in use",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

export const categoriesRouter = new OpenAPIHono<{
  Bindings: Env;
  Variables: { userId: string };
}>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const parsed = errorResponseSchema.safeParse({
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: result.error.issues,
        },
      });

      const errorBody = parsed.success
        ? parsed.data
        : { error: { code: "VALIDATION_ERROR", message: "Validation failed" } };

      return c.json(errorBody, 400);
    }
  },
});

categoriesRouter.use("/api/v1/categories", authMiddleware);
categoriesRouter.use("/api/v1/categories/seed", authMiddleware);
categoriesRouter.use("/api/v1/categories/:id", authMiddleware);

categoriesRouter.openapi(createCategoryRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const input = c.req.valid("json");
  const category = await createCategory(db, input, userId);

  return c.json(category, 201);
});

categoriesRouter.openapi(listCategoriesRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const filter = c.req.valid("query");
  const result = await listCategories(db, filter);

  return c.json(result, 200);
});

categoriesRouter.openapi(seedCategoriesRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const result = await seedCategories(db, userId);

  return c.json(result, 200);
});

categoriesRouter.openapi(updateCategoryRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const input = c.req.valid("json");
  const category = await updateCategory(db, id, input, userId);

  return c.json(category, 200);
});

categoriesRouter.openapi(deleteCategoryRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id } = c.req.valid("param");
  await deleteCategory(db, id);

  return c.body(null, 204);
});
