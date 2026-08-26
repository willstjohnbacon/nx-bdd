# @willstjohnbacon/nx-bdd

Provisions any Nx project with the standard organisational Cucumber BDD and Allure reporting architecture.

It is designed to sit alongside our NestJS microservices and Angular frontends, ensuring End-to-End state and mocks are perfectly aligned. Every suite in the workspace shares one Playwright configuration shape, one set of fixtures, one set of base steps and one Allure results directory.

## What you get

| Piece | What it does |
| --- | --- |
| `setup-e2e` generator | Writes the Playwright + `playwright-bdd` + Allure config, the `features/` and `steps/` folders, and a `bddgen` target wired into `e2e`. |
| `@willstjohnbacon/nx-bdd/fixtures` | The shared `test` object, plus `Given` / `When` / `Then` bound to it. |
| `@willstjohnbacon/nx-bdd/steps` | Base step definitions every suite inherits. |
| `@willstjohnbacon/nx-bdd/factories` | Deterministic data factories (`UserFactory`, `OrganisationFactory`, `defineFactory`). |

## Step 1: Install the plugin

```bash
npm install -D @willstjohnbacon/nx-bdd
```

## Step 2: Create a system E2E app

Add Playwright to the workspace once:

```bash
nx add @nx/playwright
```

To attach a BDD suite to an existing project, generate a Playwright configuration for it:

```bash
nx g @nx/playwright:configuration --project=my-app
```

For a standalone orchestrating suite, create the project shell first — Nx has no
`@nx/playwright:app` generator, a standalone e2e app is just a project:

```bash
mkdir -p apps/system-e2e
cat > apps/system-e2e/project.json <<'JSON'
{
  "name": "system-e2e",
  "projectType": "application",
  "sourceRoot": "apps/system-e2e/src",
  "targets": {}
}
JSON
```

## Step 3: Apply the BDD architecture

```bash
nx g @willstjohnbacon/nx-bdd:setup-e2e --project=system-e2e
```

This writes the unified `playwright.config.ts` (or `.mts`, matching whatever the project already uses), creates `src/features/` and `src/steps/`, adds a `bddgen` target that `e2e` depends on, and installs `playwright-bdd`, `allure-playwright` and `allure`.

### The `e2e` and `bddgen` targets

Feature files are not tests until `bddgen` compiles them, so the generator adds a
`bddgen` target and makes `e2e` depend on it.

- If `@nx/playwright/plugin` is registered in `nx.json`, the `e2e` target is
  inferred from your Playwright config and the generator contributes only the
  `dependsOn: ["bddgen"]` edge.
- If nothing would supply an `e2e` target, the generator defines a complete one
  that runs `playwright test` directly, so `nx e2e <project>` works immediately.

> **Note:** Nx does not expose plugin-inferred targets to generators, so a
> `dependsOn` written into `project.json` replaces — rather than merges with —
> any `dependsOn` that `@nx/playwright/plugin` infers for a `webServer`. If you
> add a `webServer` block whose command is an `nx run …` task, re-add that
> dependency to `e2e.dependsOn` alongside `bddgen` yourself.

> **Heads up:** the generator replaces the project's Playwright config outright. Re-apply any `webServer`, `projects` or timeout settings you had customised — they are not carried over.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--project` | *(required)* | The Nx project to configure. |
| `--featuresGlob` | `src/features/**/*.feature` | Where feature files live, relative to the project root. |
| `--stepsGlob` | `src/steps/**/*.ts` | Where step definitions live, relative to the project root. |
| `--skipFormat` | `false` | Skip formatting generated files. |
| `--skipPackageJson` | `false` | Skip adding dependencies. |

## Step 4: Writing tests

1. Add your Cucumber `.feature` files in `apps/system-e2e/src/features/`.
2. Add step definitions in `apps/system-e2e/src/steps/`.
3. Import organisational fixtures directly from the plugin runtime.

```typescript
// apps/system-e2e/src/steps/login.steps.ts
import { Given, Then, expect } from '@willstjohnbacon/nx-bdd/fixtures';
import { UserFactory } from '@willstjohnbacon/nx-bdd/factories';

Given('I am viewing the dashboard as an admin', async ({ adminPage }) => {
  // adminPage is an automatically authenticated browser page provided by the
  // @willstjohnbacon/nx-bdd shared fixtures.
  await adminPage.goto('/dashboard');
});

Then('I can see my own account', async ({ page, cleanup }) => {
  const user = UserFactory.build({ roles: ['admin'] });
  cleanup.add(() => deleteUser(user.id));

  await expect(page.getByText(user.email)).toBeVisible();
});
```

