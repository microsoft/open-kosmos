import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { ComputerUseTool, type ComputerUseExecuteOptions } from '../computerUseTool';
import type { ComputerUseManager } from '../../../computerUse/ComputerUseManager';
import type { ComputerUseToolArgs } from '../../../computerUse/types';
import { computerUseConfirmationStore } from '../../../computerUse/confirmationGate';

beforeEach(() => {
  computerUseConfirmationStore.clear();
});

function fakeManager(over: Partial<Record<string, unknown>> = {}): ComputerUseManager {
  const manager = {
    listDisplays: vi.fn(() => [
      { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1, primary: true },
    ]),
    listWindows: vi.fn(async () => [{ appId: 'Safari', title: 'Safari', focused: true }]),
    screenshot: vi.fn(async () => ({
      data: 'IMGB64',
      mimeType: 'image/jpeg',
      width: 100,
      height: 100,
      displayId: 1,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
    })),
    focusWindow: vi.fn(async () => true),
    getForegroundApp: vi.fn(() => undefined),
    getForegroundAppCandidates: vi.fn(() => [] as string[]),
    refreshForegroundAppCandidates: vi.fn(async (chatSessionId?: string) => manager.getForegroundAppCandidates(chatSessionId)),
    moveMouse: vi.fn(async () => ({ x: 10, y: 20 })),
    scroll: vi.fn(async () => ({ x: 10, y: 20 })),
    click: vi.fn(async () => ({ x: 10, y: 20 })),
    doubleClick: vi.fn(async () => ({ x: 10, y: 20 })),
    drag: vi.fn(async () => ({ from: { x: 0, y: 0 }, to: { x: 5, y: 5 } })),
    typeText: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    hotkey: vi.fn(async () => undefined),
    accessibilityError: vi.fn(() => null),
  } as Partial<Record<string, unknown>> & { getForegroundAppCandidates: (chatSessionId?: string) => string[] };
  Object.assign(manager, over);
  return manager as unknown as ComputerUseManager;
}

function run(args: ComputerUseToolArgs, opts: ComputerUseExecuteOptions = {}) {
  const manager = opts.manager ?? fakeManager();
  return { manager, result: ComputerUseTool.execute(args, { manager, ...opts }) };
}

async function approveForRetry(args: ComputerUseToolArgs, opts: ComputerUseExecuteOptions = {}) {
  const manager = opts.manager ?? fakeManager();
  const toolOptions = { manager, ...opts };
  const blocked = await ComputerUseTool.execute(args, toolOptions);
  expect(blocked).toMatchObject({ ok: false, requiresConfirmation: true });
  const confirmationId = (blocked as { confirmationId?: string }).confirmationId;
  expect(confirmationId).toEqual(expect.any(String));
  expect(computerUseConfirmationStore.approve(confirmationId!, opts.chatSessionId)).toBe(true);
  return {
    manager,
    toolOptions,
    args: { ...args, confirmed: true, confirmationId } as ComputerUseToolArgs,
  };
}

/** Settings that let an ordinary mutating action through without confirmation. */
const noConfirm = { requireConfirmation: false };

describe('routing + read-only actions', () => {
  it('fails when action is missing', async () => {
    expect(await ComputerUseTool.execute({})).toEqual({ ok: false, error: 'Missing required "action".' });
  });

  it('fails on an unknown action', async () => {
    const out = await ComputerUseTool.execute({ action: 'bogus' as never }, { manager: fakeManager() });
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toContain('Unknown action');
  });

  it('lists displays and windows', async () => {
    expect(await run({ action: 'list_displays' }).result).toMatchObject({ ok: true });
    expect(await run({ action: 'list_windows' }).result).toMatchObject({ ok: true });
  });

  it('returns the vision image shape for screenshot', async () => {
    const out = await run({ action: 'screenshot', display: 1 }).result;
    expect(out).toMatchObject({ type: 'image', data: 'IMGB64', mimeType: 'image/jpeg', width: 100, height: 100 });
    // Single display, no frontmost app reported -> compact layout + "unknown".
    expect((out as { description: string }).description).toContain('display #1 (100x100px)');
    expect((out as { description: string }).description).toContain('Frontmost app: unknown');
    expect((out as { description: string }).description).toContain('Displays: #1');
  });

  it('screenshot description reports frontmost app + multi-display layout', async () => {
    const manager = fakeManager({
      screenshot: vi.fn(async () => ({
        data: 'IMGB64',
        mimeType: 'image/jpeg',
        width: 1280,
        height: 800,
        displayId: 2,
        bounds: { x: 0, y: 0, width: 2056, height: 1329 },
        scaleFactor: 2,
        foregroundApp: 'Freeform',
        displays: [
          { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: false },
          { id: 2, bounds: { x: 0, y: 0, width: 2056, height: 1329 }, scaleFactor: 2, primary: true },
        ],
      })),
    });
    const out = await ComputerUseTool.execute({ action: 'screenshot' }, { manager });
    const desc = (out as { description: string }).description;
    expect(desc).toContain('Frontmost app: Freeform');
    // Captured display tagged; primary/secondary roles; cross-display hint present.
    expect(desc).toContain('#2 2056x1329@(0,0) primary [captured]');
    expect(desc).toContain('#1 1920x1080@(-1920,0) secondary');
    expect(desc).toContain('it is on another display');
  });
});

