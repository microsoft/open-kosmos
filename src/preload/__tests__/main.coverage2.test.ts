/**
 * Coverage2 tests for src/preload/main.ts
 * Targets the remaining uncovered API sections:
 *   - skillLibrary, builtinTools, skills
 *   - subAgent, subAgentLibrary
 *   - chatSessionOps
 *   - models.onModelsUpdated
 *   - additional agentChat event subscriptions
 *   - workspace event subscriptions
 *   - window event subscriptions
 *   - nativeModule event subscriptions (additional)
 *   - tts event subscriptions (additional)
 */

// ---------------------------------------------------------------------------
// Hoist mock variable declarations
// ---------------------------------------------------------------------------
const mocks2 = vi.hoisted(() => {
  (process as any).contextIsolated = true;
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  const mockOn = vi.fn().mockReturnValue(undefined);
  const mockOff = vi.fn().mockReturnValue(undefined);
  const mockSend = vi.fn().mockReturnValue(undefined);
  const mockRemoveListener = vi.fn().mockReturnValue(undefined);
  const mockRemoveAllListeners = vi.fn().mockReturnValue(undefined);
  const mockExposeInMainWorld = vi.fn().mockReturnValue(undefined);
  const mockGetPathForFile = vi.fn().mockReturnValue('/some/path');

  const mockInvokeScreenshot = vi.fn();
  const mockInvokeScheduler = vi.fn();
  const mockInvokeBrowserControl = vi.fn();
  const mockInvokeRemoteChannel = vi.fn();
  const mockInvokeExternalAgent = vi.fn();
  const mockInvokeBuddy = vi.fn();
  const mockInvokePlugin = vi.fn();
  const mockInvokeDoctor = vi.fn();

  return {
    mockInvoke, mockOn, mockOff, mockSend, mockRemoveListener, mockRemoveAllListeners,
    mockExposeInMainWorld, mockGetPathForFile,
    mockInvokeScreenshot, mockInvokeScheduler, mockInvokeBrowserControl,
    mockInvokeRemoteChannel, mockInvokeExternalAgent,
    mockInvokeBuddy, mockInvokePlugin, mockInvokeDoctor,
  };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks2.mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mocks2.mockInvoke,
    on: mocks2.mockOn,
    off: mocks2.mockOff,
    send: mocks2.mockSend,
    removeListener: mocks2.mockRemoveListener,
    removeAllListeners: mocks2.mockRemoveAllListeners,
  },
  webUtils: { getPathForFile: mocks2.mockGetPathForFile },
}));

