import type { InferInsertModel } from "drizzle-orm";
import * as schema from "../../src/db/schema/index";

type UserInsert = InferInsertModel<typeof schema.users>;
type SettingsInsert = InferInsertModel<typeof schema.settings>;
type CategoryInsert = InferInsertModel<typeof schema.categories>;
type AccountInsert = InferInsertModel<typeof schema.accounts>;
type TransactionInsert = InferInsertModel<typeof schema.transactions>;

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

export const accountFactory = (
  overrides?: Partial<AccountInsert>,
): AccountInsert => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: `Account ${crypto.randomUUID().slice(0, 8)}`,
    type: "bank",
    currency: "IDR",
    initial_balance: "0",
    is_active: 1,
    created_by: "00000000-0000-0000-0000-000000000000",
    updated_by: "00000000-0000-0000-0000-000000000000",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
};

export const transactionFactory = (
  overrides?: Partial<TransactionInsert>,
): TransactionInsert => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    type: "expense",
    amount: "0",
    account_id: "00000000-0000-0000-0000-000000000001",
    destination_account_id: null,
    category_id: "00000000-0000-0000-0000-000000000002",
    payee: null,
    notes: null,
    date: new Date().toISOString().slice(0, 10),
    created_by: "00000000-0000-0000-0000-000000000000",
    updated_by: "00000000-0000-0000-0000-000000000000",
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
};
