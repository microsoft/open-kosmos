import { ipcRenderer } from 'electron';

type Unsubscribe = () => void;
type SidecarPullResult = Promise<{ success: boolean; data?: any[]; error?: string }>;

/**
 * Preload bridge for the normalized sidecar caches (renderer normalization
 * Phase 1): per-alias pulls + change subscriptions for agents/skills/hooks,
 * mirroring mcp.getServerStatus / mcp.onServerStatesUpdated. Extracted from
 * preload/main.ts so the `profile` namespace object stays small and this wiring
 * is unit-testable in isolation. Spread into the runtime `profile` object.
 */
export function createProfileSidecarBridge() {
  const subscribe = <T>(channel: string, callback: (data: T) => void): Unsubscribe => {
    const listener = (_event: unknown, data: T) => callback(data);
    ipcRenderer.on(channel, listener as (...args: any[]) => void);
    return () => ipcRenderer.removeListener(channel, listener as (...args: any[]) => void);
  };

  return {
    getRegisteredAgents: (alias: string): SidecarPullResult =>
      ipcRenderer.invoke('agents:getAll', alias),
    getSkillsForAlias: (alias: string): SidecarPullResult =>
      ipcRenderer.invoke('skills:getAll', alias),
    getHooksForAlias: (alias: string): SidecarPullResult =>
      ipcRenderer.invoke('hooks:getAll', alias),
    onAgentsChanged: (
      callback: (data: { alias: string; agents: any[]; timestamp: number }) => void,
    ): Unsubscribe => subscribe('agents:changed', callback),
    onSkillsChanged: (
      callback: (data: { alias: string; skills: any[]; timestamp: number }) => void,
    ): Unsubscribe => subscribe('skills:changed', callback),
    onHooksChanged: (
      callback: (data: { alias: string; hooks: any[]; timestamp: number }) => void,
    ): Unsubscribe => subscribe('hooks:changed', callback),
  };
}
