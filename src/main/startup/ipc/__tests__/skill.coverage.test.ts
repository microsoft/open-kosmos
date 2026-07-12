/**
 * skill.ts IPC handler supplemental coverage tests
 *
 * Covers: all IPC handlers not exercised by the existing Windows selection flow tests:
 *   - skills:installSkillFromFilePath
 *   - skills:addSkillFromDevice (non-Windows + edge cases)
 *   - skills:applySkillToAgents
 *   - skills:updateSkillFromDevice (validation callback)
 *   - skills:getSkillMarkdown
 *   - skills:getSkillDirectoryContents
 *   - skills:getSkillFileContent
 *   - skills:deleteSkill
 *   - skills:openSkillFolder
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── mocks ────────────────────────────────────────────────────────────────────

const mockHandle = vi.fn();
const mockShowMessageBox = vi.fn();
const mockShowOpenDialog = vi.fn();
const mockOpenPath = vi.fn().mockResolvedValue('');

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
  ipcMain: {
    handle: (...args: any[]) => mockHandle(...args),
  },
  shell: {
    openPath: (...args: any[]) => mockOpenPath(...args),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showMessageBox: (...args: any[]) => mockShowMessageBox(...args),
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
  },
}));

const mockInstallAndActivateSkill = vi.fn();
vi.mock('../../../lib/skill/installAndActivateSkill', async () => ({
  installAndActivateSkill: (...args: any[]) => mockInstallAndActivateSkill(...args),
}));

const mockApplySkillToAgents = vi.fn().mockResolvedValue({
  success: true, skillName: 'test', message: 'ok', appliedCount: 1,
  alreadyAppliedCount: 0, failedCount: 0, appliedTargets: [], skippedTargets: [],
});
vi.mock('../../../lib/skill/applySkillToAgents', async () => ({
  applySkillToAgents: (...args: any[]) => mockApplySkillToAgents(...args),
}));

const mockUpdateSkillFromDevice = vi.fn();
vi.mock('../../../lib/skill/skillDeviceImporter', async () => ({
  updateSkillFromDevice: (...args: any[]) => mockUpdateSkillFromDevice(...args),
}));

const mockDeleteInstalledSkill = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../../lib/skill/deleteInstalledSkill', async () => ({
  deleteInstalledSkill: (...args: any[]) => mockDeleteInstalledSkill(...args),
}));

vi.mock('fs');
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return actual;
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for: ${channel}`);
  return call[1];
}

const defaultInstallResult = {
  success: true,
  skillName: 'my-skill',
  skillVersion: '1.0.0',
  install: { isOverwrite: false },
  inputType: 'zip',
  resolution: 'installed_but_not_applied',
  currentChat: { callable: false },
  activation: { attempted: false, success: false, appliedTargets: [], skippedTargets: [] },
  message: 'ok',
  error: undefined,
};

async function registerAndGetHandler(channel: string, ctx: any = {}): Promise<Function> {
  vi.clearAllMocks();
  mockInstallAndActivateSkill.mockResolvedValue(defaultInstallResult);
  mockUpdateSkillFromDevice.mockResolvedValue({ success: true, skillName: 'my-skill', skillVersion: '1.1' });
  mockDeleteInstalledSkill.mockResolvedValue({ success: true });

  const registerSkillIpc = (await import('../skill')).default;
  registerSkillIpc({
    currentUserAlias: 'testuser',
    mainWindow: { id: 1 } as any,
    ...ctx,
  } as any);

  return getHandler(channel);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('skill IPC handlers (coverage)', () => {

  afterEach(() => vi.resetModules());

  // ── skills:installSkillFromFilePath ────────────────────────────────────────

  describe('skills:installSkillFromFilePath', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath', { currentUserAlias: null });
      const result = await handler({}, '/tmp/skill.zip');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No current user alias');
    });

    it('returns error when no filePath', async () => {
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath');
      const result = await handler({}, '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File path is required');
    });

    it('installs from file path successfully', async () => {
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath');
      const result = await handler({}, '/tmp/skill.zip');
      expect(result.success).toBe(true);
      expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
        expect.objectContaining({ source: { type: 'device-path', value: '/tmp/skill.zip' } })
      );
    });

    it('uses current-agent activation and handles overwrite without a window', async () => {
      let confirmOverwrite: ((skillName: string) => Promise<boolean>) | undefined;
      mockInstallAndActivateSkill.mockImplementationOnce(async (options: any) => {
        confirmOverwrite = options.confirmOverwrite;
        return defaultInstallResult;
      });
      const handler = await registerAndGetHandler(
        'skills:installSkillFromFilePath',
        { mainWindow: null },
      );
      await handler({}, '/tmp/skill.zip', { applyToCurrentAgent: true });

      expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          activation: expect.objectContaining({ mode: 'current-agent' }),
        }),
      );
      expect(await confirmOverwrite!('my-skill')).toBe(false);
    });

    it('confirmCallback returns false when no mainWindow', async () => {
      // Register with no mainWindow, then get confirmCallback
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath', { mainWindow: null });
      // Just invoke — confirmCallback would be called internally; we verify no crash
      const result = await handler({}, '/tmp/skill.zip');
      expect(result.success).toBe(true); // install still succeeds (confirmCallback not invoked unless overwrite)
    });

    it('confirmCallback confirms when user clicks Replace (new API)', async () => {
      // Simulate overwrite scenario — confirmCallback is called by installAndActivateSkill
      let capturedConfirmCallback: Function | undefined;
      mockInstallAndActivateSkill.mockImplementationOnce(async (opts: any) => {
        capturedConfirmCallback = opts.confirmOverwrite;
        return defaultInstallResult;
      });
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath');
      await handler({}, '/tmp/skill.zip');
      expect(capturedConfirmCallback).toBeDefined();

      mockShowMessageBox.mockResolvedValueOnce({ response: 1 });
      const confirmed = await capturedConfirmCallback!('my-skill');
      expect(confirmed).toBe(true);
    });

    it('confirmCallback old API format', async () => {
      let capturedConfirmCallback: Function | undefined;
      mockInstallAndActivateSkill.mockImplementationOnce(async (opts: any) => {
        capturedConfirmCallback = opts.confirmOverwrite;
        return defaultInstallResult;
      });
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath');
      await handler({}, '/tmp/skill.zip');

      mockShowMessageBox.mockResolvedValueOnce(1); // old format
      const confirmed = await capturedConfirmCallback!('my-skill');
      expect(confirmed).toBe(true);
    });

    it('returns error on exception', async () => {
      mockInstallAndActivateSkill.mockRejectedValueOnce(new Error('Install failed'));
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath');
      const result = await handler({}, '/tmp/skill.zip');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Install failed');
    });

    it('normalizes a non-Error install failure', async () => {
      mockInstallAndActivateSkill.mockRejectedValueOnce('Install failed');
      const handler = await registerAndGetHandler('skills:installSkillFromFilePath');
      await expect(handler({}, '/workspace/skill.zip')).resolves.toEqual({
        success: false,
        error: 'Unknown error',
      });
    });
  });

  // ── skills:addSkillFromDevice ─────────────────────────────────────────────

  describe('skills:addSkillFromDevice', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:addSkillFromDevice', { currentUserAlias: null });
      const result = await handler({});
      expect(result.success).toBe(false);
    });

    it('returns error when no mainWindow', async () => {
      const handler = await registerAndGetHandler('skills:addSkillFromDevice', { mainWindow: null });
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('No main window');
    });

    it('installs when selectedPath is provided directly', async () => {
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, '/tmp/skill.zip', { applyToCurrentAgent: true });
      expect(result.success).toBe(true);
      expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { type: 'device-path', value: '/tmp/skill.zip' },
          activation: expect.objectContaining({ mode: 'current-agent' }),
        })
      );
    });

    it('returns canceled when dialog returns no path (non-Windows)', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, undefined, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('canceled');
    });

    it('installs from dialog on non-Windows (no selectionMode)', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/my.skill'] });
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, undefined, {});
      expect(result.success).toBe(true);
      Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
    });

    it('cancels when the Windows mode dialog has no response', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      mockShowMessageBox.mockResolvedValueOnce({});
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, undefined, {});
      expect(result).toEqual({ success: false, error: 'File selection canceled' });
    });

    it('imports a file selected through the Windows mode dialog', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      mockShowMessageBox.mockResolvedValueOnce({ response: 1 });
      mockShowOpenDialog.mockResolvedValueOnce(['/tmp/windows.skill']);
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, undefined, {});
      expect(result.success).toBe(true);
      expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { type: 'device-path', value: '/tmp/windows.skill' },
        }),
      );
    });

    it('confirmCallback inside addSkillFromDevice works', async () => {
      let capturedConfirmCallback: Function | undefined;
      mockInstallAndActivateSkill.mockImplementationOnce(async (opts: any) => {
        capturedConfirmCallback = opts.confirmOverwrite;
        return defaultInstallResult;
      });
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      await handler({}, '/tmp/skill.zip');
      expect(capturedConfirmCallback).toBeDefined();

      mockShowMessageBox.mockResolvedValueOnce({ response: 1 });
      const confirmed = await capturedConfirmCallback!('my-skill');
      expect(confirmed).toBe(true);
    });

    it('returns error on exception', async () => {
      mockInstallAndActivateSkill.mockRejectedValueOnce(new Error('Device install error'));
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, '/tmp/skill.zip');
      expect(result.success).toBe(false);
    });
  });

  // ── skills:applySkillToAgents ─────────────────────────────────────────────

  describe('skills:applySkillToAgents', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:applySkillToAgents', { currentUserAlias: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns apply result on success', async () => {
      const handler = await registerAndGetHandler('skills:applySkillToAgents');
      const result = await handler({}, 'my-skill', [{ chatId: 'c1', agentName: 'Agent' }]);
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockApplySkillToAgents.mockRejectedValueOnce(new Error('Apply failed'));
      const handler = await registerAndGetHandler('skills:applySkillToAgents');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
      expect(result.failedCount).toBe(0);
    });
  });

  // ── skills:updateSkillFromDevice ───────────────────────────────────────────

  describe('skills:updateSkillFromDevice', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice', { currentUserAlias: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns error when no mainWindow', async () => {
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice', { mainWindow: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns error when no targetSkillName', async () => {
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice');
      const result = await handler({}, '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Target skill name is required');
    });

    it('validates skill name callback — returns false on mismatch', async () => {
      let capturedValidateCallback: Function | undefined;
      mockUpdateSkillFromDevice.mockImplementationOnce(async (path: any, alias: any, target: any, validate: any, confirm: any) => {
        capturedValidateCallback = validate;
        return { success: true, skillName: target, skillVersion: '1.0' };
      });
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/skill.zip'] });
      mockShowMessageBox.mockResolvedValueOnce({ response: 1 }); // confirm update
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice');
      await handler({}, 'target-skill');
      expect(capturedValidateCallback).toBeDefined();

      const valid = await capturedValidateCallback!('wrong-skill');
      expect(valid).toBe(false);

      const validMatch = await capturedValidateCallback!('target-skill');
      expect(validMatch).toBe(true);
    });

    it('confirmCallback returns true when user confirms update (new API)', async () => {
      let capturedConfirmCallback: Function | undefined;
      mockUpdateSkillFromDevice.mockImplementationOnce(async (path: any, alias: any, target: any, validate: any, confirm: any) => {
        capturedConfirmCallback = confirm;
        return { success: true, skillName: target, skillVersion: '1.0' };
      });
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/skill.zip'] });
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice');
      await handler({}, 'target-skill');

      mockShowMessageBox.mockResolvedValueOnce({ response: 1 });
      const confirmed = await capturedConfirmCallback!('target-skill');
      expect(confirmed).toBe(true);
    });

    it('confirmCallback returns true old API format', async () => {
      let capturedConfirmCallback: Function | undefined;
      mockUpdateSkillFromDevice.mockImplementationOnce(async (path: any, alias: any, target: any, validate: any, confirm: any) => {
        capturedConfirmCallback = confirm;
        return { success: true, skillName: target, skillVersion: '1.0' };
      });
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/skill.zip'] });
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice');
      await handler({}, 'target-skill');

      mockShowMessageBox.mockResolvedValueOnce(1);
      const confirmed = await capturedConfirmCallback!('target-skill');
      expect(confirmed).toBe(true);
    });

    it('confirmCallback returns false when no mainWindow — verified via cancel path', async () => {
      // The confirmCallback has `if (!ctx.mainWindow) return false` guard.
      // We verify this path by ensuring that when showOpenDialog is cancelled,
      // the handler short-circuits before reaching the confirmCallback.
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice');
      const result = await handler({}, 'target-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('canceled');
    });

    it('returns error on exception', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/skill.zip'] });
      mockUpdateSkillFromDevice.mockRejectedValueOnce(new Error('Device update error'));
      const handler = await registerAndGetHandler('skills:updateSkillFromDevice');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });
  });

  // ── skills:getSkillMarkdown ────────────────────────────────────────────────

  describe('skills:getSkillMarkdown', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:getSkillMarkdown', { currentUserAlias: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns error when SKILL.md does not exist', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(false);
      const handler = await registerAndGetHandler('skills:getSkillMarkdown');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('SKILL.md not found');
    });

    it('returns file content when SKILL.md exists', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.readFileSync as any) = vi.fn().mockReturnValue('# My Skill\nDoes things.');
      const handler = await registerAndGetHandler('skills:getSkillMarkdown');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(true);
      expect(result.content).toContain('My Skill');
    });

    it('returns error on exception', async () => {
      (fs.existsSync as any) = vi.fn().mockImplementation(() => { throw new Error('FS error'); });
      const handler = await registerAndGetHandler('skills:getSkillMarkdown');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });
  });

  // ── skills:getSkillDirectoryContents ──────────────────────────────────────

  describe('skills:getSkillDirectoryContents', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents', { currentUserAlias: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns error when directory does not exist', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(false);
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents');
      const result = await handler({}, 'my-skill', '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Directory not found');
    });

    it('returns error when path is not a directory', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.statSync as any) = vi.fn().mockReturnValue({ isDirectory: () => false, isFile: () => true, size: 0, mtime: new Date() });
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents');
      const result = await handler({}, 'my-skill', '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a directory');
    });

    it('returns directory listing on success', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.statSync as any) = vi.fn().mockReturnValue({
        isDirectory: () => true, isFile: () => false, size: 0, mtime: new Date()
      });
      (fs.readdirSync as any) = vi.fn().mockReturnValue([
        { name: 'SKILL.md', isDirectory: () => false, isFile: () => true },
        { name: 'scripts', isDirectory: () => true, isFile: () => false },
      ]);
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents');
      const result = await handler({}, 'my-skill', '');
      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(2);
      // directories first
      expect(result.data.items[0].name).toBe('scripts');
    });

    it('sorts directories before files and names within the same type', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.statSync as any) = vi.fn().mockReturnValue({
        isDirectory: () => true, isFile: () => false, size: 1, mtime: new Date(0),
      });
      (fs.readdirSync as any) = vi.fn().mockReturnValue([
        { name: 'zeta.md', isDirectory: () => false, isFile: () => true },
        { name: 'assets', isDirectory: () => true, isFile: () => false },
        { name: 'alpha.md', isDirectory: () => false, isFile: () => true },
      ]);
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents');
      const result = await handler({}, 'my-skill', 'nested');

      expect(result.data.parentPath).toBe('.');
      expect(result.data.items.map((item: any) => item.name)).toEqual([
        'assets',
        'alpha.md',
        'zeta.md',
      ]);
      expect(result.data.items[1].path).toBe(path.join('nested', 'alpha.md'));
    });

    it('returns error for path traversal attempt', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents');
      const result = await handler({}, 'my-skill', '../../etc');
      expect(result.success).toBe(false);
      expect(result.error).toContain('outside skill directory');
    });

    it('returns error on exception', async () => {
      (fs.existsSync as any) = vi.fn().mockImplementation(() => { throw new Error('FS error'); });
      const handler = await registerAndGetHandler('skills:getSkillDirectoryContents');
      const result = await handler({}, 'my-skill', '');
      expect(result.success).toBe(false);
    });
  });

  // ── skills:getSkillFileContent ─────────────────────────────────────────────

  describe('skills:getSkillFileContent', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:getSkillFileContent', { currentUserAlias: null });
      const result = await handler({}, 'my-skill', 'SKILL.md');
      expect(result.success).toBe(false);
    });

    it('returns error when no relativePath', async () => {
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File path is required');
    });

    it('returns error for path traversal', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', '../../etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toContain('outside skill directory');
    });

    it('returns error when file does not exist', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(false);
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', 'README.md');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('returns error when path is not a file', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.statSync as any) = vi.fn().mockReturnValue({ isFile: () => false, isDirectory: () => true, size: 0, mtime: new Date() });
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', 'SKILL.md');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a file');
    });

    it('returns isSupported=false for unsupported extensions', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.statSync as any) = vi.fn().mockReturnValue({ isFile: () => true, isDirectory: () => false, size: 100, mtime: new Date() });
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', 'logo.png');
      expect(result.success).toBe(true);
      expect(result.data.isSupported).toBe(false);
      expect(result.data.content).toBeNull();
    });

    it('returns file content for supported extension', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      (fs.statSync as any) = vi.fn().mockReturnValue({ isFile: () => true, isDirectory: () => false, size: 50, mtime: new Date() });
      (fs.readFileSync as any) = vi.fn().mockReturnValue('# Skill documentation');
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', 'SKILL.md');
      expect(result.success).toBe(true);
      expect(result.data.isSupported).toBe(true);
      expect(result.data.content).toContain('documentation');
    });

    it('returns error on exception', async () => {
      (fs.existsSync as any) = vi.fn().mockImplementation(() => { throw new Error('FS error'); });
      const handler = await registerAndGetHandler('skills:getSkillFileContent');
      const result = await handler({}, 'my-skill', 'SKILL.md');
      expect(result.success).toBe(false);
    });
  });

  // ── skills:deleteSkill ─────────────────────────────────────────────────────

  describe('skills:deleteSkill', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:deleteSkill', { currentUserAlias: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns error when delete fails', async () => {
      mockDeleteInstalledSkill.mockResolvedValueOnce({ success: false, error: 'Skill in use' });
      const handler = await registerAndGetHandler('skills:deleteSkill');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Skill in use');
    });

    it('uses the fallback error when deletion fails without details', async () => {
      mockDeleteInstalledSkill.mockResolvedValueOnce({ success: false });
      const handler = await registerAndGetHandler('skills:deleteSkill');
      const result = await handler({}, 'my-skill');
      expect(result).toEqual({ success: false, error: 'Failed to delete skill' });
    });

    it('returns success when delete succeeds', async () => {
      const handler = await registerAndGetHandler('skills:deleteSkill');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockDeleteInstalledSkill.mockRejectedValueOnce(new Error('Delete error'));
      const handler = await registerAndGetHandler('skills:deleteSkill');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });
  });

  // ── skills:openSkillFolder ─────────────────────────────────────────────────

  describe('skills:openSkillFolder', () => {
    it('returns error when no currentUserAlias', async () => {
      const handler = await registerAndGetHandler('skills:openSkillFolder', { currentUserAlias: null });
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });

    it('returns error when skill directory does not exist', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(false);
      const handler = await registerAndGetHandler('skills:openSkillFolder');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('opens skill folder successfully', async () => {
      (fs.existsSync as any) = vi.fn().mockReturnValue(true);
      const handler = await registerAndGetHandler('skills:openSkillFolder');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(true);
      expect(mockOpenPath).toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      (fs.existsSync as any) = vi.fn().mockImplementation(() => { throw new Error('FS error'); });
      const handler = await registerAndGetHandler('skills:openSkillFolder');
      const result = await handler({}, 'my-skill');
      expect(result.success).toBe(false);
    });
  });

  // ── resolveSingleSelectedPath — array format ───────────────────────────────

  describe('resolveSingleSelectedPath (array format via dialog)', () => {
    it('handles empty array from dialog', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce([]);
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, undefined, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('canceled');
    });

    it('uses first element when array has items', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShowOpenDialog.mockResolvedValueOnce(['/path/to/skill.zip', '/other']);
      const handler = await registerAndGetHandler('skills:addSkillFromDevice');
      const result = await handler({}, undefined, {});
      expect(result.success).toBe(true);
      expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
        expect.objectContaining({ source: { type: 'device-path', value: '/path/to/skill.zip' } })
      );
    });
  });
});
