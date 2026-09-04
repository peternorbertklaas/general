// ESLint flat config for the DERIVA monorepo (TypeScript, React).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/*.d.ts", "apps/web/e2e-screenshots/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  // Type-aware rules (review R8, N4-03 rest) for the pricing core, the API and – since round 9 – the web app:
  // `recommendedTypeChecked` on top of `recommended`, fed by the packages' own tsconfigs (`projectService`). The rules
  // that matter are `no-floating-promises` / `no-misused-promises` (Fastify hooks, async route handlers, React effects
  // and event handlers) and the `no-unsafe-*` family at the JSON boundaries (API bodies, localStorage, file imports).
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["apps/api/src/**/*.ts", "packages/pricing-core/src/**/*.ts", "apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
  })),
  {
    files: ["apps/api/src/**/*.ts", "packages/pricing-core/src/**/*.ts", "apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Template literals carry ids, codes and numbers by design (`${curveId}`, `${pv}`); the default forbids numbers.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: false, allowRegExp: false, allowAny: false },
      ],
      // `String(x)` on unknown input is the deliberate way error texts quote client data.
      "@typescript-eslint/no-base-to-string": "off",
      // Fastify's `async` route handlers return values without awaiting; `require-await` would demand a fake `await`.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Web app (review R9, N4-03 rest): the typed set with two pragmatic settings. Nullish template expressions are
    // idiomatic in the German UI texts (`${t.name ?? t.id}` is the exception, `${meta?.label}` the rule – 200+ sites),
    // so `allowNullish` is on like in the pricing core; `no-unnecessary-type-assertion` stays on for sources (autofixed
    // in round 9) and is parked for the tests together with `unbound-method` (testing-library's `screen.getBy*` are
    // unbound by design). Everything else – `no-floating-promises`, `no-misused-promises`, the `no-unsafe-*` family,
    // `no-implied-eval`, `no-duplicate-type-constituents` – is enforced in sources and tests alike.
    files: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowRegExp: false, allowAny: false },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.test.ts", "apps/web/src/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // Tests use vitest's loosely typed `.json()` results; the unsafe-* family would drown the assertions in casts.
    files: ["apps/api/src/**/*.test.ts", "packages/pricing-core/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowRegExp: false, allowAny: true },
      ],
      // `(await r).json() as Foo` is how the tests type Fastify's `any` responses; the rule would strip the casts and leave `any`.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    // Pricing core (owned by the core workstream, not touched in the API/CI round that introduced typed lint): three
    // rules with existing findings are parked here instead of being fixed across 30 files – `no-unnecessary-type-assertion`
    // (13 + 17 in tests, autofixable), `no-redundant-type-constituents` (19, `TradeType | string` unions in labels/reporting)
    // and nullable template expressions (12 + 2). Everything else of `recommendedTypeChecked` – `no-floating-promises`,
    // `no-misused-promises`, `await-thenable`, `only-throw-error`, the `no-unsafe-*` family – is enforced. Re-enable
    // the three when the core round picks them up (CONTRIBUTING „Lint“).
    files: ["packages/pricing-core/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true, allowRegExp: false, allowAny: false },
      ],
    },
  },
  {
    // React hooks discipline for the web app only (arch N4-03): the rules of hooks are errors, stale
    // dependency lists are warnings – and the lint gate runs with `--max-warnings 0`, so both block.
    files: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/e2e/**", "apps/web/scripts/**"],
    rules: { "no-console": "off" },
  },
);
