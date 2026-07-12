import { describe, expect, it } from 'vitest';

import { buildVitePackPackageJson, parseArgs } from '../vite/pack';

describe('Vite packaging', () => {
  it('parses packaging flags', () => {
    expect(parseArgs(['bun', 'pack.ts', '--skip-build', '--skip-clean', '--dir'])).toEqual({
      skipBuild: true,
      skipClean: true,
      dirOnly: true,
    });
  });

  it('preserves production metadata and dependency overrides', () => {
    expect(buildVitePackPackageJson({
      name: 'openkosmos-app',
      version: '1.0.0',
      description: 'OpenKosmos',
      author: 'OpenKosmos Team',
      license: 'MIT',
      dependencies: { pdfreader: '^3.0.8' },
      optionalDependencies: { native: '^1.0.0' },
      overrides: {
        pdfreader: { pdf2json: '4.0.3' },
      },
    })).toEqual({
      name: 'openkosmos-app',
      version: '1.0.0',
      description: 'OpenKosmos',
      author: 'OpenKosmos Team',
      license: 'MIT',
      main: 'dist/main/main.js',
      dependencies: { pdfreader: '^3.0.8' },
      optionalDependencies: { native: '^1.0.0' },
      overrides: {
        pdfreader: { pdf2json: '4.0.3' },
      },
    });
  });

  it('omits empty optional dependency fields', () => {
    expect(buildVitePackPackageJson({
      name: 'openkosmos-app',
      version: '1.0.0',
      dependencies: {},
      optionalDependencies: {},
      overrides: {},
    })).not.toHaveProperty('optionalDependencies');
  });
});
