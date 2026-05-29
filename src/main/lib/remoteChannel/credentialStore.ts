import { safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getUserDataPath } from '../userDataADO/pathUtils';

/**
 * Remote channel credential store
 *
 * Uses Electron safeStorage to encrypt sensitive credentials (e.g., bindingToken),
 * stored as encrypted Buffer files so they never appear in plaintext in profile.json.
 *
 * Storage path: {userData}/profiles/{alias}/credentials/
 * File naming: {channelId}_{key}.enc (e.g., teams_bindingToken.enc)
 */

function getCredentialDir(alias: string): string {
  return path.join(getUserDataPath(), 'profiles', alias, 'credentials');
}

async function setCredential(alias: string, channelId: string, key: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this system');
  }
  const dir = getCredentialDir(alias);
  await fs.promises.mkdir(dir, { recursive: true });
  const encrypted = safeStorage.encryptString(value);
  await fs.promises.writeFile(path.join(dir, `${channelId}_${key}.enc`), encrypted);
}

async function getCredential(alias: string, channelId: string, key: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const filePath = path.join(getCredentialDir(alias), `${channelId}_${key}.enc`);
  try {
    const encrypted = await fs.promises.readFile(filePath);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

async function deleteCredential(alias: string, channelId: string, key: string): Promise<void> {
  const filePath = path.join(getCredentialDir(alias), `${channelId}_${key}.enc`);
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Silently ignore if file does not exist
  }
}

async function hasCredential(alias: string, channelId: string, key: string): Promise<boolean> {
  const filePath = path.join(getCredentialDir(alias), `${channelId}_${key}.enc`);
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const credentialStore = { setCredential, getCredential, deleteCredential, hasCredential };
