import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

const typeCheckedFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

const strictTypeCheckedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked.filter(
    (config) => config.name === "typescript-eslint/stylistic-type-checked",
  ),
].map((config) => ({
  ...config,
  files: typeCheckedFiles,
}));

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  {
    name: "@repo/eslint-config/typescript-project-service",
    files: typeCheckedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  ...strictTypeCheckedConfigs,
  eslintConfigPrettier,
  {
    name: "@repo/eslint-config/turbo",
    plugins: {
      turbo: turboPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "turbo/no-undeclared-env-vars": "error",
    },
  },
  {
    ignores: ["dist/**"],
  },
];
