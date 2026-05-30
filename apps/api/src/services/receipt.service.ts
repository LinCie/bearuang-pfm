import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { receipts, transactions } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { generatePresignedDownloadUrl } from "../lib/r2";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

const EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface R2Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

const R2_BUCKET_NAME = "bearuang-receipts";

interface UploadReceiptInput {
  transactionId: string;
  file: File;
}

interface ReceiptMetadata {
  id: string;
  transaction_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_by: string;
  created_at: string;
  download_url: string;
}

export const uploadReceipt = async (
  db: DrizzleD1Database,
  r2Bucket: R2Bucket,
  env: R2Env,
  input: UploadReceiptInput,
  userId: string,
): Promise<ReceiptMetadata> => {
  // Validate transaction exists
  const txn = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, input.transactionId), eq(transactions.is_deleted, 0)))
    .limit(1);

  if (!txn[0]) {
    throw new ApiError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
  }

  // Validate content type
  if (!ALLOWED_CONTENT_TYPES.includes(input.file.type as typeof ALLOWED_CONTENT_TYPES[number])) {
    throw new ApiError(400, "INVALID_FILE_TYPE", `File type "${input.file.type}" is not allowed. Accepted: ${ALLOWED_CONTENT_TYPES.join(", ")}`);
  }

  // Validate file size
  if (input.file.size > MAX_FILE_SIZE) {
    throw new ApiError(400, "FILE_TOO_LARGE", "Maximum file size is 10MB");
  }

  const id = crypto.randomUUID();
  const ext = EXTENSION_MAP[input.file.type] ?? "";
  const r2Key = `receipts/${input.transactionId}/${id}${ext}`;
  const now = new Date().toISOString();

  // Upload to R2
  await r2Bucket.put(r2Key, await input.file.arrayBuffer());

  // Save metadata; remove the orphaned R2 object if the insert fails
  try {
    await db.insert(receipts).values({
      id,
      transaction_id: input.transactionId,
      r2_key: r2Key,
      filename: input.file.name,
      content_type: input.file.type,
      size_bytes: input.file.size,
      created_by: userId,
      created_at: now,
    });
  } catch (e) {
    await r2Bucket.delete(r2Key);
    throw e;
  }

  const downloadUrl = await generatePresignedDownloadUrl(
    env.R2_ACCOUNT_ID,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    r2Key,
  );

  return {
    id,
    transaction_id: input.transactionId,
    r2_key: r2Key,
    filename: input.file.name,
    content_type: input.file.type,
    size_bytes: input.file.size,
    created_by: userId,
    created_at: now,
    download_url: downloadUrl,
  };
};

export const listReceipts = async (
  db: DrizzleD1Database,
  env: R2Env,
  transactionId: string,
): Promise<{ items: ReceiptMetadata[] }> => {
  // Validate transaction exists
  const txn = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!txn[0]) {
    throw new ApiError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
  }

  const rows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.transaction_id, transactionId));

  const items = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      download_url: await generatePresignedDownloadUrl(
        env.R2_ACCOUNT_ID,
        env.R2_ACCESS_KEY_ID,
        env.R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME,
        row.r2_key,
      ),
    })),
  );

  return { items };
};

export const deleteReceipt = async (
  db: DrizzleD1Database,
  r2Bucket: R2Bucket,
  receiptId: string,
): Promise<void> => {
  const rows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.id, receiptId))
    .limit(1);

  if (!rows[0]) {
    throw new ApiError(404, "NOT_FOUND", "Receipt not found");
  }

  await db.delete(receipts).where(eq(receipts.id, receiptId));
  await r2Bucket.delete(rows[0].r2_key);
};

export const deleteReceiptsForTransactions = async (
  db: DrizzleD1Database,
  r2Bucket: R2Bucket,
  transactionIds: string[],
): Promise<number> => {
  if (transactionIds.length === 0) return 0;

  const rows = await db
    .select({ id: receipts.id, r2_key: receipts.r2_key })
    .from(receipts)
    .where(inArray(receipts.transaction_id, transactionIds));

  if (rows.length === 0) return 0;

  // Delete from R2
  await Promise.all(rows.map((row) => r2Bucket.delete(row.r2_key)));

  // Delete metadata
  await db.delete(receipts).where(inArray(receipts.transaction_id, transactionIds));

  return rows.length;
};
