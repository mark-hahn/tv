const globals = require("globals");
const js = require("@eslint/js");

module.exports = [
  {
    // Global ignores must be in their own object at the start
    ignores: [
      "apps/client/**",
      "**/node_modules/**",
      "dist/**",
      "coverage/**",
      ".turbo/**",
    ],
  },
  js.configs.recommended,
  {
    // Lint all JS/MJS/CJS in the workspace
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-unreachable": "error",
      "no-empty": "warn",
      "no-useless-escape": "warn",

      // Async/Await Rules
      "require-await": "warn",
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "error",
      "require-atomic-updates": "warn",
      "no-await-in-loop": "warn",
    },
  },
];
