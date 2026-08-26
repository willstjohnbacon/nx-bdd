import {
  addProjectConfiguration,
  readJson,
  updateJson,
  type Tree,
} from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { setupE2eGenerator } from './generator';

const PROJECT = 'system-e2e';
const PROJECT_ROOT = 'apps/system-e2e';

describe('setup-e2e generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, PROJECT, {
      root: PROJECT_ROOT,
      projectType: 'application',
      sourceRoot: `${PROJECT_ROOT}/src`,
      targets: {},
    });
  });

  const read = (relativePath: string) =>
    tree.read(`${PROJECT_ROOT}/${relativePath}`, 'utf-8');

  it('fails with a clear error when the project does not exist', async () => {
    await expect(
      setupE2eGenerator(tree, { project: 'does-not-exist' })
    ).rejects.toThrow(/does-not-exist/);
  });

  describe('playwright configuration', () => {
    it('writes a config wired to playwright-bdd and Allure', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });

      const config = read('playwright.config.ts');
      expect(config).toContain(`from 'playwright-bdd'`);
      expect(config).toContain('defineBddConfig');
      expect(config).toContain(`'src/features/**/*.feature'`);
      expect(config).toContain(`'src/steps/**/*.ts'`);
      expect(config).toContain('allure-playwright');
      expect(config).toContain('trace:');
      expect(config).toContain('screenshot:');
      expect(config).toContain('video:');
    });

    it('anchors the Allure results directory on the workspace root', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });

      // Reporter option paths resolve against process.cwd(), which differs
      // between Nx's inferred targets and the legacy executor.
      const config = read('playwright.config.ts');
      expect(config).toContain(`from '@nx/devkit'`);
      expect(config).toContain(`join(workspaceRoot, 'dist', 'allure-results')`);
    });

    it('honours custom feature and step globs', async () => {
      await setupE2eGenerator(tree, {
        project: PROJECT,
        featuresGlob: 'src/bdd/**/*.feature',
        stepsGlob: 'src/bdd/steps/**/*.ts',
      });

      const config = read('playwright.config.ts');
      expect(config).toContain(`'src/bdd/**/*.feature'`);
      expect(config).toContain(`'src/bdd/steps/**/*.ts'`);
    });

    it('writes .mts when the app already uses the ESM config convention', async () => {
      // @nx/playwright generates playwright.config.mts; a .ts written beside it
      // would silently shadow it, since Playwright probes .ts first.
      tree.write(`${PROJECT_ROOT}/playwright.config.mts`, '// existing');

      await setupE2eGenerator(tree, { project: PROJECT });

      expect(tree.exists(`${PROJECT_ROOT}/playwright.config.mts`)).toBe(true);
      expect(tree.exists(`${PROJECT_ROOT}/playwright.config.ts`)).toBe(false);
      expect(read('playwright.config.mts')).toContain('defineBddConfig');
    });

    it('replaces an existing .ts config in place', async () => {
      tree.write(`${PROJECT_ROOT}/playwright.config.ts`, '// existing');

      await setupE2eGenerator(tree, { project: PROJECT });

      expect(read('playwright.config.ts')).toContain('defineBddConfig');
    });
  });

  describe('directory structure', () => {
    it('creates the standard features and steps folders', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });

      expect(tree.exists(`${PROJECT_ROOT}/src/features/.gitkeep`)).toBe(true);
      expect(read('src/steps/index.ts')).toContain(
        `@willstjohnbacon/nx-bdd/steps`
      );
    });

    it('leaves an existing step barrel untouched', async () => {
      tree.write(
        `${PROJECT_ROOT}/src/steps/index.ts`,
        `export * from './local.steps';\n`
      );

      await setupE2eGenerator(tree, { project: PROJECT });

      expect(read('src/steps/index.ts')).toContain(`'./local.steps'`);
    });
  });

  describe('dependencies', () => {
    it('adds the BDD and reporting dev dependencies', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });

      const { devDependencies } = readJson(tree, 'package.json');
      expect(devDependencies).toMatchObject({
        'playwright-bdd': expect.any(String),
        'allure-playwright': expect.any(String),
        allure: expect.any(String),
        '@playwright/test': expect.any(String),
      });
    });

    it('does not add the standalone Cucumber runner', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });

      const { dependencies, devDependencies } = readJson(tree, 'package.json');
      expect(devDependencies?.['@cucumber/cucumber']).toBeUndefined();
      expect(dependencies?.['@cucumber/cucumber']).toBeUndefined();
    });

    it('never downgrades a Playwright version the workspace already has', async () => {
      tree.write(
        'package.json',
        JSON.stringify({
          name: 'workspace',
          devDependencies: { '@playwright/test': '^99.0.0' },
        })
      );

      await setupE2eGenerator(tree, { project: PROJECT });

      const { devDependencies } = readJson(tree, 'package.json');
      expect(devDependencies['@playwright/test']).toBe('^99.0.0');
    });

    it('skips package.json changes when asked', async () => {
      await setupE2eGenerator(tree, { project: PROJECT, skipPackageJson: true });

      const { devDependencies } = readJson(tree, 'package.json');
      expect(devDependencies?.['playwright-bdd']).toBeUndefined();
      expect(tree.exists(`${PROJECT_ROOT}/playwright.config.ts`)).toBe(true);
    });
  });

  describe('targets', () => {
    it('adds a bddgen target that e2e depends on', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });

      const { targets } = readJson(tree, `${PROJECT_ROOT}/project.json`);
      expect(targets.bddgen.options.command).toBe(
        'bddgen --config playwright.config.ts'
      );
      expect(targets.bddgen.options.cwd).toBe(PROJECT_ROOT);
      expect(targets.e2e.dependsOn).toContain('bddgen');
    });

    it('defines a runnable e2e target when nothing else would supply one', async () => {
      // Without @nx/playwright/plugin registered, a dependsOn-only entry would
      // leave `nx e2e` failing with "target has no executor".
      await setupE2eGenerator(tree, { project: PROJECT });

      const { targets } = readJson(tree, `${PROJECT_ROOT}/project.json`);
      expect(targets.e2e.executor).toBe('nx:run-commands');
      expect(targets.e2e.options.command).toBe(
        'playwright test --config playwright.config.ts'
      );
      expect(targets.e2e.options.cwd).toBe(PROJECT_ROOT);
    });

    it('leaves the executor to @nx/playwright/plugin when it is registered', async () => {
      updateJson(tree, 'nx.json', (json) => ({
        ...json,
        plugins: [{ plugin: '@nx/playwright/plugin', options: {} }],
      }));

      await setupE2eGenerator(tree, { project: PROJECT });

      const { targets } = readJson(tree, `${PROJECT_ROOT}/project.json`);
      expect(targets.e2e).toEqual({ dependsOn: ['bddgen'] });
    });

    it('points bddgen at the .mts config when that is what was written', async () => {
      tree.write(`${PROJECT_ROOT}/playwright.config.mts`, '// existing');

      await setupE2eGenerator(tree, { project: PROJECT });

      const { targets } = readJson(tree, `${PROJECT_ROOT}/project.json`);
      expect(targets.bddgen.options.command).toBe(
        'bddgen --config playwright.config.mts'
      );
    });

    it('preserves existing e2e configuration and dependsOn entries', async () => {
      addProjectConfiguration(tree, 'other-e2e', {
        root: 'apps/other-e2e',
        targets: {
          e2e: {
            executor: '@nx/playwright:playwright',
            options: { config: 'apps/other-e2e/playwright.config.ts' },
            dependsOn: ['^build'],
          },
        },
      });

      await setupE2eGenerator(tree, { project: 'other-e2e' });

      const { targets } = readJson(tree, 'apps/other-e2e/project.json');
      expect(targets.e2e.executor).toBe('@nx/playwright:playwright');
      expect(targets.e2e.options.config).toBe(
        'apps/other-e2e/playwright.config.ts'
      );
      expect(targets.e2e.dependsOn).toEqual(['^build', 'bddgen']);
    });

    it('keeps a webServer-style object dependency without duplicating it', async () => {
      // @nx/playwright/plugin infers this shape when the config starts a server.
      const webServerDependency = {
        target: 'serve',
        projects: 'my-app',
        params: 'forward' as const,
      };
      addProjectConfiguration(tree, 'served-e2e', {
        root: 'apps/served-e2e',
        targets: { e2e: { dependsOn: [webServerDependency] } },
      });

      await setupE2eGenerator(tree, { project: 'served-e2e' });

      const { targets } = readJson(tree, 'apps/served-e2e/project.json');
      expect(targets.e2e.dependsOn).toEqual([webServerDependency, 'bddgen']);
    });

    it('is idempotent across repeated runs', async () => {
      await setupE2eGenerator(tree, { project: PROJECT });
      await setupE2eGenerator(tree, { project: PROJECT });

      const { targets } = readJson(tree, `${PROJECT_ROOT}/project.json`);
      expect(targets.e2e.dependsOn).toEqual(['bddgen']);
    });
  });

  describe('gitignore', () => {
    it('ignores the generated specs and Allure output', async () => {
      tree.write('.gitignore', 'node_modules\ndist\n');

      await setupE2eGenerator(tree, { project: PROJECT });

      const gitignore = tree.read('.gitignore', 'utf-8');
      expect(gitignore).toContain('.features-gen');
      expect(gitignore).toContain('allure-results');
      expect(gitignore).toContain('allure-report');
      expect(gitignore).toContain('node_modules');
    });

    it('does not duplicate entries that are already ignored', async () => {
      tree.write('.gitignore', 'node_modules\n.features-gen\n');

      await setupE2eGenerator(tree, { project: PROJECT });

      const gitignore = tree.read('.gitignore', 'utf-8') ?? '';
      expect(gitignore.match(/\.features-gen/g)).toHaveLength(1);
    });
  });
});
