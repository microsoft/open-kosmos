/** @vitest-environment happy-dom */
/**
 * Tests for the renderer-side coding-CLI IPC bridge.
 *
 * codingCli.ts binds the shared contract to window.electronAPI.codingCli.invoke (installed as a
 * spyable proxy by tests/setup.ts), producing a typed api whose methods invoke prefixed channels.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { codingCliApi } from '../codingCli';

describe('renderer ipc/codingCli bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes typed methods', () => {
    expect(typeof codingCliApi.getSettings).toBe('function');
    expect(typeof codingCliApi.updateSettings).toBe('function');
    expect(typeof codingCliApi.detectAvailability).toBe('function');
  });

  it('getSettings invokes the codingCli:getSettings channel', async () => {
    const invoke = (window as any).electronAPI.codingCli.invoke;
    await codingCliApi.getSettings();
    expect(invoke).toHaveBeenCalledWith('codingCli:getSettings');
  });

  it('updateSettings forwards the settings argument', async () => {
    const invoke = (window as any).electronAPI.codingCli.invoke;
    await codingCliApi.updateSettings({ cli: 'gemini' });
    expect(invoke).toHaveBeenCalledWith('codingCli:updateSettings', { cli: 'gemini' });
  });

  it('detectAvailability invokes the codingCli:detectAvailability channel', async () => {
    const invoke = (window as any).electronAPI.codingCli.invoke;
    await codingCliApi.detectAvailability();
    expect(invoke).toHaveBeenCalledWith('codingCli:detectAvailability');
  });
});
