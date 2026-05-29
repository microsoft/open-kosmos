import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeStorage } from 'electron';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

vi.mock('fs', () => ({
  default: { promises: fsMocks },
  promises: fsMocks,
}));

vi.mock('../../userDataADO/pathUtils', () => ({
  getUserDataPath: vi.fn(() => '/tmp/test-userdata'),
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('enc:', '')),
  },
  app: { getPath: vi.fn(() => '/tmp/test') },
}));

import { credentialStore } from '../credentialStore';

describe('credentialStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => Buffer.from(`enc:${s}`));
    vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString().replace('enc:', ''));
  });

  describe('setCredential', () => {
    it('encrypts and writes credential file', async () => {
      fsMocks.mkdir.mockResolvedValue(undefined);
      fsMocks.writeFile.mockResolvedValue(undefined);

      await credentialStore.setCredential('user1', 'teams', 'bindingToken', 'secret-value');

      expect(fsMocks.mkdir).toHaveBeenCalled();
      expect(fsMocks.writeFile).toHaveBeenCalled();
      const writtenPath = fsMocks.writeFile.mock.calls[0][0];
      expect(writtenPath).toContain('teams_bindingToken.enc');
    });

    it('throws when encryption not available', async () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      await expect(credentialStore.setCredential('u1', 'ch', 'key', 'val')).rejects.toThrow(
        'Encryption not available',
      );
    });
  });

  describe('getCredential', () => {
    it('returns decrypted value when file exists', async () => {
      fsMocks.readFile.mockResolvedValue(Buffer.from('enc:my-secret'));

      const result = await credentialStore.getCredential('user1', 'teams', 'bindingToken');
      expect(result).toBe('my-secret');
    });

    it('returns null when file does not exist', async () => {
      fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await credentialStore.getCredential('user1', 'teams', 'bindingToken');
      expect(result).toBeNull();
    });

    it('returns null when encryption not available', async () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      const result = await credentialStore.getCredential('u1', 'ch', 'key');
      expect(result).toBeNull();
    });
  });

  describe('deleteCredential', () => {
    it('deletes the credential file', async () => {
      fsMocks.unlink.mockResolvedValue(undefined);

      await credentialStore.deleteCredential('user1', 'teams', 'bindingToken');
      expect(fsMocks.unlink).toHaveBeenCalled();
      const unlinkedPath = fsMocks.unlink.mock.calls[0][0];
      expect(unlinkedPath).toContain('teams_bindingToken.enc');
    });

    it('silently ignores ENOENT when file does not exist', async () => {
      fsMocks.unlink.mockRejectedValue(new Error('ENOENT'));

      await expect(credentialStore.deleteCredential('u1', 'ch', 'key')).resolves.not.toThrow();
    });
  });

  describe('hasCredential', () => {
    it('returns true when file is accessible', async () => {
      fsMocks.access.mockResolvedValue(undefined);

      const result = await credentialStore.hasCredential('user1', 'teams', 'bindingToken');
      expect(result).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      fsMocks.access.mockRejectedValue(new Error('ENOENT'));

      const result = await credentialStore.hasCredential('user1', 'teams', 'bindingToken');
      expect(result).toBe(false);
    });
  });
});
