/**
 * FileSecurityValidator tests
 * Covers path traversal, absolute paths, dangerous patterns, workspace validation,
 * whitelist logic, and extractPathsFromToolArgs / validateToolPathsInWorkspace.
 */

import * as path from 'path';
import { FileSecurityValidator } from '../fileSecurityValidator';

// createLogger is called inside methods — mock the whole module so no FS/IPC calls happen
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// The global mock from tests/setup.ts provides app.getPath(() => '/tmp/test').
// We use '/tmp/test' as the deterministic userData path in whitelist assertions.
const FAKE_USER_DATA = '/tmp/test';

beforeEach(() => {
  // Reset the global electron override used by getElectronApp
  delete (global as any).electron;
});

// ─────────────────────────────────────────────
// validatePath
// ─────────────────────────────────────────────
describe('FileSecurityValidator.validatePath', () => {
  it('returns invalid for path traversal attacks', () => {
    const result = FileSecurityValidator.validatePath('../secret');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/traversal/i);
  });

  it('returns invalid for absolute paths when not allowed', () => {
    // /etc/ triggers path-traversal check first (contains /etc/)
    const result = FileSecurityValidator.validatePath('/etc/something');
    expect(result.isValid).toBe(false);
  });

  it('returns invalid for absolute path (no traversal pattern) when not allowed', () => {
    // /home/user — no /etc/, so hits absolute-path check
    const result = FileSecurityValidator.validatePath('/home/user/file.txt');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/absolute/i);
  });

  it('allows absolute paths when allowAbsolutePaths=true', () => {
    const result = FileSecurityValidator.validatePath('/home/user/doc.txt', true);
    expect(result.isValid).toBe(true);
  });

  it('returns invalid for etc/passwd pattern', () => {
    const result = FileSecurityValidator.validatePath('etc/passwd', true);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/sensitive/i);
  });

  it('returns invalid for windows/system32 pattern (forward slash form)', () => {
    // The dangerous pattern regex uses forward slashes
    const result = FileSecurityValidator.validatePath('windows/system32/cmd.exe', true);
    expect(result.isValid).toBe(false);
  });

  it('returns invalid for .ssh/id_rsa pattern', () => {
    const result = FileSecurityValidator.validatePath('/home/user/.ssh/id_rsa', true);
    expect(result.isValid).toBe(false);
  });

  it('returns invalid for .aws/credentials pattern', () => {
    const result = FileSecurityValidator.validatePath('/home/user/.aws/credentials', true);
    expect(result.isValid).toBe(false);
  });

  it('returns valid for a safe relative path', () => {
    const result = FileSecurityValidator.validatePath('src/main/index.ts');
    expect(result.isValid).toBe(true);
  });

  it('uses default allowAbsolutePaths=false', () => {
    const result = FileSecurityValidator.validatePath('/tmp/file.txt');
    expect(result.isValid).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isPathTraversalAttack
// ─────────────────────────────────────────────
describe('FileSecurityValidator.isPathTraversalAttack', () => {
  it('detects ../', () => expect(FileSecurityValidator.isPathTraversalAttack('../foo')).toBe(true));
  it('detects ..\\', () => expect(FileSecurityValidator.isPathTraversalAttack('..\\foo')).toBe(true));
  it('detects /etc/', () => expect(FileSecurityValidator.isPathTraversalAttack('/etc/passwd')).toBe(true));
  it('detects ~/', () => expect(FileSecurityValidator.isPathTraversalAttack('~/secret')).toBe(true));
  it('detects $HOME', () => expect(FileSecurityValidator.isPathTraversalAttack('$HOME/file')).toBe(true));
  it('detects %USERPROFILE%', () => expect(FileSecurityValidator.isPathTraversalAttack('%USERPROFILE%\\file')).toBe(true));
  it('detects Windows absolute path with /../', () => {
    expect(FileSecurityValidator.isPathTraversalAttack('C:\\foo\\..\\..\\secret')).toBe(true);
  });
  it('detects Windows absolute path with /./', () => {
    expect(FileSecurityValidator.isPathTraversalAttack('C:\\foo\\.\\bar')).toBe(true);
  });
  it('returns false for safe path', () => {
    expect(FileSecurityValidator.isPathTraversalAttack('C:\\Users\\user\\docs\\file.txt')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isAbsolutePath
// ─────────────────────────────────────────────
describe('FileSecurityValidator.isAbsolutePath', () => {
  it('detects Unix absolute path', () => expect(FileSecurityValidator.isAbsolutePath('/usr/bin')).toBe(true));
  it('detects Windows drive path', () => expect(FileSecurityValidator.isAbsolutePath('C:\\Users')).toBe(true));
  it('detects Windows drive path with forward slash', () => expect(FileSecurityValidator.isAbsolutePath('D:/foo')).toBe(true));
  it('detects UNC path', () => expect(FileSecurityValidator.isAbsolutePath('\\\\server\\share')).toBe(true));
  it('returns false for relative path', () => expect(FileSecurityValidator.isAbsolutePath('relative/path')).toBe(false));
  it('returns false for plain file name', () => expect(FileSecurityValidator.isAbsolutePath('file.txt')).toBe(false));
});

// ─────────────────────────────────────────────
// isPathInWorkspace
// ─────────────────────────────────────────────
describe('FileSecurityValidator.isPathInWorkspace', () => {
  const workspace = '/workspace/project';

  it('returns error when workspacePath is empty', () => {
    const r = FileSecurityValidator.isPathInWorkspace('/workspace/project/file.ts', '');
    expect(r.isInWorkspace).toBe(false);
    expect(r.error).toMatch(/workspace path/i);
  });

  it('returns error when filePath is empty', () => {
    const r = FileSecurityValidator.isPathInWorkspace('', workspace);
    expect(r.isInWorkspace).toBe(false);
    expect(r.error).toMatch(/file path/i);
  });

  it('returns true for a file inside workspace (absolute)', () => {
    const r = FileSecurityValidator.isPathInWorkspace('/workspace/project/src/main.ts', workspace);
    expect(r.isInWorkspace).toBe(true);
    expect(r.normalizedPath).toBeTruthy();
  });

  it('returns false for a file outside workspace', () => {
    const r = FileSecurityValidator.isPathInWorkspace('/other/location/file.ts', workspace);
    expect(r.isInWorkspace).toBe(false);
    expect(r.error).toMatch(/outside/i);
  });

  it('resolves relative path relative to workspace', () => {
    const r = FileSecurityValidator.isPathInWorkspace('src/main.ts', workspace);
    expect(r.isInWorkspace).toBe(true);
    expect(r.normalizedPath).toBe(path.resolve(workspace, 'src/main.ts'));
  });

  it('returns true for path in skills whitelist', () => {
    // Path: {userData}/profiles/{alias}/skills/myscript.ts
    const skillsPath = path.join(FAKE_USER_DATA, 'profiles', 'alice', 'skills', 'myscript.ts');
    const r = FileSecurityValidator.isPathInWorkspace(skillsPath, workspace);
    expect(r.isInWorkspace).toBe(true);
  });

  it('returns true for path in skills whitelist via global electron mock', () => {
    const altUserData = '/alt/userData';
    (global as any).electron = { app: { getPath: () => altUserData } };
    const skillsPath = path.join(altUserData, 'profiles', 'bob', 'skills', 'tool.ts');
    const r = FileSecurityValidator.isPathInWorkspace(skillsPath, workspace);
    expect(r.isInWorkspace).toBe(true);
  });

  it('returns false for profiles path that is not skills', () => {
    const nonSkillsPath = path.join(FAKE_USER_DATA, 'profiles', 'alice', 'settings', 'pref.json');
    const r = FileSecurityValidator.isPathInWorkspace(nonSkillsPath, workspace);
    // not under skills, so falls through to workspace check — likely outside workspace
    expect(r.isInWorkspace).toBe(false);
  });

  it('returns false from whitelist when electronApp is null (global.electron.app = null)', () => {
    // getElectronApp returns null when global.electron.app is falsy
    (global as any).electron = { app: null };
    const skillsPath = path.join('/some/userData', 'profiles', 'alice', 'skills', 'tool.ts');
    const r = FileSecurityValidator.isPathInWorkspace(skillsPath, workspace);
    // Whitelist check returns false -> falls to workspace check -> outside workspace
    expect(r.isInWorkspace).toBe(false);
  });

  it('returns false from whitelist when path has only one profiles segment (pathParts < 2)', () => {
    // Only 1 path part under profiles (no user alias), so pathParts[1] doesn't exist
    const partialPath = path.join(FAKE_USER_DATA, 'profiles', 'skills-only');
    const r = FileSecurityValidator.isPathInWorkspace(partialPath, workspace);
    expect(r.isInWorkspace).toBe(false);
  });
});

// ─────────────────────────────────────────────
// extractPathsFromToolArgs
// ─────────────────────────────────────────────
describe('FileSecurityValidator.extractPathsFromToolArgs', () => {
  it('extracts cwd as a path', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ cwd: '/workspace/project' });
    expect(paths).toContain('/workspace/project');
  });

  it('extracts workspaceRoot', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ workspaceRoot: '/home/user/project' });
    expect(paths).toContain('/home/user/project');
  });

  it('extracts workspace_root', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ workspace_root: '/home/user/project2' });
    expect(paths).toContain('/home/user/project2');
  });

  it('extracts workingDirectory', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ workingDirectory: '/tmp/work' });
    expect(paths).toContain('/tmp/work');
  });

  it('extracts working_directory', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ working_directory: '/tmp/work2' });
    expect(paths).toContain('/tmp/work2');
  });

  it('extracts filePath param', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ filePath: '/tmp/data.json' });
    expect(paths).toContain('/tmp/data.json');
  });

  it('extracts path param', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ path: '/tmp/file.txt' });
    expect(paths).toContain('/tmp/file.txt');
  });

  it('extracts directory param', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ directory: '/tmp/mydir' });
    expect(paths).toContain('/tmp/mydir');
  });

  it('combines relative path param with cwd', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ cwd: '/project', filePath: 'src/main.ts' });
    const combined = path.join('/project', 'src/main.ts');
    expect(paths).toContain(combined);
  });

  it('skips URLs', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ filePath: 'https://example.com/path' });
    expect(paths).toHaveLength(0);
  });

  it('skips fileType param (non-path)', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ fileType: 'json' });
    expect(paths).toHaveLength(0);
  });

  it('skips file_type param', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ file_type: 'txt' });
    expect(paths).toHaveLength(0);
  });

  it('skips extension param', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ extension: 'ts' });
    expect(paths).toHaveLength(0);
  });

  it('skips fileName param (plain name)', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ fileName: 'report.csv' });
    expect(paths).toHaveLength(0);
  });

  it('extracts Unix absolute path from explicit path key', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ filePath: '/home/user/documents/report.pdf' });
    expect(paths).toContain('/home/user/documents/report.pdf');
  });

  it('extracts multi-component Unix absolute path from generic string field', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ output: '/usr/local/bin/myapp' });
    expect(paths).toContain('/usr/local/bin/myapp');
  });

  it('does not extract single-component Unix-like string', () => {
    // /singleword — only 1 component, should not be added
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ x: '/singleword' });
    expect(paths).not.toContain('/singleword');
  });

  it('extracts paths from command field', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ command: 'cp /workspace/src/file.ts /tmp/dest.ts' });
    expect(paths.some(p => p.includes('file.ts') || p.includes('dest.ts'))).toBe(true);
  });

  it('combines relative command paths with cwd', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({
      cwd: '/workspace',
      command: 'node script.js',
    });
    expect(paths.some(p => p.includes('script.js'))).toBe(true);
  });

  it('extracts paths from nested objects', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({
      nested: { filePath: '/nested/deep/file.txt' },
    });
    expect(paths).toContain('/nested/deep/file.txt');
  });

  it('extracts paths from array elements', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs([{ filePath: '/arr/file.txt' }]);
    expect(paths).toContain('/arr/file.txt');
  });

  it('returns empty array for null toolArgs', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs(null);
    expect(paths).toEqual([]);
  });

  it('handles cmd key same as command key', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ cmd: 'ls /tmp/mydir' });
    expect(paths.some(p => p.includes('/tmp/mydir'))).toBe(true);
  });

  it('handles dirPath key', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ dirPath: '/tmp/somedir' });
    expect(paths).toContain('/tmp/somedir');
  });

  it('handles paths ending with Path or _path', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({
      outputPath: '/out/result.txt',
      source_path: '/src/input.txt',
    });
    expect(paths).toContain('/out/result.txt');
    expect(paths).toContain('/src/input.txt');
  });

  it('handles paths ending with Directory or _directory', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({
      outputDirectory: '/out/folder',
      target_directory: '/target/folder',
    });
    expect(paths).toContain('/out/folder');
    expect(paths).toContain('/target/folder');
  });

  it('handles truncated URL-like string (ws://) as URL — skips it', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ filePath: 'ws://localhost:3000' });
    expect(paths).toHaveLength(0);
  });

  it('handles truncated URL-like string with s:// pattern', () => {
    // Hits /^[a-z]s?:\/\//i branch (e.g. "as://something")
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ filePath: 'as://example.com/path' });
    expect(paths).toHaveLength(0);
  });

  it('combines relative filePath param with cwd', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({
      cwd: '/project',
      filePath: 'relative/sub/file.ts',
    });
    expect(paths).toContain(path.join('/project', 'relative/sub/file.ts'));
  });

  it('extracts absolute path param directly (no cwd needed)', () => {
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ outputPath: '/abs/path/output.txt' });
    expect(paths).toContain('/abs/path/output.txt');
  });

  it('skips plain identifier values for path keys (looksLikeExtensionOrName check)', () => {
    // filePath: 'myfile' — no slash, short, alphanumeric => treated as plain name, skipped
    const paths = FileSecurityValidator.extractPathsFromToolArgs({ filePath: 'myfile' });
    expect(paths).toHaveLength(0);
  });

  it('ignores depth beyond 10', () => {
    // Build an object 12 levels deep
    let deep: any = { filePath: '/deep/file.txt' };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    // Should not throw, may or may not find the path depending on cutoff
    expect(() => FileSecurityValidator.extractPathsFromToolArgs(deep)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// validateToolPathsInWorkspace
// ─────────────────────────────────────────────
describe('FileSecurityValidator.validateToolPathsInWorkspace', () => {
  it('approves all paths when no workspace configured', () => {
    const result = FileSecurityValidator.validateToolPathsInWorkspace({ filePath: '/anywhere' }, undefined);
    expect(result.allPathsValid).toBe(true);
    expect(result.pathsOutsideWorkspace).toHaveLength(0);
  });

  it('approves all paths when workspace is empty string', () => {
    const result = FileSecurityValidator.validateToolPathsInWorkspace({ filePath: '/anywhere' }, '');
    expect(result.allPathsValid).toBe(true);
  });

  it('approves when no paths are found in args', () => {
    const result = FileSecurityValidator.validateToolPathsInWorkspace({ count: 5 }, '/workspace');
    expect(result.allPathsValid).toBe(true);
  });

  it('approves paths inside workspace', () => {
    const workspace = '/workspace/project';
    const result = FileSecurityValidator.validateToolPathsInWorkspace(
      { filePath: '/workspace/project/src/main.ts' },
      workspace,
    );
    expect(result.allPathsValid).toBe(true);
    expect(result.pathsOutsideWorkspace).toHaveLength(0);
  });

  it('rejects paths outside workspace', () => {
    const workspace = '/workspace/project';
    const result = FileSecurityValidator.validateToolPathsInWorkspace(
      { filePath: '/etc/passwd' },
      workspace,
    );
    expect(result.allPathsValid).toBe(false);
    expect(result.pathsOutsideWorkspace.length).toBeGreaterThan(0);
  });

  it('handles whitespace-only workspace', () => {
    const result = FileSecurityValidator.validateToolPathsInWorkspace({ filePath: '/tmp/file' }, '   ');
    expect(result.allPathsValid).toBe(true);
  });
});
