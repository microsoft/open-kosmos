/**
 * Smoke tests for IPC module exports.
 * Each module calls connectRenderToMain / connectMainToRender at module load time.
 * Importing them here ensures those statements are executed and counted as covered.
 */

import * as buddy from '../buddy';
import * as externalAgent from '../externalAgent';
import * as memex from '../memex';
import * as scheduler from '../scheduler';
import * as screenshot from '../screenshot';

describe('IPC module exports', () => {
  it('buddy exports renderToMain and mainToRender connectors', () => {
    expect(buddy.renderToMain).toBeDefined();
    expect(buddy.mainToRender).toBeDefined();
  });

  it('externalAgent exports renderToMain and mainToRender connectors', () => {
    expect(externalAgent.renderToMain).toBeDefined();
    expect(externalAgent.mainToRender).toBeDefined();
  });

  it('memex exports renderToMain connector', () => {
    expect(memex.renderToMain).toBeDefined();
  });

  it('scheduler exports renderToMain connector', () => {
    expect(scheduler.renderToMain).toBeDefined();
  });

  it('screenshot exports renderToMain connector', () => {
    expect(screenshot.renderToMain).toBeDefined();
  });

});

describe('IPC connector shape — bindRender proxy is callable', () => {
  it('buddy.renderToMain.bindRender produces callable methods', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = buddy.renderToMain.bindRender(invoke);
    api.getCompanion();
    expect(invoke).toHaveBeenCalledWith('buddy:getCompanion');
  });

  it('memex.renderToMain.bindRender produces callable methods', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = memex.renderToMain.bindRender(invoke);
    api.listCards({ scope: 'current-agent', chatId: 'chat-1' });
    expect(invoke).toHaveBeenCalledWith('memex:listCards', { scope: 'current-agent', chatId: 'chat-1' });
  });

  it('buddy.mainToRender.bindWebContents produces callable send methods', () => {
    const mockWc = { send: vi.fn() } as any;
    const sender = buddy.mainToRender.bindWebContents(mockWc);
    sender['companion-updated']({ id: 'c1' } as any);
    expect(mockWc.send).toHaveBeenCalledWith('buddy:companion-updated', { id: 'c1' });
  });

});
