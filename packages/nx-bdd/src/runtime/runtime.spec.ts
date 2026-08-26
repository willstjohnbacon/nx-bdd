import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

import { UserFactory, OrganisationFactory, defineFactory } from './factories';

describe('data factories', () => {
  beforeEach(() => {
    UserFactory.reset();
    OrganisationFactory.reset();
  });

  it('produces a distinct record on every build', () => {
    const first = UserFactory.build();
    const second = UserFactory.build();

    expect(first.id).not.toEqual(second.id);
    expect(first.email).not.toEqual(second.email);
  });

  it('applies overrides last', () => {
    const user = UserFactory.build({ email: 'someone@example.test', roles: ['admin'] });

    expect(user.email).toBe('someone@example.test');
    expect(user.roles).toEqual(['admin']);
    expect(user.firstName).toBe('Test');
  });

  it('gives each record in a list its own sequence number', () => {
    const users = UserFactory.buildList(3);

    expect(users).toHaveLength(3);
    expect(new Set(users.map((user) => user.id)).size).toBe(3);
  });

  it('rewinds the sequence on reset', () => {
    const before = UserFactory.build();
    UserFactory.reset();

    expect(UserFactory.build()).toEqual(before);
  });

  it('keeps working when destructured', () => {
    const { build } = UserFactory;

    expect(build().id).not.toEqual(build().id);
  });

  it('only ever generates unroutable email addresses', () => {
    // .test is reserved by RFC 2606, so a stray send can never reach a person.
    expect(UserFactory.build().email.endsWith('@example.test')).toBe(true);
  });

  it('lets apps define their own factories', () => {
    const InvoiceFactory = defineFactory((sequence) => ({
      id: `invoice-${sequence}`,
      total: 0,
    }));

    expect(InvoiceFactory.build({ total: 10 })).toEqual({
      id: 'invoice-1',
      total: 10,
    });
  });
});

describe('shared step definitions', () => {
  // playwright-bdd resolves a step's fixtures by parsing fn.toString(). If the
  // package is compiled with a target that downlevels async functions, every
  // shared step turns into a tslib `__awaiter(_a, ...)` wrapper and
  // playwright-bdd rejects it with "First argument must use the object
  // destructuring pattern" — at bddgen time, in the consumer's workspace.
  it('compiles with the fixture destructuring intact', () => {
    const configPath = join(__dirname, '..', '..', 'tsconfig.lib.json');
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        );
      },
    } as ts.ParseConfigFileHost);

    const source = readFileSync(join(__dirname, 'steps', 'common.steps.ts'), 'utf-8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: parsed?.options,
    });

    expect(outputText).not.toContain('__awaiter');
    expect(outputText).toMatch(/async \(\{/);
  });
});