describe('focus_window', () => {
  it('requires a target', async () => {
    expect(await run({ action: 'focus_window' }).result).toMatchObject({ ok: false });
  });
  it('focuses by appId', async () => {
    expect(await run({ action: 'focus_window', appId: 'Notes' }).result).toEqual({ ok: true, focused: 'Notes' });
  });
  it('reports a focus failure', async () => {
    const manager = fakeManager({ focusWindow: vi.fn(async () => false) });
    const out = await ComputerUseTool.execute({ action: 'focus_window', title: 'Mail' }, { manager });
    expect(out).toMatchObject({ ok: false });
  });
});

describe('move_mouse + scroll', () => {
  it('validates coordinates for move_mouse', async () => {
    expect(await run({ action: 'move_mouse' }).result).toMatchObject({ ok: false });
  });
  it('moves the mouse', async () => {
    expect(await run({ action: 'move_mouse', x: 5, y: 6 }).result).toEqual({ ok: true, screenPoint: { x: 10, y: 20 } });
  });
  it('validates coordinates for scroll', async () => {
    expect(await run({ action: 'scroll' }).result).toMatchObject({ ok: false });
  });
  it('scrolls with default deltas', async () => {
    const manager = fakeManager();
    await ComputerUseTool.execute({ action: 'scroll', x: 5, y: 6 }, { manager });
    expect(manager.scroll).toHaveBeenCalledWith(5, 6, 0, 0, expect.anything());
  });
});

describe('mutating validation', () => {
  it('rejects click without coordinates', async () => {
    expect(await run({ action: 'click' }).result).toMatchObject({ ok: false });
  });
  it('rejects drag without endpoints', async () => {
    expect(await run({ action: 'drag', from: { x: 1, y: 1 } }).result).toMatchObject({ ok: false });
  });
  it('rejects empty type_text', async () => {
    expect(await run({ action: 'type_text', text: '' }).result).toMatchObject({ ok: false });
  });
  it('rejects empty press_key', async () => {
    expect(await run({ action: 'press_key', key: '   ' }).result).toMatchObject({ ok: false });
  });
  it('rejects empty hotkey', async () => {
    expect(await run({ action: 'hotkey', keys: [] }).result).toMatchObject({ ok: false });
  });
  it('rejects a hotkey whose keys contain a non-string element', async () => {
    // Without element-type validation a non-string key reaches `key.trim()` in the high-impact
    // chord check and surfaces a leaked internal "trim is not a function" error instead of a
    // clean, recoverable validation message.
    const out = await run({ action: 'hotkey', keys: ['cmd', 123 as unknown as string] }).result;
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toContain('non-empty strings');
  });
  it('rejects a hotkey whose keys contain a blank string', async () => {
    const out = await run({ action: 'hotkey', keys: ['cmd', '  '] }).result;
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toContain('non-empty strings');
  });
});

