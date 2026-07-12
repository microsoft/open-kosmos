import { renderToMain } from '@shared/ipc/agentHooks';
import type { InvokeFn } from '@shared/ipc/base';

/**
 * Resolve the agentHooks invoke bridge lazily so importing this module never
 * throws when the preload bridge is absent (e.g. in unit tests that render a
 * route tree without a full `window.electronAPI`). The error only surfaces if a
 * method is actually called without the bridge present.
 */
const invoke: InvokeFn = (channel, ...args) => {
  const bridge = window.electronAPI?.agentHooks?.invoke;
  if (!bridge) {
    return Promise.reject(new Error('agentHooks IPC bridge is unavailable'));
  }
  return bridge(channel, ...args);
};

export const agentHooksApi = renderToMain.bindRender(invoke);
