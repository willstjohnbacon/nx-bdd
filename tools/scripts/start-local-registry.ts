/**
 * This script starts a local registry for e2e testing purposes.
 * It is meant to be called in jest's globalSetup.
 */

/// <reference path="registry.d.ts" />

import { execSync, fork } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { releasePublish, releaseVersion } from 'nx/release';

// Verdaccio's default `--listen localhost:<port>` resolves to IPv6 (`::1`)
// in this environment, but Node's `fetch()` doesn't reliably connect to that
// address — pin to the IPv4 loopback explicitly so readiness polling works.
const LISTEN_ADDRESS = '127.0.0.1';
const PORT = 4873;

export default async () => {
  // storage folder for the local registry
  const storage = join(workspaceRoot, 'tmp/local-registry/storage');
  if (existsSync(storage)) {
    rmSync(storage, { recursive: true, force: true });
  }

  global.stopLocalRegistry = await startVerdaccio(storage);

  await releaseVersion({
    specifier: '0.0.0-e2e',
    stageChanges: false,
    gitCommit: false,
    gitTag: false,
    // nx.json's `release.git.push` is `true` for the real release workflow
    // (release.yml) and applies here too unless overridden — without this,
    // the e2e run tries to push to origin and fails in any CI job whose
    // token lacks write access (e.g. a PR-triggered check).
    gitPush: false,
    firstRelease: true,
    versionActionsOptionsOverrides: {
      skipLockFileUpdate: true,
    },
  });
  await releasePublish({
    tag: 'e2e',
    firstRelease: true,
  });
};

/**
 * `@nx/js`'s own `startLocalRegistry` helper starts verdaccio by forking the
 * Nx CLI (`nx run <target>:local-registry`) and waiting for its startup
 * banner to appear on the child's stdout. In this workspace that hangs
 * indefinitely: Nx runs the task through an isolated `run-executor.js`
 * worker whose stdout is a socket back to the CLI process rather than a
 * plain inherited pipe, and that socket only appears to flush once the task
 * exits — which a persistent server like verdaccio never does on its own.
 * Spawning verdaccio directly (bypassing `nx run` entirely) and polling its
 * HTTP endpoint for readiness sidesteps that.
 */
async function startVerdaccio(storage: string): Promise<() => void> {
  const registry = `http://${LISTEN_ADDRESS}:${PORT}`;
  const authToken = 'secretVerdaccioToken';

  const child = fork(
    getVerdaccioBinPath(),
    ['--config', join(workspaceRoot, '.verdaccio/config.yml'), '--listen', `${LISTEN_ADDRESS}:${PORT}`],
    {
      env: {
        ...process.env,
        VERDACCIO_HANDLE_KILL_SIGNALS: 'true',
        VERDACCIO_STORAGE_PATH: storage,
      },
      stdio: 'inherit',
    }
  );

  await waitForRegistry(registry);

  console.log(`Local registry started on ${registry}`);
  process.env['npm_config_registry'] = registry;
  // `npm publish` refuses to run without *some* auth token configured, even
  // against a registry that allows anonymous publishing. `--location user`
  // (npm's default) writes to $HOME/.npmrc, which is read-only in some
  // sandboxes — `--location project` writes to the workspace's own .npmrc
  // instead, which this process can always write to.
  execSync(`npm config set //${LISTEN_ADDRESS}:${PORT}/:_authToken "${authToken}" --location project`, {
    cwd: workspaceRoot,
    windowsHide: true,
  });

  return () => {
    child.kill();
    execSync(`npm config delete //${LISTEN_ADDRESS}:${PORT}/:_authToken --location project`, {
      cwd: workspaceRoot,
      windowsHide: true,
    });
  };
}

function getVerdaccioBinPath(): string {
  const packageJsonPath = require.resolve('verdaccio/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const bin =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin['verdaccio'];
  return join(dirname(packageJsonPath), bin);
}

async function waitForRegistry(registry: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${registry}/-/ping`);
      if (response.ok) return;
    } catch {
      // Verdaccio isn't listening yet — retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Verdaccio did not become ready at ${registry} within ${timeoutMs}ms`);
}
