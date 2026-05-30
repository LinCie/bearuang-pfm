// Secrets set via `wrangler secret put` are not included in the generated
// worker-configuration.d.ts. Augment the Env interface here.
interface Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