vi.mock('../screenshot/invoke', () => ({ default: mocks2.mockInvokeScreenshot }));
vi.mock('../scheduler/invoke', () => ({ default: mocks2.mockInvokeScheduler }));
vi.mock('../browserControl/invoke', () => ({ default: mocks2.mockInvokeBrowserControl }));
vi.mock('../remoteChannel/invoke', () => ({ default: mocks2.mockInvokeRemoteChannel }));
vi.mock('../externalAgent/invoke', () => ({ default: mocks2.mockInvokeExternalAgent }));
vi.mock('../buddy/invoke', () => ({ default: mocks2.mockInvokeBuddy }));
vi.mock('../plugin/invoke', () => ({ default: mocks2.mockInvokePlugin }));
vi.mock('../doctor/invoke', () => ({ default: mocks2.mockInvokeDoctor }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let api: any;

const getAPI = async () => {
  const mod = await import('../main');
  return (mod as any).electronAPI;
};

const simulateEvent = (channel: string, payload: any) => {
  const calls = mocks2.mockOn.mock.calls.filter((c: any[]) => c[0] === channel);
  calls.forEach((c: any[]) => {
    if (typeof c[1] === 'function') c[1]({}, payload);
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  api = await getAPI();
  mocks2.mockInvoke.mockClear();
  mocks2.mockOn.mockClear();
  mocks2.mockRemoveListener.mockClear();
  mocks2.mockSend.mockClear();
});

// ─── skillLibrary ─────────────────────────────────────────────────────────────
describe('electronAPI.skillLibrary', () => {
  it('getLibraryData', () => {
    api.skillLibrary.getLibraryData();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:getLibraryData');
  });

  it('validateSkill', () => {
    api.skillLibrary.validateSkill('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:validateSkill', 'mySkill');
  });

  it('addSkill without options', () => {
    api.skillLibrary.addSkill('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:addSkill', 'mySkill', undefined);
  });

  it('addSkill with options', () => {
    api.skillLibrary.addSkill('mySkill', { overwrite: true, chatId: 'c1' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:addSkill', 'mySkill', { overwrite: true, chatId: 'c1' });
  });

  it('updateSkill', () => {
    api.skillLibrary.updateSkill('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:updateSkill', 'mySkill');
  });

  it('addSkillFromDevice', () => {
    api.skillLibrary.addSkillFromDevice('/path/to/file', { chatId: 'c1' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:addSkillFromDevice', '/path/to/file', { chatId: 'c1' });
  });

  it('installSkillFromFilePath', () => {
    api.skillLibrary.installSkillFromFilePath('/path/to/skill.zip', {});
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:installSkillFromFilePath', '/path/to/skill.zip', {});
  });

  it('updateSkillFromDevice', () => {
    api.skillLibrary.updateSkillFromDevice('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:updateSkillFromDevice', 'mySkill');
  });

  it('applySkillToAgents', () => {
    api.skillLibrary.applySkillToAgents('mySkill', [{ chatId: 'c1', agentName: 'agent1' }]);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:applySkillToAgents', 'mySkill', [{ chatId: 'c1', agentName: 'agent1' }]);
  });

  it('showOverwriteConfirmDialog', () => {
    api.skillLibrary.showOverwriteConfirmDialog('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skillLibrary:showOverwriteConfirmDialog', 'mySkill');
  });
});

// ─── builtinTools ─────────────────────────────────────────────────────────────
describe('electronAPI.builtinTools', () => {
  it('execute', () => {
    api.builtinTools.execute('toolName', { arg: 1 });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('builtinTools:execute', 'toolName', { arg: 1 });
  });

  it('getAllTools', () => {
    api.builtinTools.getAllTools();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('builtinTools:getAllTools');
  });

  it('isBuiltinTool', () => {
    api.builtinTools.isBuiltinTool('toolName');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('builtinTools:isBuiltinTool', 'toolName');
  });
});

// ─── skills ───────────────────────────────────────────────────────────────────
describe('electronAPI.skills', () => {
  it('getSkillMarkdown', () => {
    api.skills.getSkillMarkdown('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skills:getSkillMarkdown', 'mySkill');
  });

  it('getSkillDirectoryContents without relativePath', () => {
    api.skills.getSkillDirectoryContents('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skills:getSkillDirectoryContents', 'mySkill', '');
  });

  it('getSkillDirectoryContents with relativePath', () => {
    api.skills.getSkillDirectoryContents('mySkill', 'subfolder');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skills:getSkillDirectoryContents', 'mySkill', 'subfolder');
  });

  it('getSkillFileContent', () => {
    api.skills.getSkillFileContent('mySkill', 'file.ts');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skills:getSkillFileContent', 'mySkill', 'file.ts');
  });

  it('deleteSkill', () => {
    api.skills.deleteSkill('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skills:deleteSkill', 'mySkill');
  });

  it('openSkillFolder', () => {
    api.skills.openSkillFolder('mySkill');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('skills:openSkillFolder', 'mySkill');
  });
});

// ─── subAgent ─────────────────────────────────────────────────────────────────
describe('electronAPI.subAgent', () => {
  it('getAll', () => {
    api.subAgent.getAll();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:getAll');
  });

  it('add', () => {
    api.subAgent.add({ name: 'bot' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:add', { name: 'bot' });
  });

  it('update', () => {
    api.subAgent.update('bot', { description: 'updated' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:update', 'bot', { description: 'updated' });
  });

  it('delete', () => {
    api.subAgent.delete('bot');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:delete', 'bot');
  });

  it('importFromFile', () => {
    api.subAgent.importFromFile('/path/to/bot.json');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:importFromFile', '/path/to/bot.json');
  });

  it('exportAsClaudeCode', () => {
    api.subAgent.exportAsClaudeCode('bot');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:exportAsClaudeCode', 'bot');
  });

  it('openInExplorer', () => {
    api.subAgent.openInExplorer('bot');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:openInExplorer', 'bot');
  });

  it('syncFromDisk', () => {
    api.subAgent.syncFromDisk();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('subAgent:syncFromDisk');
  });

  it('onStateUpdate subscribes and unsubscribes', () => {
    const cb = vi.fn();
    const unsub = api.subAgent.onStateUpdate(cb);
    expect(mocks2.mockOn).toHaveBeenCalledWith('subAgent:stateUpdate', expect.any(Function));

    simulateEvent('subAgent:stateUpdate', { agents: [] });
    expect(cb).toHaveBeenCalledWith({ agents: [] });

    unsub();
    expect(mocks2.mockRemoveListener).toHaveBeenCalledWith('subAgent:stateUpdate', expect.any(Function));
  });
});

// ─── chatSessionOps ───────────────────────────────────────────────────────────
describe('electronAPI.chatSessionOps', () => {
  it('readChatSession', () => {
    api.chatSessionOps.readChatSession('sess-1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSessionOps:readChatSession', 'sess-1');
  });

  it('writeChatSession', () => {
    api.chatSessionOps.writeChatSession({ id: 'sess-1' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSessionOps:writeChatSession', { id: 'sess-1' });
  });

  it('deleteChatSession', () => {
    api.chatSessionOps.deleteChatSession('sess-1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSessionOps:deleteChatSession', 'sess-1');
  });

  it('listChatSessions', () => {
    api.chatSessionOps.listChatSessions();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSessionOps:listChatSessions');
  });

  it('getChatSessionMetadata', () => {
    api.chatSessionOps.getChatSessionMetadata('sess-1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSessionOps:getChatSessionMetadata', 'sess-1');
  });

  it('downloadChatSession', () => {
    api.chatSessionOps.downloadChatSession('alias', 'chatId', 'sess-1', 'My Title');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSession:downloadChatSession', 'alias', 'chatId', 'sess-1', 'My Title');
  });

  it('getChatSessionFilePath', () => {
    api.chatSessionOps.getChatSessionFilePath('alias', 'chatId', 'sess-1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chatSession:getFilePath', 'alias', 'chatId', 'sess-1');
  });
});

// ─── models.onModelsUpdated ───────────────────────────────────────────────────
describe('electronAPI.models – additional', () => {
  it('onModelsUpdated subscribes and unsubscribes', () => {
    const cb = vi.fn();
    const unsub = api.models.onModelsUpdated(cb);
    expect(mocks2.mockOn).toHaveBeenCalledWith('models:updated', expect.any(Function));

    simulateEvent('models:updated', { count: 5, timestamp: 123 });
    expect(cb).toHaveBeenCalledWith({ count: 5, timestamp: 123 });

    unsub();
    expect(mocks2.mockRemoveListener).toHaveBeenCalledWith('models:updated', expect.any(Function));
  });
});

// ─── agentChat – additional subscriptions ────────────────────────────────────
describe('electronAPI.agentChat – additional subscriptions', () => {
  it('onToolUse subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onToolUse(cb);
    simulateEvent('agentChat:toolUse', 'web_search');
    expect(cb).toHaveBeenCalledWith('web_search');
    unsub();
  });

  it('onToolResult subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onToolResult(cb);
    simulateEvent('agentChat:toolResult', { result: 'ok' });
    expect(cb).toHaveBeenCalledWith({ result: 'ok' });
    unsub();
  });

  it('onToolMessageAdded subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onToolMessageAdded(cb);
    simulateEvent('agentChat:toolMessageAdded', { msgId: '1' });
    expect(cb).toHaveBeenCalledWith({ msgId: '1' });
    unsub();
  });

  it('onContextChange subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onContextChange(cb);
    simulateEvent('agentChat:contextChange', { tokens: 100 });
    expect(cb).toHaveBeenCalledWith({ tokens: 100 });
    unsub();
  });

  it('onInteractionRequest subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onInteractionRequest(cb);
    simulateEvent('agentChat:interactionRequest', { requestId: 'r1' });
    expect(cb).toHaveBeenCalledWith({ requestId: 'r1' });
    unsub();
  });

  it('onInteractionProcessed subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onInteractionProcessed(cb);
    simulateEvent('agentChat:interactionProcessed', { requestId: 'r1' });
    expect(cb).toHaveBeenCalledWith({ requestId: 'r1' });
    unsub();
  });

  it('onStreamingChunk subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onStreamingChunk(cb);
    simulateEvent('agentChat:streamingChunk', { text: 'hello' });
    expect(cb).toHaveBeenCalledWith({ text: 'hello' });
    unsub();
  });

  it('onCurrentChatSessionIdChanged subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onCurrentChatSessionIdChanged(cb);
    simulateEvent('agentChat:currentChatSessionIdChanged', { chatId: 'c1', chatSessionId: 's1' });
    expect(cb).toHaveBeenCalledWith({ chatId: 'c1', chatSessionId: 's1' });
    unsub();
  });

  it('onChatSessionCacheCreated subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onChatSessionCacheCreated(cb);
    simulateEvent('agentChat:chatSessionCacheCreated', { chatSessionId: 's1', chatId: 'c1' });
    expect(cb).toHaveBeenCalledWith({ chatSessionId: 's1', chatId: 'c1' });
    unsub();
  });

  it('onChatSessionCacheDestroyed subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.agentChat.onChatSessionCacheDestroyed(cb);
    simulateEvent('agentChat:chatSessionCacheDestroyed', { chatSessionId: 's1' });
    expect(cb).toHaveBeenCalledWith({ chatSessionId: 's1' });
    unsub();
  });

  it('sendInteractionResponse', () => {
    api.agentChat.sendInteractionResponse({ requestId: 'r1', value: 'yes' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:sendInteractionResponse', { requestId: 'r1', value: 'yes' });
  });

  it('removeAgentChatInstance', () => {
    api.agentChat.removeAgentChatInstance('sess-1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:removeAgentChatInstance', 'sess-1');
  });

  it('importChatSession', () => {
    api.agentChat.importChatSession('chatId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:importChatSession', 'chatId');
  });

  it('replaceFilePathInSession', () => {
    api.agentChat.replaceFilePathInSession('/old', '/new');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:replaceFilePathInSession', '/old', '/new');
  });

  it('switchToChatSession', () => {
    api.agentChat.switchToChatSession('chatId', 'sessId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:switchToChatSession', 'chatId', 'sessId');
  });

  it('cancelChatSession', () => {
    api.agentChat.cancelChatSession('sessId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:cancelChatSession', 'sessId');
  });

  it('cancelActiveToolExecution', () => {
    api.agentChat.cancelActiveToolExecution('sessId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:cancelActiveToolExecution', 'sessId');
  });

  it('getChatStatusInfo', () => {
    api.agentChat.getChatStatusInfo();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:getChatStatusInfo');
  });

  it('getCurrentContextTokenUsage', () => {
    api.agentChat.getCurrentContextTokenUsage();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:getCurrentContextTokenUsage');
  });

  it('getCurrentChatSession', () => {
    api.agentChat.getCurrentChatSession();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:getCurrentChatSession');
  });

  it('canEditUserMessage', () => {
    api.agentChat.canEditUserMessage('sessId', 'msgId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:canEditUserMessage', 'sessId', 'msgId');
  });

  it('editUserMessage', () => {
    api.agentChat.editUserMessage('sessId', 'msgId', { role: 'user', content: 'new' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:editUserMessage', 'sessId', 'msgId', { role: 'user', content: 'new' });
  });

  it('retryChat', () => {
    api.agentChat.retryChat('sessId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('agentChat:retryChat', 'sessId');
  });
});

// ─── window – additional subscriptions ───────────────────────────────────────
describe('electronAPI.window – additional', () => {
  it('onWindowStateChanged subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.window.onWindowStateChanged(cb);
    expect(mocks2.mockOn).toHaveBeenCalledWith('window:stateChanged', expect.any(Function));
    simulateEvent('window:stateChanged', 'maximized');
    expect(cb).toHaveBeenCalledWith('maximized');
    unsub();
  });

  it('onZoomChanged subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.window.onZoomChanged(cb);
    expect(mocks2.mockOn).toHaveBeenCalledWith('window:zoomChanged', expect.any(Function));
    simulateEvent('window:zoomChanged', 1.5);
    expect(cb).toHaveBeenCalledWith(1.5);
    unsub();
  });

  it('onFullScreenChanged subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.window.onFullScreenChanged(cb);
    expect(mocks2.mockOn).toHaveBeenCalledWith('window:fullScreenChanged', expect.any(Function));
    simulateEvent('window:fullScreenChanged', true);
    expect(cb).toHaveBeenCalledWith(true);
    unsub();
  });

  it('showAppMenu', () => {
    api.window.showAppMenu(100, 200);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:showAppMenu', 100, 200);
  });

  it('setAlwaysOnTop', () => {
    api.window.setAlwaysOnTop(true);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:setAlwaysOnTop', true);
  });

  it('isAlwaysOnTop', () => {
    api.window.isAlwaysOnTop();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:isAlwaysOnTop');
  });

  it('setMinSize', () => {
    api.window.setMinSize(800, 600);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:setMinSize', 800, 600);
  });

  it('setMaxSize', () => {
    api.window.setMaxSize(1920, 1080);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:setMaxSize', 1920, 1080);
  });

  it('getMinSize', () => {
    api.window.getMinSize();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:getMinSize');
  });

  it('getMaxSize', () => {
    api.window.getMaxSize();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:getMaxSize');
  });

  it('zoomIn', () => {
    api.window.zoomIn();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:zoomIn');
  });

  it('zoomOut', () => {
    api.window.zoomOut();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:zoomOut');
  });

  it('resetZoom', () => {
    api.window.resetZoom();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:resetZoom');
  });

  it('getZoomLevel', () => {
    api.window.getZoomLevel();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:getZoomLevel');
  });

  it('isFullScreen', () => {
    api.window.isFullScreen();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:isFullScreen');
  });

  it('setSize', () => {
    api.window.setSize(1280, 720);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:setSize', 1280, 720);
  });

  it('getSize', () => {
    api.window.getSize();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('window:getSize');
  });
});

// ─── workspace – event subscriptions ─────────────────────────────────────────
describe('electronAPI.workspace – event subscriptions', () => {
  it('onFileChanged subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.workspace.onFileChanged(cb);
    simulateEvent('workspace:fileChanged', [{ path: '/a/b.ts', type: 'modified' }]);
    expect(cb).toHaveBeenCalledWith([{ path: '/a/b.ts', type: 'modified' }]);
    unsub();
  });

  it('onWatchError subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.workspace.onWatchError(cb);
    simulateEvent('workspace:watchError', { message: 'watch failed' });
    expect(cb).toHaveBeenCalledWith({ message: 'watch failed' });
    unsub();
  });

  it('searchFiles', () => {
    api.workspace.searchFiles({ pattern: '*.ts', maxResults: 10 });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:searchFiles', { pattern: '*.ts', maxResults: 10 });
  });

  it('copyPaths', () => {
    api.workspace.copyPaths(['/a', '/b'], '/dest', { conflictResolution: 'replace' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:copyPaths', ['/a', '/b'], '/dest', { conflictResolution: 'replace' });
  });

  it('movePath', () => {
    api.workspace.movePath('/a', '/b', { force: true });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:movePath', '/a', '/b', { force: true });
  });

  it('getDirectoryChildren', () => {
    api.workspace.getDirectoryChildren('/dir', { ignorePatterns: ['*.log'] });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:getDirectoryChildren', '/dir', { ignorePatterns: ['*.log'] });
  });

  it('getDefaultWorkspacePath', () => {
    api.workspace.getDefaultWorkspacePath('alias', 'chatId');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:getDefaultWorkspacePath', 'alias', 'chatId');
  });

  it('clearFileTreeCache', () => {
    api.workspace.clearFileTreeCache('/workspace');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:clearFileTreeCache', '/workspace');
  });

  it('getWatcherStats', () => {
    api.workspace.getWatcherStats();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('workspace:getWatcherStats');
  });
});



// ─── update – additional paths ────────────────────────────────────────────────
describe('electronAPI.update – additional', () => {
  it('onUpdateEvent subscribes and unsubscribes', () => {
    const cb = vi.fn();
    const unsub = api.update.onUpdateEvent('available', cb);
    simulateEvent('update:available', { version: '2.0.0' });
    expect(cb).toHaveBeenCalledWith({ version: '2.0.0' });
    unsub();
    expect(mocks2.mockRemoveListener).toHaveBeenCalledWith('update:available', expect.any(Function));
  });

  it('quitAndInstall with filePath', async () => {
    api.update.quitAndInstall('/path/to/update.dmg');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('update:quitAndInstall', '/path/to/update.dmg');
  });

  it('skipVersion', () => {
    api.update.skipVersion('1.9.0');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('update:skipVersion', '1.9.0');
  });

  it('getPreferences', () => {
    api.update.getPreferences();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('update:getPreferences');
  });

  it('updatePreferences', () => {
    api.update.updatePreferences({ autoUpdate: true });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('update:updatePreferences', { autoUpdate: true });
  });
});

// ─── startupUpdate ────────────────────────────────────────────────────────────
describe('electronAPI.startupUpdate', () => {
  it('checkAndInstallUpdates', () => {
    api.startupUpdate.checkAndInstallUpdates();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('startup:checkAndInstallUpdates');
  });

  it('onProgress subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.startupUpdate.onProgress(cb);
    simulateEvent('startup:updateProgress', { percent: 75 });
    expect(cb).toHaveBeenCalledWith({ percent: 75 });
    unsub();
  });
});

// ─── mcpLibrary ───────────────────────────────────────────────────────────────
describe('electronAPI.mcpLibrary', () => {
  it('getLibraryData', () => {
    api.mcpLibrary.getLibraryData();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcpLibrary:getLibraryData');
  });

  it('fetchAndUpdate', () => {
    api.mcpLibrary.fetchAndUpdate();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcpLibrary:fetchAndUpdate');
  });
});

// ─── mcp – additional events ──────────────────────────────────────────────────
describe('electronAPI.mcp – additional', () => {
  it('onServerStatesUpdated subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.mcp.onServerStatesUpdated(cb);
    simulateEvent('mcp:serverStatesUpdated', [{ name: 'mcp1', status: 'connected' }]);
    expect(cb).toHaveBeenCalledWith([{ name: 'mcp1', status: 'connected' }]);
    unsub();
  });

  it('onServerLogUpdate subscribes and forwards event', () => {
    const cb = vi.fn();
    const unsub = api.mcp.onServerLogUpdate(cb);
    simulateEvent('mcp:serverLogUpdate', { serverName: 'mcp1', entry: { level: 'info', msg: 'test' } });
    expect(cb).toHaveBeenCalledWith({ serverName: 'mcp1', entry: { level: 'info', msg: 'test' } });
    unsub();
  });

  it('resetOAuth with default scope', () => {
    api.mcp.resetOAuth('server1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:resetOAuth', 'server1', 'tokens');
  });

  it('resetOAuth with explicit scope', () => {
    api.mcp.resetOAuth('server1', 'all');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:resetOAuth', 'server1', 'all');
  });

  it('getServerLogs', () => {
    api.mcp.getServerLogs('server1', { level: 'warn' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:getServerLogs', 'server1', { level: 'warn' });
  });

  it('getAllServerLogStats', () => {
    api.mcp.getAllServerLogStats();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:getAllServerLogStats');
  });

  it('clearServerLogs', () => {
    api.mcp.clearServerLogs('server1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:clearServerLogs', 'server1');
  });

  it('setServerLoggingEnabled', () => {
    api.mcp.setServerLoggingEnabled('server1', true);
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:setServerLoggingEnabled', 'server1', true);
  });

  it('openServerLogFile', () => {
    api.mcp.openServerLogFile('server1');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('mcp:openServerLogFile', 'server1');
  });
});

// ─── kosmos ───────────────────────────────────────────────────────────────────
describe('electronAPI.kosmos', () => {
  it('replacePlaceholders', () => {
    api.kosmos.replacePlaceholders({ KEY: 'value' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('kosmos:replacePlaceholders', { KEY: 'value' });
  });

  it('parseUserInputPlaceholders', () => {
    api.kosmos.parseUserInputPlaceholders({ config: 'data' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('kosmos:parseUserInputPlaceholders', { config: 'data' });
  });
});

// ─── runtime ──────────────────────────────────────────────────────────────────
describe('electronAPI.runtime – additional', () => {
  it('checkGitVersion', () => {
    api.runtime.checkGitVersion();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('runtime:check-git-version');
  });

  it('listPythonVersionsFast', () => {
    api.runtime.listPythonVersionsFast();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('runtime:list-python-versions-fast');
  });

  it('installPythonVersion', () => {
    api.runtime.installPythonVersion('3.11');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('runtime:install-python-version', '3.11');
  });

  it('uninstallPythonVersion', () => {
    api.runtime.uninstallPythonVersion('3.9');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('runtime:uninstall-python-version', '3.9');
  });

  it('setPinnedPythonVersion', () => {
    api.runtime.setPinnedPythonVersion('3.11');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('runtime:set-pinned-python-version', '3.11');
  });

  it('cleanUvCache', () => {
    api.runtime.cleanUvCache();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('runtime:clean-uv-cache');
  });


});

// ─── folder ───────────────────────────────────────────────────────────────────
describe('electronAPI.folder', () => {
  it('openLogs', () => {
    api.folder.openLogs();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('folder:openLogs');
  });

  it('openProfile', () => {
    api.folder.openProfile('user@example.com');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('folder:openProfile', 'user@example.com');
  });
});

// ─── logger ───────────────────────────────────────────────────────────────────
describe('electronAPI.logger', () => {
  it('manualFlush', () => {
    api.logger.manualFlush();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('logger:manualFlush');
  });

  it('sendLog uses ipcRenderer.send', () => {
    api.logger.sendLog({ level: 'info', message: 'test' });
    expect(mocks2.mockSend).toHaveBeenCalledWith('logger:rendererLog', { level: 'info', message: 'test' });
  });
});


// ─── chroma ───────────────────────────────────────────────────────────────────
describe('electronAPI.chroma', () => {
  it('startServer', () => {
    api.chroma.startServer('user@example.com');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chroma:startServer', 'user@example.com');
  });

  it('stopServer', () => {
    api.chroma.stopServer();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chroma:stopServer');
  });

  it('getServerStatus', () => {
    api.chroma.getServerStatus();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chroma:getServerStatus');
  });

  it('restartServer', () => {
    api.chroma.restartServer('user@example.com');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('chroma:restartServer', 'user@example.com');
  });
});

// ─── featureFlags ─────────────────────────────────────────────────────────────
describe('electronAPI.featureFlags', () => {
  it('getAllFlags', () => {
    api.featureFlags.getAllFlags();
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('featureFlags:getAllFlags');
  });

  it('isEnabled', () => {
    api.featureFlags.isEnabled('myFlag');
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('featureFlags:isEnabled', 'myFlag');
  });
});


// ─── profile – additional ─────────────────────────────────────────────────────
describe('electronAPI.profile – additional', () => {
  it('createChatSession', () => {
    api.profile.createChatSession('c1', { title: 'My Chat' });
    expect(mocks2.mockInvoke).toHaveBeenCalledWith('profile:createChatSession', 'c1', { title: 'My Chat' });
  });
});
