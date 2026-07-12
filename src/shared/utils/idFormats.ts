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

/**
 * Build a stable, unique Agent id that is independent of the agent name.
 * Format: `agent_{YYYYMMDDHHMMSS}_{random}`, mirroring the other timestamped ids
 * in this module (`chat_`, `sched_`, ...). This is the id minted for every new
 * agent: because it does not encode the name, renaming an agent keeps its id —
 * the precondition for editing an agent (including rename) without rewriting the
 * chat→agent mapping in profile.json or pruning/rewriting its store entry.
 */
export function buildAgentUuid(
  date: Date = new Date(),
  randomSegment: string = generateRandomIdSegment(),
): string {
  return `agent_${buildTimestampSegment(date)}_${randomSegment}`;
}

/**
 * @deprecated Legacy name-derived Agent id, kept only as a migration fallback
 * for inline agents that predate the standalone store and carry no `id`. New
 * agents use {@link buildAgentUuid}; do not use this for newly created agents.
 *
 * Format: `agent-{name-lowercased-hyphenated}-{source-lowercased}`. Agent names
 * were unique app-wide, so the derived id was unique. Unicode letters/numbers
 * (e.g. CJK names) are preserved so distinct non-ASCII names map to distinct ids
 * instead of all collapsing to `agent-{source}`. This mirrors the legacy
 * per-agent workspace folder name so existing layouts map cleanly.
 */
export function buildAgentId(name: string, source: string | undefined): string {
  const normalizedName = (name || 'agent')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    // Keep Unicode letters/numbers (e.g. CJK) so non-ASCII names are not collapsed
    // to "agent" and do not collide; this also strips path-unsafe chars to "-".
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'agent';
  const normalizedSource = (source || 'ON-DEVICE').toLowerCase();
  return `agent-${normalizedName}-${normalizedSource}`;
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