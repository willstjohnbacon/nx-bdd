import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const PLUGIN = '@willstjohnbacon/nx-bdd';
const E2E_APP = 'system-e2e';

/**
 * Exercises the published plugin against a real Nx workspace: a fresh
 * @nx/playwright app, the setup-e2e generator, then an actual bddgen run.
 *
 * Stops short of launching a browser — `playwright test --list` proves the
 * whole chain (config loads, features parse, steps resolve, Playwright
 * discovers the generated specs) without needing browser binaries in CI.
 */
describe('@willstjohnbacon/nx-bdd', () => {
  let projectDirectory: string;

  const run = (command: string) =>
    execSync(command, {
      cwd: projectDirectory,
      stdio: 'pipe',
      env: process.env,
      encoding: 'utf-8',
    });

  const readProjectFile = (relativePath: string) =>
    readFileSync(join(projectDirectory, relativePath), 'utf-8');

  beforeAll(() => {
    projectDirectory = createTestProject();

    // The plugin was built and published to a local registry in globalSetup.
    execSync(`npm install -D ${PLUGIN}@e2e @nx/playwright @playwright/test`, {
      cwd: projectDirectory,
      stdio: 'inherit',
      env: process.env,
    });

    // Nx 23 has no `@nx/playwright:app` generator — a standalone system-e2e app
    // is a plain project shell that @nx/playwright:configuration then targets.
    mkdirSync(join(projectDirectory, `apps/${E2E_APP}`), { recursive: true });
    writeFileSync(
      join(projectDirectory, `apps/${E2E_APP}/project.json`),
      JSON.stringify(
        {
          name: E2E_APP,
          projectType: 'application',
          sourceRoot: `apps/${E2E_APP}/src`,
          targets: {},
        },
        null,
        2
      )
    );

    run(
      `npx nx g @nx/playwright:configuration --project=${E2E_APP} --linter=none --skipInstall --no-interactive`
    );
    run(`npx nx g ${PLUGIN}:setup-e2e --project=${E2E_APP} --no-interactive`);
  }, 900_000);

  afterAll(() => {
    if (projectDirectory) {
      rmSync(projectDirectory, { recursive: true, force: true });
    }
  });

  it('installs cleanly', () => {
    // npm ls fails if the package tree is not satisfied.
    expect(() => run(`npm ls ${PLUGIN}`)).not.toThrow();
  });

  it('installs the BDD and Allure toolchain, but not the standalone Cucumber runner', () => {
    const { devDependencies } = JSON.parse(readProjectFile('package.json'));

    expect(devDependencies['playwright-bdd']).toBeDefined();
    expect(devDependencies['allure-playwright']).toBeDefined();
    expect(devDependencies['allure']).toBeDefined();
    expect(devDependencies['@cucumber/cucumber']).toBeUndefined();
  });

  it('scaffolds the standard BDD structure', () => {
    expect(
      existsSync(join(projectDirectory, `apps/${E2E_APP}/src/features`))
    ).toBe(true);
    expect(readProjectFile(`apps/${E2E_APP}/src/steps/index.ts`)).toContain(
      `${PLUGIN}/steps`
    );
  });

  it('replaces the Playwright config with the BDD + Allure one', () => {
    // @nx/playwright generates .mts, so that is the file the generator targets.
    const config = readProjectFile(`apps/${E2E_APP}/playwright.config.mts`);

    expect(config).toContain('defineBddConfig');
    expect(config).toContain('allure-playwright');
    expect(existsSync(join(projectDirectory, `apps/${E2E_APP}/playwright.config.ts`))).toBe(false);
  });

  it('compiles feature files into runnable Playwright tests', () => {
    writeFileSync(
      join(projectDirectory, `apps/${E2E_APP}/src/features/smoke.feature`),
      [
        'Feature: Toolchain smoke test',
        '  Scenario: The shared steps are wired up',
        '    Given I am on the "/" page',
        '',
      ].join('\n')
    );

    run(`npx nx run ${E2E_APP}:bddgen`);

    const generated = join(
      projectDirectory,
      `apps/${E2E_APP}/.features-gen/src/features/smoke.feature.spec.js`
    );
    expect(existsSync(generated)).toBe(true);

    // Playwright discovering the scenario proves the config, the generated
    // specs and the shared step definitions all resolve together.
    const listed = execSync(
      `npx playwright test --config playwright.config.mts --list`,
      {
        cwd: join(projectDirectory, `apps/${E2E_APP}`),
        env: process.env,
        encoding: 'utf-8',
      }
    );
    expect(listed).toContain('The shared steps are wired up');
  }, 300_000);
});

/**
 * Creates a test workspace with create-nx-workspace.
 * @returns The directory where the test project was created
 */
function createTestProject() {
  const projectName = 'test-project';
  const projectDirectory = join(process.cwd(), 'tmp', projectName);

  rmSync(projectDirectory, { recursive: true, force: true });
  mkdirSync(dirname(projectDirectory), { recursive: true });

  execSync(
    `npx create-nx-workspace@latest ${projectName} --preset apps --nxCloud=skip --no-interactive`,
    {
      cwd: dirname(projectDirectory),
      stdio: 'inherit',
      env: process.env,
    }
  );
  console.log(`Created test project in "${projectDirectory}"`);

  return projectDirectory;
}
