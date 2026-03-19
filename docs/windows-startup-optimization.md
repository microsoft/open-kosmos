# Windows Application Startup Performance Optimization Analysis and Implementation

## Current Situation
Users reported that in the Windows environment, there is a long wait time after clicking the application icon before the program window appears.

## Root Cause Analysis

Through an audit of the startup flow in `src/main/main.ts`, two major blocking points were identified on the Critical Rendering Path:

1.  **Database Connection Blocks the Startup Flow**
    *   **Location**: `onReady` method.
    *   **Behavior**: `await analyticsManager.init()` executes before `createMainWindow`.
    *   **Impact**: The application must wait for the SQLite database connection to be established and the table schema check to complete before it starts creating the browser window. On machines with slow disk I/O, this can add 300ms - 1000ms+ of latency.

2.  **Heavy Module Loading Blocks Window Display** (Most Severe)
    *   **Location**: `mainWindow.once('ready-to-show')` callback.
    *   **Behavior**: Before calling `mainWindow.show()`, the code executes `await import('./lib/chat/agentChatManager')`.
    *   **Impact**: `agentChatManager` and its dependency tree (including LLM libraries, etc.) are very large. Even though Electron has already rendered the first frame, the main process forces the window to remain hidden until these large JS modules are parsed and executed. This directly causes the "no response after clicking" phenomenon.

## Optimization Implementation

The following three-phase optimization has been applied:

### 1. Parallelize Startup Tasks
Move Analytics initialization out of the main startup sequence and execute it in parallel with window creation.

**After modification (src/main/main.ts):**
```typescript
  // Pseudocode
  const windowCreationTask = this.createMainWindow();
  (async () => { await analyticsManager.init(); this.isAnalyticsReady = true; })();
  await windowCreationTask;
```

### 2. "Show First" Strategy (Backend Lazy Loading)
In the `ready-to-show` event, execute `show()` first, then defer loading heavy modules via `setImmediate`.

**After modification (src/main/main.ts):**
```typescript
    this.mainWindow.once('ready-to-show', async () => {
      this.mainWindow.show(); // Show immediately!
      
      setImmediate(async () => {
          // Load heavy AI modules in the background
          await import('./lib/chat/agentChatManager');
          this.isAgentChatReady = true;
          this.checkAppReadiness(); // Notify the frontend
      });
    });
```

### 3. Frontend Loading State Management (UX Optimization)
To complement the "Show First" strategy and prevent users from interacting before the AI module is ready, the frontend listens for backend readiness status via IPC.

1.  **Main Process**: Maintains `isAnalyticsReady` and `isAgentChatReady` states, and sends an `app:ready` event once all are ready.
2.  **Renderer (App.tsx)**: Initially renders a lightweight loading screen, and only renders the main application after receiving the `app:ready` signal.

Compared to the previous "no response after clicking" behavior, the new flow is:
`Click icon` -> `Immediately show loading screen` -> `Backend modules finish loading` -> `Automatically enter main interface`.

This greatly improves the user's perceived responsiveness.

## Expected Results

## Expected Results
After implementing the above solution, the window display logic is no longer blocked by background AI module loading or database connections after the user clicks the icon, and the main interface should appear immediately.