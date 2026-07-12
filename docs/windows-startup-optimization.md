# Windows Application Startup Optimization

## Problem

On Windows, loading the chat engine before showing the main window made application startup appear unresponsive.

## Current Design

The main window is shown as soon as Electron emits `ready-to-show`. The chat engine is loaded afterward so parsing its dependency tree does not block the first visible frame.

```typescript
this.mainWindow.once('ready-to-show', () => {
  this.mainWindow.show();

  setImmediate(async () => {
    await import('./lib/chat/agentChatManager');
    this.isAgentChatReady = true;
    this.checkAppReadiness();
  });
});
```

The renderer displays a lightweight loading state until the main process emits `app:ready`. Readiness depends only on the chat engine; optional background services do not gate the transition.

## Expected Result

The window becomes visible promptly after launch, while the chat engine finishes loading in the background before the main interface becomes interactive.
