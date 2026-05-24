import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../platformDetector', () => ({
  getPlatformInfo: vi.fn(),
  getCurrentPlatform: vi.fn(() => 'macOS'),
  getVSCodeConfigPaths: vi.fn(() => [])
}));

vi.mock('../../utilities/fileSystemUtils', () => ({
  checkFileExists: vi.fn(),
  checkFileReadable: vi.fn(),
  readFileContent: vi.fn(),
  getFileStats: vi.fn(),
  expandPath: vi.fn((p: string) => Promise.resolve(p)),
  listDirectory: vi.fn()
}));

import {
  detectVSCodeConfigs,
  detectVscodeConfigFile,
  detectSingleConfigFile,
  detectCustomConfigFile,
  getPlatformDetectionInfo
} from '../VscodeConfigDetector';
import * as platformDetector from '../platformDetector';
import * as fsUtils from '../../utilities/fileSystemUtils';

const mockGetPlatformInfo = platformDetector.getPlatformInfo as ReturnType<typeof vi.fn>;
const mockCheckFileExists = fsUtils.checkFileExists as ReturnType<typeof vi.fn>;
const mockCheckFileReadable = fsUtils.checkFileReadable as ReturnType<typeof vi.fn>;
const mockReadFileContent = fsUtils.readFileContent as ReturnType<typeof vi.fn>;
const mockGetFileStats = fsUtils.getFileStats as ReturnType<typeof vi.fn>;
const mockExpandPath = fsUtils.expandPath as ReturnType<typeof vi.fn>;
const mockListDirectory = fsUtils.listDirectory as ReturnType<typeof vi.fn>;
const mockGetVSCodeConfigPaths = platformDetector.getVSCodeConfigPaths as ReturnType<typeof vi.fn>;

function makeMcpJsonContent(servers: Record<string, any> = { myServer: { command: 'node', args: ['index.js'] } }) {
  return JSON.stringify({ servers });
}

function makeSettingsJsonContent(servers: Record<string, any> = { myServer: { command: 'node' } }) {
  return JSON.stringify({ mcp: { servers } });
}

describe('detectSingleConfigFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpandPath.mockImplementation((p: string) => Promise.resolve(p));
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: 100, lastModified: 1000 } });
  });

  it('returns exists=false when file does not exist', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: false, error: 'Not found' });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.exists).toBe(false);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Not found');
  });

  it('returns isReadable=false when file is not readable', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: false, error: 'Permission denied' });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.exists).toBe(true);
    expect(result.isReadable).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('handles read failure gracefully', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: false, error: 'Read error' });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Read error');
  });

  it('validates valid mcp.json with stdio servers', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: makeMcpJsonContent() });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
    expect(result.detectedFormat).toBe('mcp.json');
  });

  it('validates valid mcp.json with url-based servers', async () => {
    const content = JSON.stringify({ servers: { remoteServer: { url: 'http://localhost:3000' } } });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('validates valid settings.json', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: makeSettingsJsonContent() });
    const result = await detectSingleConfigFile('/path/to/settings.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
    expect(result.detectedFormat).toBe('settings.json');
  });

  it('returns isValid=false for invalid JSON', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: 'not json' });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid JSON/);
  });

  it('returns isValid=false when no MCP servers found', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: JSON.stringify({ servers: {} }) });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/No MCP servers/);
  });

  it('returns isValid=false when server is missing command/url', async () => {
    const content = JSON.stringify({ servers: { bad: { env: {} } } });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/missing required configuration/);
  });

  it('uses file stats when available', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: makeMcpJsonContent() });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: 512, lastModified: 9999 } });
    const result = await detectSingleConfigFile('/path/to/mcp.json');
    expect(result.fileSize).toBe(512);
    expect(result.lastModified).toBe(9999);
  });

  it('auto-detects settings.json format from content when no filename hint', async () => {
    const content = JSON.stringify({ mcp: { servers: { s: { command: 'node' } } } });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    const result = await detectSingleConfigFile('/some/unknown/file');
    expect(result.isValid).toBe(true);
    expect(result.detectedFormat).toBe('settings.json');
  });

  it('expandedPath defaults to originalPath when not supplied', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: false });
    const result = await detectSingleConfigFile('/original/path');
    expect(result.path).toBe('/original/path');
    expect(result.expandedPath).toBe('/original/path');
  });
});

