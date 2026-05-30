import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import * as schema from "../../src/db/schema";
import { loginResponseSchema } from "../../src/schemas/auth.schema";
import { accountFactory, categoryFactory, transactionFactory } from "../fixtures/factories";
import { applyMigrations } from "../setup";

interface JsonResponse {
  id: string;
  transaction_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  download_url: string;
  items: { download_url: string }[];
  error: { code: string; message: string };
  purged_count: number;
}

describe("receipt routes", () => {
  const db = drizzle(env.DB, { schema });

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM receipts").run();
    await env.DB.prepare("DELETE FROM transactions").run();
    await env.DB.prepare("DELETE FROM accounts").run();
    await env.DB.prepare("DELETE FROM categories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM settings").run();
    const kvList = await env.SESSIONS.list();
    await Promise.all(kvList.keys.map((k) => env.SESSIONS.delete(k.name) as Promise<void>));
    await env.SESSIONS.delete("rate_limit:login:global");
  });

  const login = async () => {
    const res = await app.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.INITIAL_PASSWORD }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const { token } = loginResponseSchema.parse(await res.json());
    const users = await db.select().from(schema.users).limit(1);
    const user = users[0]!;
    return { token, userId: user.id };
  };

  const seedTransaction = async (userId: string) => {
    const account = accountFactory({ created_by: userId, updated_by: userId });
    const category = categoryFactory({ type: "expense", created_by: userId, updated_by: userId });
    await db.insert(schema.accounts).values(account);
    await db.insert(schema.categories).values(category);
    const txn = transactionFactory({
      account_id: account.id,
      category_id: category.id,
      amount: "50.00",
      created_by: userId,
      updated_by: userId,
    });
    await db.insert(schema.transactions).values(txn);
    return { account, category, txn };
  };

  describe("POST /api/v1/transactions/:id/receipts", () => {
    it("uploads a valid JPEG file", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      const formData = new FormData();
      formData.append("file", new File(["fake jpeg content"], "receipt.jpg", { type: "image/jpeg" }));

      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as JsonResponse;
      expect(body.id).toBeDefined();
      expect(body.transaction_id).toBe(txn.id);
      expect(body.filename).toBe("receipt.jpg");
      expect(body.content_type).toBe("image/jpeg");
      expect(body.size_bytes).toBe(17); // "fake jpeg content".length
      expect(body.download_url).toContain("X-Amz-Signature");
      expect(body.download_url).toContain("X-Amz-Expires=900");

      // Verify R2 has the object
      const r2Obj = await env.RECEIPTS.get(body.r2_key);
      expect(r2Obj).not.toBeNull();
    }, 30_000);

    it("rejects invalid content type", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      const formData = new FormData();
      formData.append("file", new File(["data"], "file.txt", { type: "text/plain" }));

      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as JsonResponse;
      expect(body.error.code).toBe("INVALID_FILE_TYPE");
    }, 30_000);

    it("rejects file exceeding 10MB", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      const largeContent = new Uint8Array(10 * 1024 * 1024 + 1);
      const formData = new FormData();
      formData.append("file", new File([largeContent], "big.jpg", { type: "image/jpeg" }));

      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as JsonResponse;
      expect(body.error.code).toBe("FILE_TOO_LARGE");
      expect(body.error.message).toBe("Maximum file size is 10MB");
    }, 30_000);

    it("returns 404 for non-existent transaction", async () => {
      const { token } = await login();

      const formData = new FormData();
      formData.append("file", new File(["data"], "receipt.jpg", { type: "image/jpeg" }));

      const res = await app.request(
        "/api/v1/transactions/non-existent-id/receipts",
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as JsonResponse;
      expect(body.error.code).toBe("TRANSACTION_NOT_FOUND");
    }, 30_000);

    it("returns 401 without auth", async () => {
      const res = await app.request(
        "/api/v1/transactions/some-id/receipts",
        { method: "POST" },
        env,
      );
      expect(res.status).toBe(401);
    }, 30_000);
  });

  describe("GET /api/v1/transactions/:id/receipts", () => {
    it("lists receipts with presigned URLs", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      // Upload two receipts
      for (const name of ["a.jpg", "b.png"]) {
        const formData = new FormData();
        const type = name.endsWith(".jpg") ? "image/jpeg" : "image/png";
        formData.append("file", new File(["content"], name, { type }));
        await app.request(
          `/api/v1/transactions/${txn.id}/receipts`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
          env,
        );
      }

      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonResponse;
      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        expect(item.download_url).toContain("X-Amz-Signature");
      }
    }, 30_000);

    it("returns empty list for transaction with no receipts", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonResponse;
      expect(body.items).toHaveLength(0);
    }, 30_000);

    it("returns 404 for non-existent transaction", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/transactions/non-existent-id/receipts",
        { headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as JsonResponse;
      expect(body.error.code).toBe("TRANSACTION_NOT_FOUND");
    }, 30_000);

    it("receipts accessible on soft-deleted transaction", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      // Upload a receipt
      const formData = new FormData();
      formData.append("file", new File(["data"], "receipt.pdf", { type: "application/pdf" }));
      await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );

      // Soft-delete the transaction
      await app.request(
        `/api/v1/transactions/${txn.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      // Receipts should still be accessible
      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonResponse;
      expect(body.items).toHaveLength(1);
    }, 30_000);
  });

  describe("DELETE /api/v1/receipts/:id", () => {
    it("deletes receipt from R2 and D1", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      // Upload
      const formData = new FormData();
      formData.append("file", new File(["data"], "receipt.jpg", { type: "image/jpeg" }));
      const uploadRes = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );
      const uploaded = (await uploadRes.json()) as JsonResponse;

      // Delete
      const res = await app.request(
        `/api/v1/receipts/${uploaded.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(204);

      // Verify gone from D1
      const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.id, uploaded.id));
      expect(rows).toHaveLength(0);

      // Verify gone from R2
      const r2Obj = await env.RECEIPTS.get(uploaded.r2_key);
      expect(r2Obj).toBeNull();
    }, 30_000);

    it("returns 404 for non-existent receipt", async () => {
      const { token } = await login();

      const res = await app.request(
        "/api/v1/receipts/non-existent-id",
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as JsonResponse;
      expect(body.error.code).toBe("NOT_FOUND");
    }, 30_000);
  });

  describe("purge trash deletes associated receipts", () => {
    it("removes receipts when transaction is purged", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      // Upload a receipt
      const formData = new FormData();
      formData.append("file", new File(["data"], "receipt.jpg", { type: "image/jpeg" }));
      const uploadRes = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
        env,
      );
      const uploaded = (await uploadRes.json()) as JsonResponse;

      // Soft-delete and set old deleted_at for purge eligibility
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await db.update(schema.transactions).set({
        is_deleted: 1,
        deleted_at: oldDate,
        updated_at: new Date().toISOString(),
      }).where(eq(schema.transactions.id, txn.id));

      // Purge
      const purgeRes = await app.request(
        "/api/v1/transactions/trash/purge",
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        env,
      );
      expect(purgeRes.status).toBe(200);
      const purgeBody = (await purgeRes.json()) as JsonResponse;
      expect(purgeBody.purged_count).toBe(1);

      // Verify receipt gone from D1
      const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.id, uploaded.id));
      expect(rows).toHaveLength(0);

      // Verify receipt gone from R2
      const r2Obj = await env.RECEIPTS.get(uploaded.r2_key);
      expect(r2Obj).toBeNull();
    }, 30_000);
  });

  describe("multiple receipts on one transaction", () => {
    it("supports many-to-one relationship", async () => {
      const { token, userId } = await login();
      const { txn } = await seedTransaction(userId);

      // Upload 3 receipts
      for (let i = 0; i < 3; i++) {
        const formData = new FormData();
        formData.append("file", new File([`content-${i}`], `receipt-${i}.jpg`, { type: "image/jpeg" }));
        const res = await app.request(
          `/api/v1/transactions/${txn.id}/receipts`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData },
          env,
        );
        expect(res.status).toBe(201);
      }

      const res = await app.request(
        `/api/v1/transactions/${txn.id}/receipts`,
        { headers: { Authorization: `Bearer ${token}` } },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonResponse;
      expect(body.items).toHaveLength(3);
    }, 30_000);
  });
});
