import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
// Obsidian's plugin guidelines, the same rules its automated review uses.
// Biome (yarn lint) stays the main linter and formatter; this checks
// only what Obsidian's review cares about: yarn lint:obsidian.
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/",
      "src/__tests__/",
      "src/__mocks__/",
      "*.mjs",
      "*.js",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Proper names the default list doesn't know. Obsidian's own review uses
      // the defaults, so it may still show these as warnings.
      "obsidianmd/ui/sentence-case": [
        "warn",
        { brands: [...DEFAULT_BRANDS, "Strava", "OAuth"] },
      ],
    },
  },
]);
