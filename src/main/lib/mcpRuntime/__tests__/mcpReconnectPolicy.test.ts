import { describe, it, expect } from 'vitest';
import {
  classifyProtocolError,
  computeReconnectDelayMs,
  shouldAutoReconnect,
  shouldSuppressAutoReconnectForError,
  RECONNECT_BACKOFF_SCHEDULE_MS,
  MAX_AUTO_RECONNECT_ATTEMPTS,
} from '../mcpReconnectPolicy';

describe('classifyProtocolError', () => {
  it('returns ambiguous for null / undefined', () => {
    expect(classifyProtocolError(null)).toBe('ambiguous');
    expect(classifyProtocolError(undefined)).toBe('ambiguous');
  });

  it('classifies the -32001 session code as connection-lost', () => {
    expect(classifyProtocolError({ code: -32001 })).toBe('connection-lost');
  });

  it('classifies session-loss messages as connection-lost regardless of code', () => {
    expect(classifyProtocolError({ message: 'Session not found' })).toBe('connection-lost');
    expect(classifyProtocolError({ message: 'the session expired, retry' })).toBe('connection-lost');
    expect(classifyProtocolError({ message: 'upstream session was closed' })).toBe('connection-lost');
  });

  it('is case-insensitive on the message patterns', () => {
    expect(classifyProtocolError({ message: 'SESSION NOT FOUND' })).toBe('connection-lost');
  });

  it('returns ambiguous for an unrelated error', () => {
    expect(classifyProtocolError({ code: -32000, message: 'boom' })).toBe('ambiguous');
    expect(classifyProtocolError({})).toBe('ambiguous');
    expect(classifyProtocolError({ message: 42 as unknown as string })).toBe('ambiguous');
  });
});

describe('computeReconnectDelayMs', () => {
  it('uses the scheduled base with no jitter when rng is 0', () => {
    expect(computeReconnectDelayMs(1, () => 0)).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[0]);
    expect(computeReconnectDelayMs(2, () => 0)).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[1]);
  });

  it('adds up to +20% jitter', () => {
    const base = RECONNECT_BACKOFF_SCHEDULE_MS[0];
    expect(computeReconnectDelayMs(1, () => 1)).toBe(base + Math.floor(base * 0.2));
    expect(computeReconnectDelayMs(1, () => 0.5)).toBe(base + Math.floor(base * 0.1));
  });

  it('clamps attempts below 1 to the first step', () => {
    expect(computeReconnectDelayMs(0, () => 0)).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[0]);
    expect(computeReconnectDelayMs(-5, () => 0)).toBe(RECONNECT_BACKOFF_SCHEDULE_MS[0]);
  });

  it('clamps attempts beyond the schedule to the cap', () => {
    const cap = RECONNECT_BACKOFF_SCHEDULE_MS[RECONNECT_BACKOFF_SCHEDULE_MS.length - 1];
    expect(computeReconnectDelayMs(RECONNECT_BACKOFF_SCHEDULE_MS.length + 3, () => 0)).toBe(cap);
  });

  it('defaults rng to Math.random (stays within base..base*1.2)', () => {
    const base = RECONNECT_BACKOFF_SCHEDULE_MS[0];
    const delay = computeReconnectDelayMs(1);
    expect(delay).toBeGreaterThanOrEqual(base);
    expect(delay).toBeLessThanOrEqual(base + base * 0.2);
  });
});

describe('shouldAutoReconnect', () => {
  const base = { isBuiltin: false, inUse: true, everConnected: true, needsUserInteraction: false };

  it('allows a previously-connected in-use external server', () => {
    expect(shouldAutoReconnect(base)).toBe(true);
  });

  it('suppresses the builtin server', () => {
    expect(shouldAutoReconnect({ ...base, isBuiltin: true })).toBe(false);
  });

  it('suppresses a server the user no longer uses', () => {
    expect(shouldAutoReconnect({ ...base, inUse: false })).toBe(false);
  });

  it('suppresses a server that never connected', () => {
    expect(shouldAutoReconnect({ ...base, everConnected: false })).toBe(false);
  });

  it('suppresses a server awaiting user interaction', () => {
    expect(shouldAutoReconnect({ ...base, needsUserInteraction: true })).toBe(false);
  });
});

describe('shouldSuppressAutoReconnectForError', () => {
  it('allows transient/unknown failures to retry', () => {
    expect(shouldSuppressAutoReconnectForError(null)).toBe(false);
    expect(shouldSuppressAutoReconnectForError(undefined)).toBe(false);
    expect(shouldSuppressAutoReconnectForError('Session not found')).toBe(false);
    expect(shouldSuppressAutoReconnectForError(new Error('socket hang up'))).toBe(false);
  });

  it('suppresses MCP auth failures that require user action', () => {
    expect(shouldSuppressAutoReconnectForError('[MCP_AUTH_CANCELLED] user closed sign-in')).toBe(true);
    expect(shouldSuppressAutoReconnectForError('[MCP_OAUTH_FLOW_FAILED] OAuth callback failed')).toBe(true);
    expect(shouldSuppressAutoReconnectForError('[MCP_DCR_REQUIRES_USER_CLIENT_ID] needs client_id')).toBe(true);
    expect(shouldSuppressAutoReconnectForError('[MCP_DCR_RESTRICTED] approved clients only')).toBe(true);
  });

  it('suppresses account-gated OAuth responses after successful sign-in', () => {
    expect(shouldSuppressAutoReconnectForError(
      '403 status from https://example/mcp after successful sign-in: not available for your account',
    )).toBe(true);
  });

  it('suppresses invalid transport configuration failures', () => {
    expect(shouldSuppressAutoReconnectForError(new Error(
      "Stdio transport requires 'command' field for server broken",
    ))).toBe(true);
    expect(shouldSuppressAutoReconnectForError('HTTP/SSE transport requires \'url\' field for server broken')).toBe(true);
    expect(shouldSuppressAutoReconnectForError('HTTP transport URL must start with http:// or https://')).toBe(true);
    expect(shouldSuppressAutoReconnectForError('Unsupported transport type: websocket')).toBe(true);
  });
});

describe('constants', () => {
  it('exposes a non-empty ascending backoff schedule and a positive cap', () => {
    expect(RECONNECT_BACKOFF_SCHEDULE_MS.length).toBeGreaterThan(0);
    for (let i = 1; i < RECONNECT_BACKOFF_SCHEDULE_MS.length; i++) {
      expect(RECONNECT_BACKOFF_SCHEDULE_MS[i]).toBeGreaterThan(RECONNECT_BACKOFF_SCHEDULE_MS[i - 1]);
    }
    expect(MAX_AUTO_RECONNECT_ATTEMPTS).toBeGreaterThan(0);
  });
});
