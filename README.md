# `@willstjohnbacon/nx-bdd`

Development workspace for **`@willstjohnbacon/nx-bdd`** — a custom Nx plugin that orchestrates Behaviour-Driven Development testing across an enterprise Nx workspace.

The plugin is both a **build-time scaffolding tool** and a **run-time testing library**, bridging Playwright, Cucumber (via `playwright-bdd`), Allure reporting and shared testing utilities across every app in a workspace.

Nothing in it is tied to a particular framework: the generator needs an Nx project and Playwright, and the runtime needs a URL to point a browser at. Angular, Nest, Next, Remix, Vite, Express — or a service that is not Node at all — are all just a `baseUrl`.

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

**The compile target is load-bearing.** `playwright-bdd` discovers a step's fixtures by parsing `fn.toString()`. If `packages/nx-bdd/tsconfig.json` targets anything that downlevels async functions, every shared step is emitted as a `tslib.__awaiter(_a, ...)` wrapper and `playwright-bdd` rejects it with _"First argument must use the object destructuring pattern"_ — in the consumer's workspace, at `bddgen` time. A regression test in `src/runtime/runtime.spec.ts` guards this.

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

Releases are automated. **`develop` is where work happens; merging `develop` into
`main` cuts a release.**

On every push to `main`, [`.github/workflows/release.yml`](.github/workflows/release.yml)
runs lint, unit tests and the e2e suite, then hands over to
[Nx Release](https://nx.dev/features/manage-releases), which:

1. reads the commits since the last `v*` tag and derives the semver bump,
2. writes the new version into `packages/nx-bdd/package.json` and the built
   `dist/packages/nx-bdd/package.json`,
3. prepends an entry to `CHANGELOG.md`,
4. commits, tags `vX.Y.Z` and pushes,
5. publishes `dist/packages/nx-bdd` to npm with provenance,
6. creates the matching GitHub Release.

### Commit messages decide the version

The bump comes from [Conventional Commits](https://www.conventionalcommits.org),
so commit messages are the release notes:

| Commit                            | Bump  | 0.1.0 becomes |
| --------------------------------- | ----- | ------------- |
| `fix(nx-bdd): ...`                | patch | `0.1.1`       |
| `feat(nx-bdd): ...`               | minor | `0.2.0`       |
| `feat(nx-bdd)!: ...`              | major | `1.0.0`       |
| `chore:`, `docs:`, `test:`, `ci:` | none  | `0.1.0`       |

A commit with no releasable type produces no release — the workflow runs, finds
nothing to version and exits.

`release.version.adjustSemverBumpsForZeroMajorVersion` is set to `false` in
[`nx.json`](nx.json), so the table above holds while the major version is still
`0`. That means a breaking change pre-1.0 goes straight to `1.0.0`. Flip it to
`true` if you would rather stay in `0.x` — but be aware it also demotes `feat`
to a patch bump.

### One-time setup

| Where                                   | What                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| npm                                     | A granular access token with **Read and write** on `@willstjohnbacon/nx-bdd` |
| GitHub → Secrets → Actions              | That token, as `NPM_TOKEN`                                                   |
| GitHub → Actions → Workflow permissions | **Read and write permissions**                                               |

`GITHUB_TOKEN` is provided by Actions; nothing to configure for the release
itself. If `main` is a protected branch, allow `github-actions[bot]` to bypass
the push restriction, or the tag and changelog commit cannot land.

### Previewing and manual runs

```sh
# See exactly what the next release would do — writes nothing
npx nx release --dry-run

# Trigger a release by hand (Actions → Release → Run workflow),
# optionally ticking "dry-run"
gh workflow run release.yml
```

The release commit is `chore(release): publish X.Y.Z [skip ci]`, so it does not
re-trigger the workflow.

The first release has no `v*` tag to compare against, so the workflow passes
`--first-release` automatically; the version falls back to the one on disk.
