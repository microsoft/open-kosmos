import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

describe('third-party license inventory', () => {
  it('generates deterministic evidence without unknown licenses', () => {
    expect(() => execFileSync(
      process.execPath,
      ['scripts/generate-third-party-license-inventory.js'],
      { cwd: ROOT, stdio: 'pipe' },
    )).not.toThrow();

    const summary = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'docs/third-party-license-inventory.json'),
      'utf8',
    ));
    expect(summary.unknownLicenseCount).toBe(0);
    expect(summary.unknownManifestLicenseCount).toBe(0);

    const inventory = fs.readFileSync(
      path.join(ROOT, 'docs/third-party-license-inventory.csv'),
      'utf8',
    );
    expect(inventory).not.toContain(',UNKNOWN,');
    expect(inventory).toContain('manifest-only,openclaw,>=0.1.0,HOST-PROVIDED,peer');
  });
});
