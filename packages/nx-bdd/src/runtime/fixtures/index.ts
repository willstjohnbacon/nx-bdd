/**
 * Shared Playwright fixtures for organisational BDD suites.
 *
 * `test` here extends playwright-bdd's base test, so the `Given` / `When` /
 * `Then` exported below are bound to these fixtures. Step definitions in
 * consuming apps should import them from `@willstjohnbacon/nx-bdd/fixtures`
 * rather than calling `createBdd()` themselves — otherwise the shared
 * fixtures are not visible to their steps.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createBdd, test as bddBase } from 'playwright-bdd';

export interface Credentials {
  username: string;
  password: string;
}

/**
 * Performs a login on `page`. Each app supplies its own implementation, since
 * only the app knows whether it authenticates through a form, an SSO redirect
 * or a token endpoint.
 */
export type AuthenticateFn = (
  page: Page,
  credentials: Credentials
) => Promise<void>;

/** Collects teardown work to run after the current scenario, LIFO. */
export interface CleanupRegistry {
  add(task: () => void | Promise<void>): void;
}

/** Options every consuming app can set via `use: {}` in playwright.config.ts. */
export interface NxBddOptions {
  /** Base URL of the microservice API backing the suite. */
  apiBaseUrl: string;
  /** Known test accounts, keyed by role name. */
  credentials: Record<string, Credentials>;
  /** Which key of `credentials` the "admin" fixtures and steps use. */
  adminRole: string;
  /** Path to a saved storage state, used in place of logging in. */
  adminStorageState: string | undefined;
  /** How this app logs a user in. Required unless `adminStorageState` is set. */
  authenticate: AuthenticateFn | undefined;
}

export interface NxBddFixtures {
  /** A browser context already authenticated as `adminRole`. */
  adminContext: BrowserContext;
  /** A page inside {@link NxBddFixtures.adminContext}. */
  adminPage: Page;
  /** Registers teardown work (database rows, seeded fixtures, uploads). */
  cleanup: CleanupRegistry;
  /** Authenticates the ambient `page` as the given role. */
  loginAs: (role: string) => Promise<void>;
}

const CONFIG_HINT = `Set it in your playwright.config.ts:

  import { defineConfig } from '@playwright/test';

  export default defineConfig({
    use: {
      authenticate: async (page, { username, password }) => {
        await page.goto('/login');
        await page.getByLabel('Username').fill(username);
        await page.getByLabel('Password').fill(password);
        await page.getByRole('button', { name: 'Sign in' }).click();
      },
    },
  });`;

function requireCredentials(
  credentials: Record<string, Credentials>,
  role: string
): Credentials {
  const found = credentials[role];
  if (!found) {
    const known = Object.keys(credentials);
    throw new Error(
      `[@willstjohnbacon/nx-bdd] No credentials registered for role "${role}". ` +
        `Known roles: ${known.length ? known.join(', ') : '(none)'}. ` +
        `Add them under \`use: { credentials: { ${role}: { username, password } } }\`.`
    );
  }
  return found;
}

function requireAuthenticate(
  authenticate: AuthenticateFn | undefined
): AuthenticateFn {
  if (!authenticate) {
    throw new Error(
      `[@willstjohnbacon/nx-bdd] This suite needs an \`authenticate\` function ` +
        `to log a user in.\n\n${CONFIG_HINT}`
    );
  }
  return authenticate;
}

export const test = bddBase.extend<NxBddOptions & NxBddFixtures>({
  apiBaseUrl: ['http://localhost:3000/api', { option: true }],
  credentials: [{}, { option: true }],
  adminRole: ['admin', { option: true }],
  adminStorageState: [undefined, { option: true }],
  authenticate: [undefined, { option: true }],

  adminContext: async (
    { browser, adminStorageState, adminRole, credentials, authenticate },
    use
  ) => {
    const context = await browser.newContext(
      adminStorageState ? { storageState: adminStorageState } : {}
    );

    // With no saved state to restore, log in once so the context — and every
    // page opened from it — starts out authenticated.
    if (!adminStorageState) {
      const page = await context.newPage();
      try {
        await requireAuthenticate(authenticate)(
          page,
          requireCredentials(credentials, adminRole)
        );
      } finally {
        await page.close();
      }
    }

    await use(context);
    await context.close();
  },

  adminPage: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await use(page);
    await page.close();
  },

  // eslint-disable-next-line no-empty-pattern
  cleanup: async ({}, use) => {
    const tasks: Array<() => void | Promise<void>> = [];

    await use({
      add: (task) => {
        tasks.push(task);
      },
    });

    // Reverse order, so a scenario tears down in the opposite order it built up.
    const failures: unknown[] = [];
    for (const task of tasks.reverse()) {
      try {
        await task();
      } catch (error) {
        failures.push(error);
      }
    }

    // Run every task before surfacing failures, so one bad teardown does not
    // leave the rest of the scenario's data behind.
    if (failures.length) {
      const details = failures
        .map(
          (error, index) =>
            `  ${index + 1}. ${error instanceof Error ? error.message : String(error)}`
        )
        .join('\n');
      throw new Error(
        `[@willstjohnbacon/nx-bdd] ${failures.length} cleanup task(s) failed:\n${details}`
      );
    }
  },

  loginAs: async ({ page, credentials, authenticate }, use) => {
    await use(async (role: string) => {
      await requireAuthenticate(authenticate)(
        page,
        requireCredentials(credentials, role)
      );
    });
  },
});

export const {
  Given,
  When,
  Then,
  Step,
  Before,
  After,
  BeforeAll,
  AfterAll,
  BeforeScenario,
  AfterScenario,
  BeforeWorker,
  AfterWorker,
  BeforeStep,
  AfterStep,
} = createBdd(test);

export { expect };
