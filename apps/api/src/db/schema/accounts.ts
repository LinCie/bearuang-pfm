import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  currency: text("currency").notNull(),
  initial_balance: text("initial_balance").notNull(),
  is_active: integer("is_active").notNull().default(1),
  created_by: text("created_by").notNull().references(() => users.id),
  updated_by: text("updated_by").notNull().references(() => users.id),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
