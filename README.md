# `@willstjohnbacon/nx-bdd`

Development workspace for **`@willstjohnbacon/nx-bdd`** — a custom Nx plugin that orchestrates Behaviour-Driven Development testing across an enterprise Nx workspace.

The plugin is both a **build-time scaffolding tool** and a **run-time testing library**, bridging Playwright, Cucumber (via `playwright-bdd`), Allure reporting and shared testing utilities across microservices (NestJS) and frontends (Angular).

> Consumer documentation lives in [`packages/nx-bdd/README.md`](packages/nx-bdd/README.md).

## Layout

```text
packages/nx-bdd/            # the published plugin
├── generators.json         # generator registry
├── package.json            # subpath exports: /fixtures, /steps, /factories
└── src/
    ├── generators/
    │   └── setup-e2e/
    │       ├── files/
    │       │   └── playwright.config.ts.template
    │       ├── generator.ts
    │       └── schema.json
    ├── runtime/
    │   ├── fixtures/       # shared Playwright fixtures (auth, cleanup)
    │   ├── steps/          # base Given/When/Then steps
    │   └── factories/      # shared data mock factories
    └── index.ts            # public runtime API
e2e/nx-bdd-e2e/             # publishes to a local registry, then drives a real workspace
```

## Working on the plugin

```sh
npx nx build @willstjohnbacon/nx-bdd    # compile to dist/packages/nx-bdd
npx nx test @willstjohnbacon/nx-bdd     # generator + runtime unit tests
npx nx lint @willstjohnbacon/nx-bdd
npx nx e2e nx-bdd-e2e                   # full integration run (slow)
```

The e2e suite spins up a Verdaccio registry, publishes the plugin at version `0.0.0-e2e`, creates a throwaway Nx workspace, applies the generator and runs `bddgen` against a real feature file.

## Things worth knowing before you change the code

**The compile target is load-bearing.** `playwright-bdd` discovers a step's fixtures by parsing `fn.toString()`. If `packages/nx-bdd/tsconfig.json` targets anything that downlevels async functions, every shared step is emitted as a `tslib.__awaiter(_a, ...)` wrapper and `playwright-bdd` rejects it with *"First argument must use the object destructuring pattern"* — in the consumer's workspace, at `bddgen` time. A regression test in `src/runtime/runtime.spec.ts` guards this.

**Step registration is a side effect.** `src/index.ts` deliberately does not re-export `runtime/steps`, so importing the package root never registers Cucumber steps. Registration only happens through the `@willstjohnbacon/nx-bdd/steps` entry point.

**Allure paths resolve against `process.cwd()`.** Nx's inferred Playwright targets run with `cwd` set to the project root, while the legacy `@nx/playwright:playwright` executor uses the workspace root. The generated config anchors the results directory on `workspaceRoot` so both land in the same place.

## Testing from a private registry

The workspace ships a [Verdaccio](https://verdaccio.org) registry, which is the
quickest way to install the plugin into another workspace exactly as npm would
serve it — subpath exports, `files`, dependency resolution and all.

```sh
# Terminal 1 — leave running
npm run registry:start

# Terminal 2
npm run registry:publish
```

Then, in any workspace on the same machine:

```sh
npm install -D @willstjohnbacon/nx-bdd
npx nx add @nx/playwright
npx nx g @willstjohnbacon/nx-bdd:setup-e2e --project=system-e2e
```

Two things to know:

- **`nx local-registry` rewrites `~/.npmrc`** to point at `http://127.0.0.1:4873`
  while it runs, and restores it on a clean shutdown. If Verdaccio is killed
  abruptly, `~/.npmrc` can be left pointing at a dead registry and every `npm
  install` on the machine will hang or fail. Fix it with
  `npm config delete registry`.
- **`registry:publish` pins `--registry` on purpose.** Without it, running the
  script while Verdaccio is down would publish the package to public npm.

Bumping the version (`packages/nx-bdd/package.json`) before each republish makes
the consuming workspace pick up changes; Verdaccio rejects a re-publish of a
version it already holds.

### A private registry you can use from other machines

Verdaccio here is local-only. For a private package you can install from
anywhere, **GitHub Packages** fits this repo: it is free for private packages on
personal accounts, and it requires the npm scope to match the GitHub account —
which `@willstjohnbacon` already does.

```jsonc
// packages/nx-bdd/package.json
"publishConfig": { "registry": "https://npm.pkg.github.com" }
```

```sh
# publish (needs a PAT with write:packages)
npm publish dist/packages/nx-bdd

# consume, in the other workspace's .npmrc
@willstjohnbacon:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Private packages on **npmjs.com** itself need a paid plan; scoped packages
default to `restricted` access, so `npm publish` will fail rather than leak a
package publicly if you have no plan.

## Troubleshooting the e2e suite

**`ECONNREFUSED 127.0.0.1:4873` during `nx-release-publish`** — Verdaccio's default
`listenAddress` is `localhost`, which resolves to `::1` on IPv6-preferring hosts
while npm dials `127.0.0.1`. The `local-registry` target in the root
`project.json` pins `listenAddress` to `127.0.0.1` so both ends agree; don't
remove it.

**A stale Verdaccio holds port 4873** after an interrupted run. Stop it with
`pkill -x verdaccio` before retrying.

## Releasing

```sh
npx nx release
```

Version and publish are driven by [Nx Release](https://nx.dev/features/manage-releases); the package root is `dist/packages/nx-bdd`.
