/**
 * Shared data mock factories.
 *
 * Factories are deterministic: the same sequence number always yields the same
 * record. Sequences are per-process, so a Playwright worker and a Jest suite
 * each start at 1 — never assert on a generated id across process boundaries.
 */

export interface Factory<T> {
  /** Builds one record, applying `overrides` last. */
  build(overrides?: Partial<T>): T;
  /** Builds `count` records, each with its own sequence number. */
  buildList(count: number, overrides?: Partial<T>): T[];
  /** Resets the sequence back to 1. Call between suites that assert on ids. */
  reset(): void;
}

/**
 * Defines a factory from a builder that receives an incrementing sequence
 * number. Use it to add app-specific factories alongside the shared ones.
 *
 * @example
 * export const InvoiceFactory = defineFactory<Invoice>((seq) => ({
 *   id: `invoice-${seq}`,
 *   total: 0,
 * }));
 */
export function defineFactory<T extends object>(
  builder: (sequence: number) => T
): Factory<T> {
  let sequence = 0;

  // Declared as a standalone function rather than a method, so the factory
  // keeps working when callers destructure it: `const { build } = UserFactory`.
  const build = (overrides?: Partial<T>): T => {
    sequence += 1;
    return { ...builder(sequence), ...overrides };
  };

  return {
    build,
    buildList: (count, overrides) =>
      Array.from({ length: count }, () => build(overrides)),
    reset: () => {
      sequence = 0;
    },
  };
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

export const UserFactory = defineFactory<User>((sequence) => ({
  id: `user-${sequence}`,
  // .test is reserved by RFC 2606, so these addresses can never reach a real inbox.
  email: `user-${sequence}@example.test`,
  firstName: 'Test',
  lastName: `User ${sequence}`,
  roles: ['user'],
}));

export interface Organisation {
  id: string;
  name: string;
  slug: string;
}

export const OrganisationFactory = defineFactory<Organisation>((sequence) => ({
  id: `org-${sequence}`,
  name: `Test Organisation ${sequence}`,
  slug: `test-organisation-${sequence}`,
}));
