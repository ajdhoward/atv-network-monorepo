import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".wrangler/**", "pnpm-lock.yaml"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The wire payloads and KV reads are genuinely unknown until validated;
      // narrowing happens in the handlers.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/tv-client/src/**/*"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*", "*.mjs", "*.config.mjs"],
    languageOptions: { globals: globals.node },
  },
);
