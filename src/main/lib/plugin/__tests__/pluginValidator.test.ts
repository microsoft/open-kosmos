/**
 * Tests for pluginValidator — manifest discovery, parsing, schema validation, normalization.
 */

import * as fs from 'fs';
import * as path from 'path';
import { findManifestPath, validatePluginManifest } from '../pluginValidator';

vi.mock('fs');

const mockFs = vi.mocked(fs);

describe('findManifestPath', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns primary path when .claude-plugin/plugin.json exists', () => {
    mockFs.existsSync.mockImplementation((p) => {
      return String(p).endsWith(path.join('.claude-plugin', 'plugin.json'));
    });
    const result = findManifestPath('/my/plugin');
    expect(result).toBe(path.join('/my/plugin', '.claude-plugin', 'plugin.json'));
  });

  it('falls back to root plugin.json when primary is absent', () => {
    mockFs.existsSync.mockImplementation((p) => {
      return String(p).endsWith('plugin.json') && !String(p).includes('.claude-plugin');
    });
    const result = findManifestPath('/my/plugin');
    expect(result).toBe(path.join('/my/plugin', 'plugin.json'));
  });

  it('returns null when neither file exists', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(findManifestPath('/my/plugin')).toBeNull();
  });
});

describe('validatePluginManifest', () => {
  afterEach(() => vi.clearAllMocks());

  function setupManifest(content: unknown, usePrimaryPath = false): void {
    const manifestPath = usePrimaryPath
      ? path.join('/my/plugin', '.claude-plugin', 'plugin.json')
      : path.join('/my/plugin', 'plugin.json');

    mockFs.existsSync.mockImplementation((p) => {
      if (usePrimaryPath) {
        return String(p) === manifestPath;
      }
      return String(p) === manifestPath;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === manifestPath) return JSON.stringify(content);
      throw new Error('ENOENT');
    });
  }

  it('returns error when no manifest file found', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/No plugin\.json/);
  });

  it('returns error when JSON is invalid', () => {
    const manifestPath = path.join('/my/plugin', 'plugin.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === manifestPath);
    mockFs.readFileSync.mockReturnValue('not valid json {{');
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).toBeNull();
    expect(result.errors[0].message).toMatch(/Failed to parse/);
  });

  it('returns error when name is missing', () => {
    setupManifest({ version: '1.0.0' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).toBeNull();
    expect(result.errors[0].message).toMatch(/Manifest validation failed/);
  });

  it('parses a minimal valid manifest', () => {
    setupManifest({ name: 'my-plugin' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).not.toBeNull();
    expect(result.manifest!.name).toBe('my-plugin');
    expect(result.manifest!.version).toBe('0.0.0');
    expect(result.manifest!.description).toBe('');
  });

  it('uses provided version and description', () => {
    setupManifest({ name: 'p', version: '2.1.0', description: 'My desc' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.version).toBe('2.1.0');
    expect(result.manifest!.description).toBe('My desc');
  });

  it('normalizes string author to object', () => {
    setupManifest({ name: 'p', author: 'Alice' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.author).toEqual({ name: 'Alice' });
  });

  it('normalizes object author correctly', () => {
    setupManifest({ name: 'p', author: { name: 'Bob', email: 'b@b.com' } });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.author).toEqual({ name: 'Bob', email: 'b@b.com' });
  });

  it('defaults author to Unknown when absent', () => {
    setupManifest({ name: 'p' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.author).toEqual({ name: 'Unknown' });
  });

  it('accepts string skills field', () => {
    setupManifest({ name: 'p', skills: 'skills/mything' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).not.toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it('accepts array skills field', () => {
    setupManifest({ name: 'p', skills: ['skills/a', 'skills/b'] });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).not.toBeNull();
  });

  it('blocks path traversal in skills', () => {
    setupManifest({ name: 'p', skills: ['../../etc/passwd'] });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest).toBeNull();
    expect(result.errors.some(e => e.message.includes('Path traversal'))).toBe(true);
  });

  it('normalizes mcpServers from object', () => {
    setupManifest({
      name: 'p',
      mcpServers: { myserver: { command: 'node', args: ['index.js'] } },
    });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.mcpServers).toBeDefined();
    expect(result.manifest!.mcpServers!.myserver.command).toBe('node');
  });

  it('sets mcpServers to undefined when value is a string (path) or missing', () => {
    setupManifest({ name: 'p', mcpServers: 'path/to/.mcp.json' });
    const result = validatePluginManifest('/my/plugin');
    // string form is not an object, so mcpServers should be undefined
    expect(result.manifest!.mcpServers).toBeUndefined();
  });

  it('extracts homepage and license', () => {
    setupManifest({ name: 'p', homepage: 'https://example.com', license: 'MIT' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.homepage).toBe('https://example.com');
    expect(result.manifest!.license).toBe('MIT');
  });

  it('normalizes repository string to string value', () => {
    setupManifest({ name: 'p', repository: 'https://github.com/user/repo' });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.repository).toBe('https://github.com/user/repo');
  });

  it('normalizes repository object to its url', () => {
    setupManifest({ name: 'p', repository: { url: 'https://github.com/user/repo', type: 'git' } });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.repository).toBe('https://github.com/user/repo');
  });

  it('discovers manifest at primary .claude-plugin path', () => {
    const primaryPath = path.join('/my/plugin', '.claude-plugin', 'plugin.json');
    mockFs.existsSync.mockImplementation((p) => String(p) === primaryPath);
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === primaryPath) return JSON.stringify({ name: 'primary-plugin' });
      throw new Error('ENOENT');
    });
    const result = validatePluginManifest('/my/plugin');
    expect(result.manifest!.name).toBe('primary-plugin');
  });
});
