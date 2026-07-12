import {
  buildAgentId,
  buildAgentUuid,
  buildChatId,
  buildChatSessionId,
  buildEvalSessionId,
  buildScheduleJobId,
  buildTimestampSegment,
  extractMonthFromChatSessionIdValue,
  generateRandomIdSegment,
  isTimestampPrefixedChatSessionId,
  isValidChatSessionIdFormat,
  normalizeDeviceIdSegment,
} from '../idFormats';

describe('idFormats', () => {
  const fixedDate = new Date(2026, 2, 30, 15, 4, 5);

  describe('buildTimestampSegment', () => {
    it('builds a compact YYYYMMDDHHMMSS timestamp', () => {
      expect(buildTimestampSegment(fixedDate)).toBe('20260330150405');
    });
  });

  describe('normalizeDeviceIdSegment', () => {
    it('normalizes mixed-case UUID-like ids to lowercase hyphen-safe segments', () => {
      expect(normalizeDeviceIdSegment('ABCD-1234-EF56')).toBe('abcd-1234-ef56');
    });

    it('collapses unsupported characters and trims separators', () => {
      expect(normalizeDeviceIdSegment('  device::ID / test  ')).toBe('device-id-test');
    });

    it('falls back when device id is empty', () => {
      expect(normalizeDeviceIdSegment('')).toBe('unknown-device');
    });
  });

  describe('buildChatId', () => {
    it('builds the new chat id format', () => {
      expect(buildChatId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'chat_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('buildChatSessionId', () => {
    it('builds the new chat session id format', () => {
      expect(buildChatSessionId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'chatSession_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('buildScheduleJobId', () => {
    it('builds the new schedule job id format', () => {
      expect(buildScheduleJobId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'sched_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('isValidChatSessionIdFormat', () => {
    it('accepts the new chat session id format', () => {
      expect(isValidChatSessionIdFormat('chatSession_20260330150405_device-01_abc123xyz')).toBe(true);
    });

    it('still accepts the legacy timestamp-only format', () => {
      expect(isValidChatSessionIdFormat('chatSession_20260330150405')).toBe(true);
    });

    it('rejects malformed chat session ids', () => {
      expect(isValidChatSessionIdFormat('chatSession_20260330')).toBe(false);
      expect(isValidChatSessionIdFormat('chatSession_20260330150405_device-only')).toBe(false);
      expect(isValidChatSessionIdFormat('session_20260330150405_device-01_abc123xyz')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(isValidChatSessionIdFormat(123 as any)).toBe(false);
      expect(isValidChatSessionIdFormat(null as any)).toBe(false);
      expect(isValidChatSessionIdFormat(undefined as any)).toBe(false);
    });
  });

  describe('extractMonthFromChatSessionIdValue', () => {
    it('extracts YYYYMM from the new format', () => {
      expect(extractMonthFromChatSessionIdValue('chatSession_20260330150405_device-01_abc123xyz')).toBe('202603');
    });

    it('extracts YYYYMM from the legacy format', () => {
      expect(extractMonthFromChatSessionIdValue('chatSession_20251201010203')).toBe('202512');
    });

    it('returns null for invalid values', () => {
      expect(extractMonthFromChatSessionIdValue('invalid')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(extractMonthFromChatSessionIdValue(123 as any)).toBeNull();
      expect(extractMonthFromChatSessionIdValue(null as any)).toBeNull();
    });
  });

  describe('generateRandomIdSegment', () => {
    it('generates a string of default length 9', () => {
      const seg = generateRandomIdSegment();
      expect(seg).toHaveLength(9);
      expect(/^[a-z0-9]+$/.test(seg)).toBe(true);
    });

    it('generates a string of custom length', () => {
      const seg = generateRandomIdSegment(5);
      expect(seg).toHaveLength(5);
    });
  });

  describe('buildEvalSessionId', () => {
    it('builds the eval session id format', () => {
      expect(buildEvalSessionId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'evalSession_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('normalizeDeviceIdSegment additional cases', () => {
    it('returns unknown-device for null', () => {
      expect(normalizeDeviceIdSegment(null)).toBe('unknown-device');
    });

    it('returns unknown-device for undefined', () => {
      expect(normalizeDeviceIdSegment(undefined)).toBe('unknown-device');
    });

    it('collapses multiple consecutive hyphens', () => {
      expect(normalizeDeviceIdSegment('a---b')).toBe('a-b');
    });
  });

  describe('buildAgentId', () => {
    it('builds id from name and source, lowercasing and hyphenating', () => {
      expect(buildAgentId('Kobi', 'ON-DEVICE')).toBe('agent-kobi-on-device');
      expect(buildAgentId('My Cool Agent', 'Cloud')).toBe('agent-my-cool-agent-cloud');
    });

    it('strips special chars, collapses repeats, and trims edge hyphens', () => {
      expect(buildAgentId('  Foo!! Bar  ', 'Source')).toBe('agent-foo-bar-source');
      expect(buildAgentId('a@@@b', 'x')).toBe('agent-a-b-x');
    });

    it('defaults source to on-device when undefined', () => {
      expect(buildAgentId('Solo', undefined)).toBe('agent-solo-on-device');
    });

    it('falls back to "agent" when name is empty or all special chars', () => {
      expect(buildAgentId('', 'x')).toBe('agent-agent-x');
      expect(buildAgentId('@@@', 'x')).toBe('agent-agent-x');
    });

    it('preserves Unicode (CJK) letters so non-ASCII names are not collapsed', () => {
      expect(buildAgentId('软件运营Agent', 'ON-DEVICE')).toBe('agent-软件运营agent-on-device');
      expect(buildAgentId('日本語', 'Cloud')).toBe('agent-日本語-cloud');
      expect(buildAgentId('中文', undefined)).toBe('agent-中文-on-device');
    });

    it('keeps distinct CJK names distinct (no id collision)', () => {
      const a = buildAgentId('软件运营Agent', 'ON-DEVICE');
      const b = buildAgentId('财务Agent', 'ON-DEVICE');
      expect(a).not.toBe(b);
      expect(a).toBe('agent-软件运营agent-on-device');
      expect(b).toBe('agent-财务agent-on-device');
    });

    it('mixes CJK with spaces, ascii, symbols, and emoji correctly', () => {
      expect(buildAgentId('  团队 Mgr!! ', 'Source')).toBe('agent-团队-mgr-source');
      expect(buildAgentId('emoji😀name', 'x')).toBe('agent-emoji-name-x');
    });
  });

  describe('buildAgentUuid', () => {
    it('builds a name-independent id: agent_{timestamp}_{random}', () => {
      const id = buildAgentUuid(fixedDate, 'abc123');
      expect(id).toBe('agent_20260330150405_abc123');
    });

    it('matches the shared timestamped id shape', () => {
      expect(buildAgentUuid()).toMatch(/^agent_\d{14}_[a-z0-9]+$/);
    });

    it('is unique across calls (different random segments)', () => {
      expect(buildAgentUuid()).not.toBe(buildAgentUuid());
    });

    it('does not encode the agent name (stable across renames)', () => {
      // Same injected timestamp/random -> identical id regardless of any name,
      // proving the id is independent of the agent name.
      expect(buildAgentUuid(fixedDate, 'seg')).toBe(buildAgentUuid(fixedDate, 'seg'));
    });
  });

  describe('isTimestampPrefixedChatSessionId', () => {
    it('returns true for both legacy and new timestamp-prefixed chat session ids', () => {
      expect(isTimestampPrefixedChatSessionId('chatSession_20260330150405')).toBe(true);
      expect(isTimestampPrefixedChatSessionId('chatSession_20260330150405_device-01_abc123xyz')).toBe(true);
    });

    it('returns false for non chat session values', () => {
      expect(isTimestampPrefixedChatSessionId('chat_20260330150405_device-01_abc123xyz')).toBe(false);
      expect(isTimestampPrefixedChatSessionId('chatSession_')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(isTimestampPrefixedChatSessionId(42 as any)).toBe(false);
      expect(isTimestampPrefixedChatSessionId(null as any)).toBe(false);
    });
  });
});