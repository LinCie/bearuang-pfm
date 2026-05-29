import type { InferInsertModel } from "drizzle-orm";
import * as schema from "../../src/db/schema/index";

type UserInsert = InferInsertModel<typeof schema.users>;
type SettingsInsert = InferInsertModel<typeof schema.settings>;
type CategoryInsert = InferInsertModel<typeof schema.categories>;

export const userFactory = (overrides?: Partial<UserInsert>): UserInsert => ({
  id: crypto.randomUUID(),
  display_name: "Test User",
  password_hash: "placeholder_hash_not_real",
  role: "primary",
  is_active: 1,
  created_at: new Date().toISOString(),
  ...overrides,
});

export const settingsFactory = (
  overrides?: Partial<SettingsInsert>,
): SettingsInsert => ({
  key: `test_key_${crypto.randomUUID()}`,
  value: "test_value",
  updated_at: new Date().toISOString(),
  ...overrides,
});

export const categoryFactory = (
  overrides?: Partial<CategoryInsert>,
): CategoryInsert => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: `Category ${crypto.randomUUID().slice(0, 8)}`,
    type: "expense",
    usage_count: 0,
    created_by: "00000000-0000-0000-0000-000000000000",
    updated_by: "00000000-0000-0000-0000-000000000000",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
};
