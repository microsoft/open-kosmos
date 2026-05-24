const TIMESTAMP_LENGTH = 14;
const RANDOM_SEGMENT_LENGTH = 9;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function buildTimestampSegment(date: Date = new Date()): string {
  return [
    date.getFullYear().toString(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('');
}

export function normalizeDeviceIdSegment(deviceId: string | null | undefined): string {
  const normalized = (deviceId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized || 'unknown-device';
}

export function generateRandomIdSegment(length: number = RANDOM_SEGMENT_LENGTH): string {
  return Math.random().toString(36).slice(2, 2 + length).padEnd(length, '0');
}

export function buildChatId(
  deviceId: string,
  date: Date = new Date(),
  randomSegment: string = generateRandomIdSegment(),
): string {
  return `chat_${buildTimestampSegment(date)}_${normalizeDeviceIdSegment(deviceId)}_${randomSegment}`;
}

export function buildChatSessionId(
  deviceId: string,
  date: Date = new Date(),
  randomSegment: string = generateRandomIdSegment(),
): string {
  return `chatSession_${buildTimestampSegment(date)}_${normalizeDeviceIdSegment(deviceId)}_${randomSegment}`;
}

export function buildScheduleJobId(
  deviceId: string,
  date: Date = new Date(),
  randomSegment: string = generateRandomIdSegment(),
): string {
  return `sched_${buildTimestampSegment(date)}_${normalizeDeviceIdSegment(deviceId)}_${randomSegment}`;
}

export function buildEvalSessionId(
  deviceId: string,
  date: Date = new Date(),
  randomSegment: string = generateRandomIdSegment(),
): string {
  return `evalSession_${buildTimestampSegment(date)}_${normalizeDeviceIdSegment(deviceId)}_${randomSegment}`;
}

export function isValidChatSessionIdFormat(chatSessionId: string): boolean {
  if (typeof chatSessionId !== 'string') {
    return false;
  }

  return /^chatSession_\d{14}(?:_[a-z0-9-]+_[a-z0-9]+)?$/i.test(chatSessionId);
}

export function extractMonthFromChatSessionIdValue(chatSessionId: string): string | null {
  if (typeof chatSessionId !== 'string') {
    return null;
  }

  const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})\d{8}(?:_[a-z0-9-]+_[a-z0-9]+)?$/i);
  return match ? `${match[1]}${match[2]}` : null;
}

export function isTimestampPrefixedChatSessionId(chatSessionId: string): boolean {
  return typeof chatSessionId === 'string'
    && chatSessionId.startsWith('chatSession_')
    && chatSessionId.length >= 'chatSession_'.length + TIMESTAMP_LENGTH;
}