describe('confirmation gate', () => {
  it('blocks an ordinary mutating action by default', async () => {
    const out = await run({ action: 'click', x: 1, y: 2 }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('returns the permission-required error BEFORE asking for confirmation', async () => {
    // Documented decision flow checks "permission ok?" before the confirmation gate. With
    // Accessibility missing, a click must surface the permission error immediately, not ask the
    // user to approve an action that would then fail on dispatch.
    const manager = fakeManager({
      accessibilityError: vi.fn(() => 'Accessibility permission is required ... to control other apps.'),
    });
    const out = await ComputerUseTool.execute({ action: 'click', x: 1, y: 2 }, { manager });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('Accessibility permission is required') });
    expect((out as { requiresConfirmation?: boolean }).requiresConfirmation).toBeUndefined();
    expect(manager.click).not.toHaveBeenCalled();
  });

  it('always blocks a high-impact intent even when allowlisted and confirmation disabled', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Safari']) });
    const out = await ComputerUseTool.execute(
      { action: 'click', x: 1, y: 2, intent: 'delete the record' },
      { manager, settings: { requireConfirmation: false, alwaysAllowedApps: ['Safari'] } },
    );
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
    expect((out as { error: string }).error).toContain('high-impact');
  });

  it('detects high-impact from typed text', async () => {
    const out = await run({ action: 'type_text', text: 'please submit now' }, { settings: noConfirm }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('detects high-impact from a multi-word verb in the intent', async () => {
    const out = await run({ action: 'click', x: 1, y: 2, intent: 'grant access to the folder' }, { settings: noConfirm }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('detects high-impact from a hotkey chord', async () => {
    const out = await run({ action: 'hotkey', keys: ['delete'] }, { settings: noConfirm }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('always confirms app/window-closing hotkeys even when confirmation is disabled', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Freeform']) });
    for (const keys of [
      ['cmd', 'q'],
      ['command', 'w'],
      ['cmd', 'm'],
      ['ctrl', 'q'],
      ['control', 'w'],
      ['alt', 'f4'],
      ['option', 'f4'],
      ['ctrl', 'f4'],
    ]) {
      const out = await ComputerUseTool.execute(
        { action: 'hotkey', keys },
        { manager, settings: { requireConfirmation: false, alwaysAllowedApps: ['Freeform'] } },
      );
      expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
      expect((out as { error: string }).error).toContain('keyboard shortcut');
    }
  });

  it('always confirms save and submit hotkeys even when confirmation is disabled', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Freeform']) });
    for (const keys of [
      ['cmd', 's'],
      ['control', 's'],
      ['cmd', 'enter'],
      ['ctrl', 'return'],
    ]) {
      const out = await ComputerUseTool.execute(
        { action: 'hotkey', keys },
        { manager, settings: { requireConfirmation: false, alwaysAllowedApps: ['Freeform'] } },
      );
      expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
      expect((out as { error: string }).error).toContain('keyboard shortcut');
    }
  });


  it('does not treat a benign alt chord (alt+tab window switch) as high-impact', async () => {
    // alt+f4 quits the app and must gate, but alt+tab only switches windows — gating it would
    // make routine navigation in an allowlisted app unusable, so it must stay ungated.
    expect(await run({ action: 'hotkey', keys: ['alt', 'tab'] }, { settings: noConfirm }).result).toEqual({
      ok: true,
      keys: ['alt', 'tab'],
    });
  });

  it('does not crash and requires confirmation when alwaysAllowedApps is not an array', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Safari']) });
    const out = await ComputerUseTool.execute(
      { action: 'click', x: 1, y: 2 },
      { manager, settings: { requireConfirmation: true, alwaysAllowedApps: 'Safari' as unknown as string[] } },
    );
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('rejects malformed click buttons before dispatch', async () => {
    const manager = fakeManager();
    const out = await ComputerUseTool.execute(
      { action: 'click', x: 1, y: 2, button: 'side' } as unknown as ComputerUseToolArgs,
      { manager, settings: noConfirm },
    );

    expect(out).toEqual({ ok: false, error: 'click button must be one of left, right, or middle.' });
    expect(manager.click).not.toHaveBeenCalled();
  });

  it('skips non-string allowlist entries without throwing and still matches a valid one', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Safari']) });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      {
        manager,
        settings: {
          requireConfirmation: true,
          alwaysAllowedApps: [42, null, 'Safari'] as unknown as string[],
        },
      },
    );
    // The numeric/null entries are ignored; 'Safari' matches the foreground so the
    // ordinary typed text is allowlisted and dispatches without confirmation.
    expect(out).toMatchObject({ ok: true });
  });

  it('always confirms coordinate pointer actions because their target control is uninspectable', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Safari']) });
    for (const args of [
      { action: 'click', x: 1, y: 2 },
      { action: 'double_click', x: 1, y: 2 },
      { action: 'right_click', x: 1, y: 2 },
      { action: 'drag', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
    ] as ComputerUseToolArgs[]) {
      const out = await ComputerUseTool.execute(args, {
        manager,
        settings: { requireConfirmation: false, alwaysAllowedApps: ['Safari'] },
      });
      expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
      expect((out as { error: string }).error).toContain('coordinate pointer actions');
    }
  });

  it('does not treat ordinary command hotkeys as high-impact by key shape alone', async () => {
    expect(await run({ action: 'hotkey', keys: ['cmd', 'space'] }, { settings: noConfirm }).result).toEqual({
      ok: true,
      keys: ['cmd', 'space'],
    });
  });

  it('allows an ordinary action for an allowlisted foreground app', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Safari']) });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['Safari'] } },
    );
    expect(out).toEqual({ ok: true, typed: 5 });
  });

  it('re-probes the foreground app before using the allowlist bypass', async () => {
    const manager = fakeManager({
      getForegroundAppCandidates: vi.fn(() => ['Safari']),
      refreshForegroundAppCandidates: vi.fn(async () => ['Notes']),
    });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, chatSessionId: 'session-1', settings: { alwaysAllowedApps: ['Safari'] } },
    );

    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
    expect(manager.refreshForegroundAppCandidates).toHaveBeenCalledWith('session-1');
    expect(manager.typeText).not.toHaveBeenCalled();
  });

  it('consumes an approved confirmation id even if the retry becomes allowlisted', async () => {
    const manager = fakeManager({
      refreshForegroundAppCandidates: vi.fn()
        .mockResolvedValueOnce(['Notes'])
        .mockResolvedValueOnce(['Safari'])
        .mockResolvedValueOnce(['Notes']),
    });
    const blocked = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, chatSessionId: 'session-1', settings: { alwaysAllowedApps: ['Safari'] } },
    );
    const confirmationId = (blocked as { confirmationId?: string }).confirmationId;
    expect(confirmationId).toEqual(expect.any(String));
    expect(computerUseConfirmationStore.approve(confirmationId!, 'session-1')).toBe(true);

    expect(await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello', confirmed: true, confirmationId },
      { manager, chatSessionId: 'session-1', settings: { alwaysAllowedApps: ['Safari'] } },
    )).toEqual({ ok: true, typed: 5 });

    const secondRetry = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello', confirmed: true, confirmationId },
      { manager, chatSessionId: 'session-1', settings: { alwaysAllowedApps: ['Safari'] } },
    );
    expect(secondRetry).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('matches the allowlist case-insensitively and ignores surrounding whitespace', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['  WeChat ']) });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['  wechat'] } },
    );
    expect(out).toEqual({ ok: true, typed: 5 });
  });

  it('matches the allowlist against the raw process name candidate', async () => {
    // The user allowlisted "msedge" (the process name shown in some tools) while the
    // friendly name "Microsoft Edge" is what Settings displays; either must match.
    const manager = fakeManager({
      getForegroundAppCandidates: vi.fn(() => ['Microsoft Edge', 'msedge']),
    });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['msedge'] } },
    );
    expect(out).toEqual({ ok: true, typed: 5 });
  });

  it('matches the allowlist against the friendly name candidate', async () => {
    const manager = fakeManager({
      getForegroundAppCandidates: vi.fn(() => ['Microsoft Edge', 'msedge']),
    });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['Microsoft Edge'] } },
    );
    expect(out).toEqual({ ok: true, typed: 5 });
  });

  it('strips a trailing .exe when matching the allowlist', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['msedge']) });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['msedge.exe'] } },
    );
    expect(out).toEqual({ ok: true, typed: 5 });
  });

  it('ignores blank allowlist entries', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Notes']) });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['   '] } },
    );
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('still confirms when the foreground app is not on the allowlist', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Notes']) });
    const out = await ComputerUseTool.execute(
      { action: 'type_text', text: 'hello' },
      { manager, settings: { alwaysAllowedApps: ['WeChat'] } },
    );
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('confirms when a foreground app is set but no allowlist is configured', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['WeChat']) });
    const out = await ComputerUseTool.execute({ action: 'type_text', text: 'hello' }, { manager, settings: {} });
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('allows an ordinary action when confirmation is globally disabled', async () => {
    expect(await run({ action: 'type_text', text: 'hello' }, { settings: noConfirm }).result).toEqual({
      ok: true,
      typed: 5,
    });
  });

  it('rejects model-supplied confirmed:true without a completed interactive approval', async () => {
    const out = await run({ action: 'click', x: 1, y: 2, confirmed: true }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('proceeds only after the matching confirmation id is approved', async () => {
    const approved = await approveForRetry({ action: 'click', x: 1, y: 2 });
    expect(await ComputerUseTool.execute(approved.args, approved.toolOptions)).toEqual({
      ok: true,
      screenPoint: { x: 10, y: 20 },
    });
  });

  it('does not gate a navigation press_key', async () => {
    expect(await run({ action: 'press_key', key: 'tab' }).result).toEqual({ ok: true, key: 'tab' });
  });

  it('gates an alphanumeric press_key because it can type text', async () => {
    const out = await run({ action: 'press_key', key: 'a' }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('gates an activation press_key', async () => {
    const out = await run({ action: 'press_key', key: 'enter' }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('gates a numpad-enter activation press_key', async () => {
    const out = await run({ action: 'press_key', key: 'numenter' }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('dispatches a numpad-enter press_key once confirmed', async () => {
    const approved = await approveForRetry({ action: 'press_key', key: 'numenter' });
    const out = await ComputerUseTool.execute(approved.args, approved.toolOptions);
    expect(out).toEqual({ ok: true, key: 'numenter' });
  });

  it('gates a destructive press_key (delete) in a non-allowlisted app', async () => {
    const out = await run({ action: 'press_key', key: 'delete' }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it('gates a destructive press_key (backspace) in a non-allowlisted app', async () => {
    const out = await run({ action: 'press_key', key: 'Backspace' }).result;
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });

  it.each(['delete', 'Backspace', 'enter', 'space'])(
    'always confirms a standalone %s press_key in an allowlisted app',
    async (key) => {
      const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Notes']) });
      const out = await ComputerUseTool.execute(
        { action: 'press_key', key },
        { manager, settings: { requireConfirmation: false, alwaysAllowedApps: ['Notes'] } },
      );
      expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
    },
  );

  it.each(['delete', 'Backspace', 'enter', 'space'])(
    'always confirms a single-key %s hotkey in an allowlisted app',
    async (key) => {
      const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Notes']) });
      const out = await ComputerUseTool.execute(
        { action: 'hotkey', keys: [key] },
        { manager, settings: { requireConfirmation: false, alwaysAllowedApps: ['Notes'] } },
      );
      expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
    },
  );

  it('always confirms a destructive press_key carrying a destructive intent, even when allowlisted', async () => {
    const manager = fakeManager({ getForegroundAppCandidates: vi.fn(() => ['Notes']) });
    const out = await ComputerUseTool.execute(
      { action: 'press_key', key: 'delete', intent: 'delete the record' },
      { manager, settings: { requireConfirmation: false, alwaysAllowedApps: ['Notes'] } },
    );
    expect(out).toMatchObject({ ok: false, requiresConfirmation: true });
  });
});

describe('mutating dispatch (confirmed)', () => {
  const opts = { settings: noConfirm } as ComputerUseExecuteOptions;
  it('click', async () => {
    const approved = await approveForRetry({ action: 'click', x: 1, y: 2 }, opts);
    expect(await ComputerUseTool.execute(approved.args, approved.toolOptions)).toEqual({ ok: true, screenPoint: { x: 10, y: 20 } });
  });
  it('double_click', async () => {
    const approved = await approveForRetry({ action: 'double_click', x: 1, y: 2 }, opts);
    expect(await ComputerUseTool.execute(approved.args, approved.toolOptions)).toEqual({ ok: true, screenPoint: { x: 10, y: 20 } });
  });
  it('right_click', async () => {
    const approved = await approveForRetry({ action: 'right_click', x: 1, y: 2 }, opts);
    expect(await ComputerUseTool.execute(approved.args, approved.toolOptions)).toEqual({ ok: true, screenPoint: { x: 10, y: 20 } });
  });
  it('drag', async () => {
    const approved = await approveForRetry({ action: 'drag', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }, opts);
    expect(await ComputerUseTool.execute(approved.args, approved.toolOptions)).toEqual({
      ok: true,
      from: { x: 0, y: 0 },
      to: { x: 5, y: 5 },
    });
  });
  it('type_text', async () => {
    expect(await run({ action: 'type_text', text: 'hello' }, opts).result).toEqual({ ok: true, typed: 5 });
  });
  it('hotkey', async () => {
    expect(await run({ action: 'hotkey', keys: ['cmd', 'c'] }, opts).result).toEqual({ ok: true, keys: ['cmd', 'c'] });
  });
});

describe('cancellation', () => {
  const aborted = () => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  };

  it('blocks a mutating click when the turn was aborted before dispatch', async () => {
    const manager = fakeManager();
    const out = await ComputerUseTool.execute(
      { action: 'click', x: 1, y: 2 },
      { manager, settings: noConfirm, signal: aborted() },
    );
    expect(out).toEqual({ ok: false, error: 'aborted' });
    expect(manager.click).not.toHaveBeenCalled();
  });

  it('blocks type_text and drag when aborted', async () => {
    const m1 = fakeManager();
    expect(
      await ComputerUseTool.execute(
        { action: 'type_text', text: 'hi' },
        { manager: m1, settings: noConfirm, signal: aborted() },
      ),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(m1.typeText).not.toHaveBeenCalled();

    const m2 = fakeManager();
    expect(
      await ComputerUseTool.execute(
        { action: 'drag', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
        { manager: m2, settings: noConfirm, signal: aborted() },
      ),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(m2.drag).not.toHaveBeenCalled();
  });

  it('blocks move_mouse when aborted', async () => {
    const manager = fakeManager();
    expect(
      await ComputerUseTool.execute({ action: 'move_mouse', x: 5, y: 6 }, { manager, signal: aborted() }),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(manager.moveMouse).not.toHaveBeenCalled();
  });

  it('blocks scroll when aborted', async () => {
    const manager = fakeManager();
    expect(
      await ComputerUseTool.execute({ action: 'scroll', x: 5, y: 6 }, { manager, signal: aborted() }),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(manager.scroll).not.toHaveBeenCalled();
  });

  it('blocks read-only and focus actions when aborted (no capture / no refocus)', async () => {
    const displaysMgr = fakeManager();
    expect(
      await ComputerUseTool.execute({ action: 'list_displays' }, { manager: displaysMgr, signal: aborted() }),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(displaysMgr.listDisplays).not.toHaveBeenCalled();

    const windowsMgr = fakeManager();
    expect(
      await ComputerUseTool.execute({ action: 'list_windows' }, { manager: windowsMgr, signal: aborted() }),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(windowsMgr.listWindows).not.toHaveBeenCalled();

    const shotMgr = fakeManager();
    expect(
      await ComputerUseTool.execute({ action: 'screenshot', display: 1 }, { manager: shotMgr, signal: aborted() }),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(shotMgr.screenshot).not.toHaveBeenCalled();

    const focusMgr = fakeManager();
    expect(
      await ComputerUseTool.execute(
        { action: 'focus_window', appId: 'Notes' },
        { manager: focusMgr, signal: aborted() },
      ),
    ).toEqual({ ok: false, error: 'aborted' });
    expect(focusMgr.focusWindow).not.toHaveBeenCalled();
  });

  it('still dispatches when a live (non-aborted) signal is present', async () => {
    const controller = new AbortController();
    const manager = fakeManager();
    const approved = await approveForRetry({ action: 'click', x: 1, y: 2 }, { manager, settings: noConfirm, signal: controller.signal });
    const out = await ComputerUseTool.execute(approved.args, approved.toolOptions);
    expect(out).toEqual({ ok: true, screenPoint: { x: 10, y: 20 } });
    expect(manager.click).toHaveBeenCalledTimes(1);
  });
});

describe('wait + abort + never-throw', () => {
  it('clamps the wait duration', async () => {
    vi.useFakeTimers();
    try {
      const manager = fakeManager();
      const low = ComputerUseTool.execute({ action: 'wait', ms: -5 }, { manager });
      await vi.runAllTimersAsync();
      expect(await low).toEqual({ ok: true, waited: 0 });

      const high = ComputerUseTool.execute({ action: 'wait', ms: 999999 }, { manager });
      await vi.runAllTimersAsync();
      expect(await high).toEqual({ ok: true, waited: 10000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns immediately for a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await run({ action: 'wait', ms: 5000 }, { signal: controller.signal }).result).toMatchObject({ ok: true });
  });

  it('resolves when aborted mid-wait', async () => {
    const controller = new AbortController();
    const promise = ComputerUseTool.execute({ action: 'wait', ms: 5000 }, { manager: fakeManager(), signal: controller.signal });
    controller.abort();
    expect(await promise).toMatchObject({ ok: true });
  });

  it('never throws — manager failures become error envelopes', async () => {
    const manager = fakeManager({
      screenshot: vi.fn(async () => {
        throw new Error('capture exploded');
      }),
    });
    const out = await ComputerUseTool.execute({ action: 'screenshot' }, { manager });
    expect(out).toEqual({ ok: false, error: 'capture exploded' });
  });
});
