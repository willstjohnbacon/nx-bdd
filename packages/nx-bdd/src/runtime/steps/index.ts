/**
 * Registers the organisation's base step definitions.
 *
 * Consuming apps pull these in from their own `src/steps/index.ts`, which the
 * `setup-e2e` generator scaffolds for them.
 */
import './common.steps';

// Re-exported so app steps can build on the shared bindings without a second
// import of `@willstjohnbacon/nx-bdd/fixtures`.
export { Given, When, Then, Step, expect, test } from '../fixtures';
