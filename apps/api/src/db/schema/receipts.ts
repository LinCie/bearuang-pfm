import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { transactions } from "./transactions";
import { users } from "./users";

export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    transaction_id: text("transaction_id").notNull().references(() => transactions.id),
    r2_key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    content_type: text("content_type").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    created_by: text("created_by").notNull().references(() => users.id),
    created_at: text("created_at").notNull(),
  },
  (table) => ({
    transactionIdIndex: index("idx_receipts_transaction_id").on(table.transaction_id),
  }),
);