Import `Given` / `When` / `Then` from **`@willstjohnbacon/nx-bdd/fixtures`**, not from `@cucumber/cucumber`. `playwright-bdd` compiles feature files into native Playwright tests and runs them on the Playwright runner; the standalone Cucumber runner is never involved, and steps registered with it would never execute.

### The shared fixtures

| Fixture | Type | What it gives you |
| --- | --- | --- |
| `adminContext` | `BrowserContext` | A context already authenticated as the admin role. |
| `adminPage` | `Page` | A page inside `adminContext`. |
| `loginAs(role)` | `(role: string) => Promise<void>` | Authenticates the ambient `page` as a named role. |
| `cleanup` | `CleanupRegistry` | `cleanup.add(fn)` — teardown work run after the scenario, in reverse order. |
| `apiBaseUrl` | `string` | Base URL of the microservice API under test. |

Configure them under `use` in the generated config:

```typescript
export default defineConfig<NxBddOptions>({
  use: {
    apiBaseUrl: process.env['API_BASE_URL'] || 'http://localhost:3000/api',
    credentials: {
      admin: { username: 'admin', password: 'admin' },
      auditor: { username: 'auditor', password: 'auditor' },
    },
    // How this app signs a user in — required by loginAs / adminContext.
    authenticate: async (page, { username, password }) => {
      await page.goto('/login');
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/dashboard');
    },
  },
});
```

Set `adminStorageState` to a saved storage-state file to skip the login round trip entirely.

### Base steps you inherit

`src/steps/index.ts` re-exports `@willstjohnbacon/nx-bdd/steps`, which registers:

```gherkin
Given I am on the "{string}" page
Given I am logged in as an admin
Given I am logged in as "{string}"
When I navigate to "{string}"
When I click "{string}"
When I fill in "{string}" with "{string}"
Then I should see "{string}"
Then I should not see "{string}"
Then I should be on the "{string}" page
Then the page title should be "{string}"
```

### Adding your own factories

```typescript
import { defineFactory } from '@willstjohnbacon/nx-bdd/factories';

export const InvoiceFactory = defineFactory<Invoice>((sequence) => ({
  id: `invoice-${sequence}`,
  reference: `INV-${String(sequence).padStart(5, '0')}`,
  total: 0,
}));
```

Factories are deterministic and sequence-based. Sequences are per-process, so call `reset()` between suites that assert on generated ids.

## Step 5: Unified reporting

Feature files are compiled to Playwright tests by `bddgen`, which the generator wires in as a dependency of `e2e` — so `nx e2e` picks up new scenarios on its own.

```bash
nx run-many -t test e2e
npx allure generate ./dist/allure-results -o ./dist/allure-report
npx allure open ./dist/allure-report
```

The generator installs the `allure` package — Allure 3's report generator, which
is pure Node. The older `allure-commandline` wraps a Java binary and fails on any
machine or CI runner without a JRE on `PATH`. Note the Allure 3 CLI has no
`--clean` flag; pass `-o` to choose the output directory.

Every project writes into the workspace-level `dist/allure-results`, so one `allure generate` covers unit, microservice API and BDD E2E runs together. The config anchors that path on `workspaceRoot` rather than a relative path, because Allure resolves reporter paths against `process.cwd()` — which differs between Nx's inferred Playwright targets and the legacy `@nx/playwright:playwright` executor.

## Troubleshooting

**`First argument must use the object destructuring pattern`** — a step was written as `async (fixtures) => {}`. `playwright-bdd` discovers fixtures by parsing the function source, so the first parameter must be destructured: `async ({ page }) => {}`.

**`No credentials registered for role "x"`** — add the role under `use: { credentials: {} }` in the Playwright config.

**Every `nx` command fails with `Cannot find module 'playwright-bdd'`** — `@nx/playwright/plugin` infers targets by loading your Playwright config, and that config imports `playwright-bdd`. If the dependency is missing, the project graph cannot be built and the whole workspace is blocked. Run `npm install`. This is why `--skipPackageJson` requires you to install the toolchain yourself straight away.

**Scenarios do not appear after editing a feature file** — run `nx run <project>:bddgen`, or just `nx e2e <project>`, which depends on it.
