import { config } from "@repo/eslint-config/base";

export default [
  ...config,
  {
    ignores: ["worker-configuration.d.ts", ".wrangler/**"],
  },
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/services/**",
                "**/routes/**",
                "../services/*",
                "../routes/*",
                "../../services/*",
                "../../routes/*",
              ],
              message: "lib/ must not import from services/ or routes/",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      // cloudflare:test is a virtual module resolved only at runtime by Miniflare;
      // ESLint's static analysis cannot resolve it, so unsafe-* rules produce false positives.
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
];
