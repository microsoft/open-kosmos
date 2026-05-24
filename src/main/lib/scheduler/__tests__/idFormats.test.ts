import {
  buildTimestampSegment,
  normalizeDeviceIdSegment,
  buildChatId,
  buildChatSessionId,
  buildScheduleJobId,
  buildEvalSessionId,
  generateRandomIdSegment,
  isValidChatSessionIdFormat,
  extractMonthFromChatSessionIdValue,
  isTimestampPrefixedChatSessionId,
} from '../../../../shared/utils/idFormats';

describe('idFormats', () => {
  it('buildTimestampSegment returns 14-digit string', () => {
    const date = new Date(2026, 2, 30, 15, 4, 5);
    expect(buildTimestampSegment(date)).toBe('20260330150405');
  });

  it('normalizeDeviceIdSegment handles special chars', () => {
    expect(normalizeDeviceIdSegment('My Device!')).toBe('my-device');
    expect(normalizeDeviceIdSegment('')).toBe('unknown-device');
    expect(normalizeDeviceIdSegment(null)).toBe('unknown-device');
    expect(normalizeDeviceIdSegment(undefined)).toBe('unknown-device');
  });

  it('generateRandomIdSegment returns the requested length', () => {
    const seg = generateRandomIdSegment(8);
    expect(seg.length).toBe(8);
  });

  it('buildChatId matches expected format', () => {
    const id = buildChatId('my-device', new Date(2026, 2, 30, 15, 4, 5), 'abc123xyz');
    expect(id).toBe('chat_20260330150405_my-device_abc123xyz');
  });

  it('buildChatSessionId matches expected format', () => {
    const id = buildChatSessionId('my-device', new Date(2026, 2, 30, 15, 4, 5), 'abc123xyz');
    expect(id).toBe('chatSession_20260330150405_my-device_abc123xyz');
  });

  it('buildScheduleJobId matches expected format', () => {
    const id = buildScheduleJobId('my-device', new Date(2026, 2, 30, 15, 4, 5), 'abc123xyz');
    expect(id).toBe('sched_20260330150405_my-device_abc123xyz');
  });

  it('buildEvalSessionId matches expected format', () => {
    const id = buildEvalSessionId('my-device', new Date(2026, 2, 30, 15, 4, 5), 'abc123xyz');
    expect(id).toBe('evalSession_20260330150405_my-device_abc123xyz');
  });

  describe('isValidChatSessionIdFormat', () => {
    it('returns true for a valid chat session id', () => {
      expect(isValidChatSessionIdFormat('chatSession_20260330150405_my-device_abc123xyz')).toBe(true);
    });

    it('returns false for a non-string', () => {
      expect(isValidChatSessionIdFormat(123 as any)).toBe(false);
    });

    it('returns false for a malformed id', () => {
      expect(isValidChatSessionIdFormat('bad_id')).toBe(false);
    });
  });

  describe('extractMonthFromChatSessionIdValue', () => {
    it('extracts YYYYMM from a valid id', () => {
      expect(extractMonthFromChatSessionIdValue('chatSession_20260330150405_my-device_abc123xyz')).toBe('202603');
    });

    it('returns null for a non-string', () => {
      expect(extractMonthFromChatSessionIdValue(null as any)).toBeNull();
    });

    it('returns null for invalid id', () => {
      expect(extractMonthFromChatSessionIdValue('invalid')).toBeNull();
    });
  });

  describe('isTimestampPrefixedChatSessionId', () => {
    it('returns true for a valid prefixed id', () => {
      expect(isTimestampPrefixedChatSessionId('chatSession_20260330150405_my-device_abc123xyz')).toBe(true);
    });

    it('returns false for a non-string', () => {
      expect(isTimestampPrefixedChatSessionId(null as any)).toBe(false);
    });

    it('returns false for a too-short string', () => {
      expect(isTimestampPrefixedChatSessionId('chatSession_short')).toBe(false);
    });
  });
});
