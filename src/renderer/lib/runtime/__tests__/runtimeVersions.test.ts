/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import {
  BUN_VERSIONS,
  UV_VERSIONS,
  PYTHON_VERSIONS,
  DEFAULT_BUN_VERSION,
  DEFAULT_UV_VERSION,
  DEFAULT_PYTHON_VERSION,
  type RuntimeVersionEntry,
} from '../runtimeVersions';

describe('runtimeVersions', () => {
  describe('default versions', () => {
    it('has a default Bun version string', () => {
      expect(DEFAULT_BUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('has a default uv version string', () => {
      expect(DEFAULT_UV_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('has a default Python version string', () => {
      expect(DEFAULT_PYTHON_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('BUN_VERSIONS', () => {
    it('is a non-empty array', () => {
      expect(BUN_VERSIONS.length).toBeGreaterThan(0);
    });

    it('each entry has version and label fields', () => {
      BUN_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toBeTruthy();
        expect(entry.label).toBeTruthy();
      });
    });

    it('version and label are the same value', () => {
      BUN_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toBe(entry.label);
      });
    });

    it('versions look like semver strings', () => {
      BUN_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      });
    });

    it('contains the default Bun version', () => {
      const found = BUN_VERSIONS.find(e => e.version === DEFAULT_BUN_VERSION);
      expect(found).toBeDefined();
    });

    it('is ordered newest-first (first entry >= second entry numerically)', () => {
      // Compare first two versions
      const [first, second] = BUN_VERSIONS;
      const toNum = (v: string) => v.split('.').map(Number);
      const [a0, a1, a2] = toNum(first.version);
      const [b0, b1, b2] = toNum(second.version);
      const firstIsGte = a0 > b0 || (a0 === b0 && a1 > b1) || (a0 === b0 && a1 === b1 && a2 >= b2);
      expect(firstIsGte).toBe(true);
    });
  });

  describe('UV_VERSIONS', () => {
    it('is a non-empty array', () => {
      expect(UV_VERSIONS.length).toBeGreaterThan(0);
    });

    it('each entry has version and label fields matching', () => {
      UV_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toBe(entry.label);
      });
    });

    it('versions look like semver strings', () => {
      UV_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      });
    });

    it('contains the default uv version', () => {
      const found = UV_VERSIONS.find(e => e.version === DEFAULT_UV_VERSION);
      expect(found).toBeDefined();
    });
  });

  describe('PYTHON_VERSIONS', () => {
    it('is a non-empty array', () => {
      expect(PYTHON_VERSIONS.length).toBeGreaterThan(0);
    });

    it('each entry has version and label fields matching', () => {
      PYTHON_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toBe(entry.label);
      });
    });

    it('all versions start with 3.', () => {
      PYTHON_VERSIONS.forEach((entry: RuntimeVersionEntry) => {
        expect(entry.version).toMatch(/^3\./);
      });
    });

    it('contains the default Python version', () => {
      const found = PYTHON_VERSIONS.find(e => e.version === DEFAULT_PYTHON_VERSION);
      expect(found).toBeDefined();
    });

    it('has no duplicate versions', () => {
      const versions = PYTHON_VERSIONS.map(e => e.version);
      const unique = new Set(versions);
      expect(unique.size).toBe(versions.length);
    });
  });
});
