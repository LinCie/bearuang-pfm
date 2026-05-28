import { env } from "cloudflare:test";

export const createTestEnv = () => env;

export const seedUser = () => {
  return {
    id: "stub-user-id",
    email: "user@example.com",
  };
};
