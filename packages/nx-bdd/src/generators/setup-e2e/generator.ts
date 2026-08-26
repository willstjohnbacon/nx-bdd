import {
  addDependenciesToPackageJson,
  formatFiles,
  generateFiles,
  joinPathFragments,
  logger,
  readJson,
  readProjectConfiguration,
  updateJson,
  updateProjectConfiguration,
  type GeneratorCallback,
  type NxJsonConfiguration,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
} from '@nx/devkit';
import * as path from 'path';
import type { SetupE2eGeneratorSchema } from './schema';

/**
 * Pinned in one place so a toolchain bump is a single edit.
 *
 * `@cucumber/cucumber` is deliberately absent: playwright-bdd vendors the
 * `@cucumber/*` packages it needs (gherkin, messages, tag-expressions) and
 * never loads the standalone Cucumber runner. Installing it only invites step
 * definitions that register with a runner nothing executes.
 */
const DEV_DEPENDENCIES: Record<string, string> = {
  'playwright-bdd': '^9.2.0',
  'allure-playwright': '^3.11.0',
  // Allure 3's report generator, which is pure Node. The older
  // `allure-commandline` is a wrapper around a Java binary and fails outright
  // on any machine or CI runner without a JRE on PATH.
  allure: '^3.16.0',
  '@playwright/test': '^1.62.1',
};

const ESM_CONFIG = 'playwright.config.mts';
const CJS_CONFIG = 'playwright.config.ts';

const DEFAULT_FEATURES_GLOB = 'src/features/**/*.feature';
const DEFAULT_STEPS_GLOB = 'src/steps/**/*.ts';

export async function setupE2eGenerator(
  tree: Tree,
  options: SetupE2eGeneratorSchema
): Promise<GeneratorCallback> {
  const {
    project,
    featuresGlob = DEFAULT_FEATURES_GLOB,
    stepsGlob = DEFAULT_STEPS_GLOB,
    skipFormat = false,
    skipPackageJson = false,
  } = options;

  const projectConfig = readProjectConfiguration(tree, project);
  const projectRoot = projectConfig.root;

  // 1. Inject the BDD and reporting dependencies. Existing versions are kept,
  //    so a team already on a newer Playwright is never silently downgraded.
  let installTask: GeneratorCallback = () => {
    // No dependency changes were requested, so there is nothing to install.
  };
  if (skipPackageJson) {
    // @nx/playwright/plugin infers targets by *loading* the Playwright config,
    // and the config this generator writes imports playwright-bdd. Until that
    // package is installed, the project graph cannot be built and every nx
    // command in the workspace fails — not just this project's.
    logger.warn(
      `[nx-bdd] --skipPackageJson was passed. Install ${Object.keys(
        DEV_DEPENDENCIES
      ).join(', ')} before running any further nx command, or the project ` +
        `graph will fail to load.`
    );
  } else {
    installTask = addDependenciesToPackageJson(
      tree,
      {},
      DEV_DEPENDENCIES,
      undefined,
      true
    );
  }

  // 2. Scaffold the unified Playwright + playwright-bdd + Allure configuration.
  const configFileName = writePlaywrightConfig(tree, projectRoot, {
    project,
    featuresGlob,
    stepsGlob,
  });

  // 3. Create the standardised BDD directory structure.
  writeBddDirectories(tree, projectRoot);

  // 4. Make `nx e2e <project>` regenerate the Playwright specs from the
  //    feature files first — playwright-bdd has no watch hook into the runner.
  addBddGenTarget(tree, projectConfig, project, configFileName);

  // 5. Keep the generated specs out of version control.
  ignoreGeneratedArtifacts(tree);

  if (!skipFormat) {
    await formatFiles(tree);
  }

  logger.info(
    `\nBDD architecture applied to "${project}".\n` +
      `  1. Add feature files to ${projectRoot}/src/features/\n` +
      `  2. Add step definitions to ${projectRoot}/src/steps/\n` +
      `  3. Fill in the \`authenticate\` option in ${projectRoot}/${configFileName}\n` +
      `  4. Run: nx e2e ${project}\n`
  );

  return installTask;
}

/**
 * Writes the config next to whatever module flavour the app already uses.
 * `@nx/playwright` generates `.mts` so the config loads as ESM regardless of
 * the workspace's `type` field; writing a `.ts` alongside it would silently
 * shadow it, since Playwright probes `.ts` before `.mts`.
 *
 * @returns the file name that was written.
 */
function writePlaywrightConfig(
  tree: Tree,
  projectRoot: string,
  substitutions: Record<string, string>
): string {
  const hasEsm = tree.exists(joinPathFragments(projectRoot, ESM_CONFIG));
  const hasCjs = tree.exists(joinPathFragments(projectRoot, CJS_CONFIG));

  if (hasEsm && hasCjs) {
    logger.warn(
      `[nx-bdd] ${projectRoot} has both ${CJS_CONFIG} and ${ESM_CONFIG}. ` +
        `Playwright resolves ${CJS_CONFIG} first, so that is the one being ` +
        `configured — delete ${ESM_CONFIG} to avoid confusion.`
    );
  }

  const configFileName = hasEsm && !hasCjs ? ESM_CONFIG : CJS_CONFIG;

  if (hasEsm || hasCjs) {
    logger.warn(
      `[nx-bdd] Replacing the existing ${configFileName} in ${projectRoot}. ` +
        `Re-apply any webServer, projects, timeout or reporter settings you ` +
        `had customised — they are not carried over.`
    );
  }

  generateFiles(
    tree,
    path.join(__dirname, 'files'),
    projectRoot,
    substitutions
  );

  // The template ships as .ts; rename when the app is on the .mts convention.
  if (configFileName !== CJS_CONFIG) {
    tree.rename(
      joinPathFragments(projectRoot, CJS_CONFIG),
      joinPathFragments(projectRoot, configFileName)
    );
  }

  return configFileName;
}

