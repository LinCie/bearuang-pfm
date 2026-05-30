import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { categories } from "./categories";
import { transactions } from "./transactions";
import { users } from "./users";

export const recurringTemplates = sqliteTable(
  "recurring_templates",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    amount: text("amount").notNull(),
    account_id: text("account_id").notNull().references(() => accounts.id),
    category_id: text("category_id").notNull().references(() => categories.id),
    payee: text("payee"),
    notes: text("notes"),
    frequency: text("frequency").notNull(),
    start_date: text("start_date").notNull(),
    end_date: text("end_date"),
    is_active: integer("is_active").notNull().default(1),
    created_by: text("created_by").notNull().references(() => users.id),
    updated_by: text("updated_by").notNull().references(() => users.id),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => ({
    isActiveIndex: index("idx_recurring_templates_is_active").on(table.is_active),
  }),
);

export const recurringOccurrences = sqliteTable(
  "recurring_occurrences",
  {
    id: text("id").primaryKey(),
    template_id: text("template_id").notNull().references(() => recurringTemplates.id),
    due_date: text("due_date").notNull(),
    status: text("status").notNull(),
    transaction_id: text("transaction_id").references(() => transactions.id),
    created_at: text("created_at").notNull(),
  },
  (table) => ({
    templateIdIndex: index("idx_recurring_occurrences_template_id").on(table.template_id),
  }),
);
