import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { categories } from "./categories";
import { users } from "./users";

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    amount: text("amount").notNull(),
    account_id: text("account_id").notNull().references(() => accounts.id),
    destination_account_id: text("destination_account_id").references(() => accounts.id),
    category_id: text("category_id").references(() => categories.id),
    payee: text("payee"),
    notes: text("notes"),
    date: text("date").notNull(),
    created_by: text("created_by").notNull().references(() => users.id),
    updated_by: text("updated_by").notNull().references(() => users.id),
    is_deleted: integer("is_deleted").notNull().default(0),
    deleted_at: text("deleted_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => ({
    accountDateIndex: index("idx_transactions_account_date").on(
      table.account_id,
      table.date,
    ),
    isDeletedIndex: index("idx_transactions_is_deleted").on(table.is_deleted),
  }),
);
