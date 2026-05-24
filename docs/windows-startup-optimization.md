# Windows Application Startup Performance Optimization Analysis and Implementation

## Problem Statement
Users reported that on Windows, there is a long wait after clicking the application icon before the program window appears.

## Root Cause Analysis

Through an audit of the startup flow in `src/main/main.ts`, two major blocking points were identified on the Critical Rendering Path:

1.  **Database Connection Blocking Startup**
    *   **Location**: `onReady` method.
    *   **Behavior**: `await analyticsManager.init()` executes before `createMainWindow`.
    *   **Impact**: The application must wait for the SQLite database connection to be established and the table schema check to complete before starting to create the browser window. On machines with slow disk I/O, this can add 300ms - 1000ms+ of latency.

2.  **Heavy Module Loading Blocking Window Display** (most severe)
    *   **Location**: `mainWindow.once('ready-to-show')` callback.
    *   **Behavior**: Before calling `mainWindow.show()`, the code executes `await import('./lib/chat/agentChatManager')`.
    *   **Impact**: `agentChatManager` and its dependency tree (including LLM libraries etc.) are very large. Even after Electron has rendered the first frame, the main process forces the window to remain hidden until these large JS modules are parsed and executed. This directly causes the "click with no response" phenomenon.

## Optimization Implementation Plan

The following three-phase optimization has been applied:

### 1. Parallelizing Startup Tasks
Move Analytics initialization out of the main startup sequence to execute in parallel with window creation.

**After modification (src/main/main.ts):**
```typescript
  // Pseudocode
  const windowCreationTask = this.createMainWindow();
  (async () => { await analyticsManager.init(); this.isAnalyticsReady = true; })();
  await windowCreationTask;
```

### 2. "Show First" Strategy (Backend Lazy Loading)
In the `ready-to-show` event, prioritize executing `show()`, then use `setImmediate` to defer loading heavy modules.

**After modification (src/main/main.ts):**
```typescript
    this.mainWindow.once('ready-to-show', async () => {
      this.mainWindow.show(); // Show immediately!
      
      setImmediate(async () => {
          // Load heavy AI modules in the background
          await import('./lib/chat/agentChatManager');
          this.isAgentChatReady = true;
          this.checkAppReadiness(); // Notify frontend
      });
    });
```

### 3. Frontend Loading State Management (UX Optimization)
To support the "Show First" strategy and prevent user interaction before the AI modules are ready, the frontend listens to the backend ready state via IPC.

1.  **Main Process**: Maintains `isAnalyticsReady` and `isAgentChatReady` states, and sends the `app:ready` event once all are ready.
2.  **Renderer (App.tsx)**: Initially renders a lightweight Loading UI, and only renders the main application upon receiving the `app:ready` signal.

Compared to the previous "click with no response" behavior, the new flow is:
`Click icon` -> `Loading UI appears immediately` -> `Backend modules finish loading` -> `Automatically enters main UI`.

This greatly improves the user's perceived response speed.

## Expected Results

After implementing the above plan, the Window display logic will no longer be blocked by background AI module loading or database connection after the user clicks the icon, and the main UI should appear immediately.
