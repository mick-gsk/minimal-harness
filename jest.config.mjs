/**
 * Jest config for TypeScript + native ESM.
 * The source uses `.js` import specifiers (NodeNext style), so relative
 * specifiers are mapped back to their extensionless form for resolution.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        // Behaviour tests, not a type-check gate. `isolatedModules` lives in
        // tsconfig.json; ts-jest picks it up and transpiles per-file (fast).
        useESM: true,
      },
    ],
  },
  testMatch: ["**/tests/**/*.test.ts"],
};
