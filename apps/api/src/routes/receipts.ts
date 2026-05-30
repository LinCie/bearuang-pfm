import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { authMiddleware } from "../middleware/auth";
import { errorResponseSchema } from "../schemas/common.schema";
import { transactionIdParamsSchema } from "../schemas/transaction.schema";
import { ApiError } from "../lib/api-error";
import {
  deleteReceipt,
  listReceipts,
  uploadReceipt,
} from "../services/receipt.service";

const receiptSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  r2_key: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  created_by: z.string(),
  created_at: z.string(),
  download_url: z.string(),
});

const receiptListSchema = z.object({
  items: z.array(receiptSchema),
});

const receiptIdParamsSchema = z.object({
  id: z.string().min(1),
});

const uploadReceiptRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions/{id}/receipts",
  security: [{ Bearer: [] }],
  request: {
    params: transactionIdParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({ file: z.any() }),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Receipt uploaded",
      content: { "application/json": { schema: receiptSchema } },
    },
    400: {
      description: "Invalid file",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Transaction not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const listReceiptsRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/{id}/receipts",
  security: [{ Bearer: [] }],
  request: { params: transactionIdParamsSchema },
  responses: {
    200: {
      description: "Receipt list",
      content: { "application/json": { schema: receiptListSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Transaction not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const deleteReceiptRoute = createRoute({
  method: "delete",
  path: "/api/v1/receipts/{id}",
  security: [{ Bearer: [] }],
  request: { params: receiptIdParamsSchema },
  responses: {
    204: { description: "Receipt deleted" },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

export const receiptsRouter = new OpenAPIHono<{
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

receiptsRouter.use("/api/v1/transactions/:id/receipts", authMiddleware);
receiptsRouter.use("/api/v1/receipts/:id", authMiddleware);

receiptsRouter.openapi(uploadReceiptRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const { id: transactionId } = c.req.valid("param");
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    throw new ApiError(400, "INVALID_FILE_TYPE", "A file must be provided");
  }

  const result = await uploadReceipt(
    db,
    c.env.RECEIPTS,
    {
      R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
    },
    { transactionId, file },
    userId,
  );

  return c.json(result, 201);
});

receiptsRouter.openapi(listReceiptsRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id: transactionId } = c.req.valid("param");

  const result = await listReceipts(db, {
    R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
  }, transactionId);

  return c.json(result, 200);
});

receiptsRouter.openapi(deleteReceiptRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const { id: receiptId } = c.req.valid("param");

  await deleteReceipt(db, c.env.RECEIPTS, receiptId);
  return c.body(null, 204);
});
