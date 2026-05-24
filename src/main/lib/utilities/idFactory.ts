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
    return process.env.OpenKosmos_TEST_USER_DATA_PATH || path.join(os.tmpdir(), 'openkosmos-app-test');
  }
}

export function getOrCreateInstallationDeviceId(): string {
  const idFilePath = path.join(resolveUserDataPath(), 'analytics-device-id');

  try {
    const existingId = fs.existsSync(idFilePath)
      ? fs.readFileSync(idFilePath, 'utf8').trim()
      : '';

    if (existingId) {
      return existingId;
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