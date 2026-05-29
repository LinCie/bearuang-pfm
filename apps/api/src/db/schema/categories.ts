import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    usage_count: integer("usage_count").notNull().default(0),
    created_by: text("created_by").notNull().references(() => users.id),
    updated_by: text("updated_by").notNull().references(() => users.id),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => ({
    nameTypeUnique: uniqueIndex("categories_name_type_unique").on(table.name, table.type),
  }),
);
