import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { defineConfig, devices } from '@playwright/test';
import type { NxBddOptions } from '@willstjohnbacon/nx-bdd';
import { defineBddConfig } from 'playwright-bdd';

// Compiles Cucumber feature files into native Playwright tests.
// Run `nx run demo-e2e:bddgen` (or just `nx e2e demo-e2e`, which
// depends on it) after adding or renaming a .feature file.
const testDir = defineBddConfig({
  features: 'src/features/**/*.feature',
  steps: 'src/steps/**/*.ts',
});

// For CI, set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://127.0.0.1:4300';

// Reporter option paths are resolved against process.cwd(), which differs
// between Nx's inferred Playwright targets (project root) and the legacy
// @nx/playwright:playwright executor (workspace root). Anchoring on
// workspaceRoot puts every project's results in one directory either way, so a
// single `allure generate` covers unit, API and E2E runs together.
const allureResultsDir = join(workspaceRoot, 'dist', 'allure-results');

export default defineConfig<NxBddOptions>({
  testDir,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['allure-playwright', { resultsDir: allureResultsDir }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // --- Shared @willstjohnbacon/nx-bdd fixture options ---
    apiBaseUrl: process.env['API_BASE_URL'] || 'http://127.0.0.1:4300/api',
    credentials: {
      admin: {
        username: process.env['E2E_ADMIN_USERNAME'] || 'admin',
        password: process.env['E2E_ADMIN_PASSWORD'] || 'admin',
      },
      viewer: { username: 'viewer', password: 'viewer' },
    },
    // Teach the shared `loginAs` / `adminContext` fixtures how this app signs a
    // user in. This is the one piece every consuming app has to supply.
    //
    // Wrapped in an object: Playwright treats a bare function under `use` as
    // a fixture override (with the `({ fixtures }, use) => {}` signature)
    // rather than as an option's value, so the callback can't be assigned
    // directly here.
    authenticate: {
      fn: async (page, { username, password }) => {
        await page.goto('/login');
        await page.getByLabel('Username').fill(username);
        await page.getByLabel('Password').fill(password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await page.waitForURL('**/dashboard');
      },
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Start the stack under test before the suite runs.
  webServer: {
    command: 'npx nx serve demo-app',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    cwd: workspaceRoot,
  },
});