describe('detectVSCodeConfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpandPath.mockImplementation((p: string) => Promise.resolve(p));
    mockListDirectory.mockResolvedValue({ success: false });
    mockGetFileStats.mockResolvedValue({ success: false });
  });

  it('returns not-supported result for unsupported platform', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'FreeBSD', isSupported: false });
    const result = await detectVSCodeConfigs();
    expect(result.success).toBe(false);
    expect(result.isSupported).toBe(false);
    expect(result.error).toMatch(/not currently supported/);
  });

  it('returns success with empty configFiles when no paths found', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'macOS', isSupported: true });
    mockGetVSCodeConfigPaths.mockReturnValue([]);
    const result = await detectVSCodeConfigs();
    expect(result.success).toBe(true);
    expect(result.configFiles).toHaveLength(0);
    expect(result.totalServersFound).toBe(0);
  });

  it('stops scanning after finding a valid config', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'macOS', isSupported: true });
    mockGetVSCodeConfigPaths.mockReturnValue(['/path/a/mcp.json', '/path/b/mcp.json']);
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: makeMcpJsonContent() });

    const result = await detectVSCodeConfigs();
    expect(result.success).toBe(true);
    expect(result.totalServersFound).toBe(1);
    // Should stop after first match
    expect(result.configFiles).toHaveLength(1);
  });
});

describe('detectVscodeConfigFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpandPath.mockImplementation((p: string) => Promise.resolve(p));
    mockListDirectory.mockResolvedValue({ success: false });
    mockGetFileStats.mockResolvedValue({ success: false });
  });

  it('returns null for unsupported platform', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'FreeBSD', isSupported: false });
    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });

  it('returns null when no paths provided', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'macOS', isSupported: true });
    mockGetVSCodeConfigPaths.mockReturnValue([]);
    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });

  it('returns expanded path of first valid config', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'macOS', isSupported: true });
    mockGetVSCodeConfigPaths.mockReturnValue(['/path/mcp.json']);
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockReadFileContent.mockResolvedValue({ success: true, content: makeMcpJsonContent() });

    const result = await detectVscodeConfigFile();
    expect(result).toBe('/path/mcp.json');
  });

  it('returns null when all files are invalid', async () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'macOS', isSupported: true });
    mockGetVSCodeConfigPaths.mockReturnValue(['/path/mcp.json']);
    mockCheckFileExists.mockResolvedValue({ exists: false });

    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });
});

describe('detectCustomConfigFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpandPath.mockImplementation((p: string) => Promise.resolve('/expanded' + p));
    mockGetFileStats.mockResolvedValue({ success: false });
  });

  it('expands path before detecting', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: false });
    const result = await detectCustomConfigFile('/original/mcp.json');
    expect(result.path).toBe('/original/mcp.json');
    expect(result.expandedPath).toBe('/expanded/original/mcp.json');
  });
});

describe('getPlatformDetectionInfo', () => {
  it('returns macOS detection info', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'macOS',
      isSupported: true,
      vscodeConfigPath: '/Users/user/Library/...'
    });
    const info = getPlatformDetectionInfo();
    expect(info.platform).toBe('macOS');
    expect(info.isSupported).toBe(true);
    expect(info.supportedFormats).toContain('mcp.json with servers section');
    expect(info.detectionStrategy).toMatch(/Homebrew/i);
  });

  it('returns Windows detection info', () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'Windows', isSupported: true, vscodeConfigPath: '' });
    const info = getPlatformDetectionInfo();
    expect(info.supportedFormats).toContain('mcp.json with servers section');
    expect(info.detectionStrategy).toMatch(/portable/i);
  });

  it('returns Linux detection info', () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'Linux', isSupported: true, vscodeConfigPath: '' });
    const info = getPlatformDetectionInfo();
    expect(info.supportedFormats).toContain('settings.json with mcp.servers section');
  });

  it('returns empty formats for unknown platform', () => {
    mockGetPlatformInfo.mockReturnValue({ platform: 'Other', isSupported: false, vscodeConfigPath: '' });
    const info = getPlatformDetectionInfo();
    expect(info.supportedFormats).toEqual([]);
    expect(info.detectionStrategy).toMatch(/not defined/);
  });
});
