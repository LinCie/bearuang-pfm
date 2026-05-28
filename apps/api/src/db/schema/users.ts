import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  display_name: text("display_name").notNull(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull(),
  is_active: integer("is_active").notNull().default(1),
  created_at: text("created_at").notNull(),
});