function writeBddDirectories(tree: Tree, projectRoot: string): void {
  const featuresKeep = joinPathFragments(projectRoot, 'src/features/.gitkeep');
  if (!tree.exists(featuresKeep)) {
    tree.write(featuresKeep, '');
  }

  // Never clobber an app's own step barrel — it may already re-export local steps.
  const stepsIndex = joinPathFragments(projectRoot, 'src/steps/index.ts');
  if (!tree.exists(stepsIndex)) {
    tree.write(
      stepsIndex,
      `// Import shared organizational step definitions
export * from '@willstjohnbacon/nx-bdd/steps';
`
    );
  }
}

function addBddGenTarget(
  tree: Tree,
  projectConfig: ProjectConfiguration,
  projectName: string,
  configFileName: string
): void {
  const projectRoot = projectConfig.root;

  const bddgen: TargetConfiguration = {
    executor: 'nx:run-commands',
    cache: true,
    inputs: ['default', '^production'],
    outputs: ['{projectRoot}/.features-gen'],
    options: {
      command: `bddgen --config ${configFileName}`,
      cwd: projectRoot,
    },
  };

  // readProjectConfiguration only reads project.json / package.json — Nx
  // deliberately leaves plugin-inferred targets out of the generator view. So
  // an `e2e` target may already exist without being visible here; the nx.json
  // plugin registration is the only signal a generator gets.
  const willInferE2e =
    hasExplicitE2eTarget(projectConfig) || hasPlaywrightPlugin(tree);

  const applyTo = (targets: Record<string, TargetConfiguration>) => {
    targets.bddgen = bddgen;

    if (!willInferE2e) {
      // Nothing would supply an executor, and a dependsOn-only entry makes
      // `nx e2e` fail with "target has no executor". Define the whole target.
      targets.e2e = {
        executor: 'nx:run-commands',
        dependsOn: ['bddgen'],
        outputs: ['{projectRoot}/test-results', '{projectRoot}/playwright-report'],
        options: {
          command: `playwright test --config ${configFileName}`,
          cwd: projectRoot,
        },
      };
      return;
    }

    // Otherwise the executor comes from the inferred target and the only thing
    // project.json needs to contribute is the extra dependsOn edge.
    targets.e2e = {
      ...targets.e2e,
      dependsOn: withBddGen(targets.e2e?.dependsOn ?? []),
    };
  };

  // Prefer editing the on-disk config directly. Writing back the merged
  // configuration from readProjectConfiguration would freeze every inferred
  // target into project.json.
  const projectJsonPath = joinPathFragments(projectRoot, 'project.json');
  if (tree.exists(projectJsonPath)) {
    updateJson(tree, projectJsonPath, (json) => {
      json.targets ??= {};
      applyTo(json.targets);
      return json;
    });
    return;
  }

  const packageJsonPath = joinPathFragments(projectRoot, 'package.json');
  if (tree.exists(packageJsonPath)) {
    updateJson(tree, packageJsonPath, (json) => {
      json.nx ??= {};
      json.nx.targets ??= {};
      applyTo(json.nx.targets);
      return json;
    });
    return;
  }

  const targets = { ...projectConfig.targets };
  applyTo(targets);
  updateProjectConfiguration(tree, projectName, { ...projectConfig, targets });
}

function withBddGen(
  dependsOn: NonNullable<TargetConfiguration['dependsOn']>
): TargetConfiguration['dependsOn'] {
  const seen = new Set<string>();
  const deduped = dependsOn.filter((dependency) => {
    const key = JSON.stringify(dependency);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const alreadyPresent = deduped.some((dependency) =>
    typeof dependency === 'string'
      ? dependency === 'bddgen'
      : dependency?.target === 'bddgen'
  );
  return alreadyPresent ? deduped : [...deduped, 'bddgen'];
}

function hasExplicitE2eTarget(projectConfig: ProjectConfiguration): boolean {
  return Boolean(projectConfig.targets?.e2e);
}

/**
 * A registered @nx/playwright/plugin infers an `e2e` target from the presence
 * of a Playwright config — which this generator is about to write.
 */
function hasPlaywrightPlugin(tree: Tree): boolean {
  if (!tree.exists('nx.json')) {
    return false;
  }

  const { plugins = [] } = readJson<NxJsonConfiguration>(tree, 'nx.json');
  return plugins.some((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.plugin;
    return typeof name === 'string' && name.startsWith('@nx/playwright');
  });
}

function ignoreGeneratedArtifacts(tree: Tree): void {
  const gitignorePath = '.gitignore';
  if (!tree.exists(gitignorePath)) {
    return;
  }

  const contents = tree.read(gitignorePath, 'utf-8') ?? '';
  const lines = contents.split('\n').map((line) => line.trim());
  const missing = ['.features-gen', 'allure-results', 'allure-report'].filter(
    (entry) => !lines.includes(entry)
  );

  if (!missing.length) {
    return;
  }

  tree.write(
    gitignorePath,
    `${contents.replace(/\n*$/, '')}\n\n# @willstjohnbacon/nx-bdd\n${missing.join('\n')}\n`
  );
}

export default setupE2eGenerator;
