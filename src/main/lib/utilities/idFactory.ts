import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { buildChatId, buildChatSessionId, buildEvalSessionId, buildScheduleJobId } from '../../../shared/utils/idFormats';

function resolveUserDataPath(): string {
  try {
    return app.getPath('userData');
  } catch {
    return process.env.OPENKOSMOS_TEST_USER_DATA_PATH || path.join(os.tmpdir(), 'openkosmos-app-test');
  }
}

export function getOrCreateInstallationDeviceId(): string {
  const userDataPath = resolveUserDataPath();
  const idFilePath = path.join(userDataPath, 'installation-device-id');
  const legacyIdFilePath = path.join(userDataPath, 'analytics-device-id');

  try {
    const existingId = fs.existsSync(idFilePath)
      ? fs.readFileSync(idFilePath, 'utf8').trim()
      : '';

    if (existingId) {
      return existingId;
    }

    const legacyId = fs.existsSync(legacyIdFilePath)
      ? fs.readFileSync(legacyIdFilePath, 'utf8').trim()
      : '';
    if (legacyId) {
      fs.renameSync(legacyIdFilePath, idFilePath);
      return legacyId;
    }

    const nextId = randomUUID();
    fs.mkdirSync(path.dirname(idFilePath), { recursive: true });
    fs.writeFileSync(idFilePath, nextId, 'utf8');
    return nextId;
  } catch {
    return randomUUID();
  }
}

export function generateChatId(): string {
  return buildChatId(getOrCreateInstallationDeviceId());
}

export function generateChatSessionId(): string {
  return buildChatSessionId(getOrCreateInstallationDeviceId());
}

export function generateScheduleJobId(date: Date = new Date()): string {
  return buildScheduleJobId(getOrCreateInstallationDeviceId(), date);
}

export function generateEvalSessionId(): string {
  return buildEvalSessionId(getOrCreateInstallationDeviceId());
}