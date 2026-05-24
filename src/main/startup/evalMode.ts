import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getProfileCacheManager, getMainAuthManager } from './lazy';
import { agentChatManager } from "../lib/chat/agentChatManager";
import { mcpClientManager } from "../lib/mcpRuntime/mcpClientManager";

/**
 * Load .env.local synchronously for eval mode.
 * In normal GUI mode, dotenv is loaded async via setImmediate and gated on
 * NODE_ENV=development. Eval mode needs EVAL_AUTH_TOKEN available before
 * the HTTP server starts, so we load it eagerly here regardless of NODE_ENV.
 */
function loadDotenvSync(): void {
  try {
    const dotenv = require('dotenv');
    const possiblePaths = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
    ];
    for (const envPath of possiblePaths) {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        console.error(`[EvalMode] Loaded .env.local from: ${envPath}`);
        return;
      }
    }
  } catch {
    // dotenv not available or file not found — rely on env vars from shell
  }
}

/**
 * Start the AgenticEval HTTP harness in headless mode.
 * Initializes only essential singletons (auth, profile, MCP, chat),
 * then starts the HTTP server for external evaluation systems.
 */
export async function startEvalMode(): Promise<void> {
  console.error('[EvalMode] Starting in eval mode (headless)');

  // Load .env.local before anything else — EVAL_AUTH_TOKEN may live there
  loadDotenvSync();

  try {
    // 1. Initialize ProfileCacheManager
    await getProfileCacheManager();

    // 2. Load auth from disk and restore session
    // In normal GUI flow, the renderer drives auth restoration via IPC.
    // In eval mode (headless, no renderer), we must do it ourselves.
    const authManager = await getMainAuthManager();
    const validAuths = await authManager.getValidAuthsForSignin();

    if (validAuths.validAuths.length === 0) {
      console.error('[EvalMode] FATAL: No authenticated session found. Please run OpenKosmos normally first to log in.');
      if (validAuths.expiredAuths.length > 0) {
        console.error(`[EvalMode] Found ${validAuths.expiredAuths.length} expired session(s) — tokens may need refresh. Log in via the GUI.`);
      }
      app.quit();
      return;
    }

    // Restore the first valid session (same as auto-login with single user)
    const authData = validAuths.validAuths[0];
    await authManager.setCurrentAuth(authData);
    const currentAuth = authManager.getCurrentAuth();

    if (!currentAuth) {
      console.error('[EvalMode] FATAL: Failed to restore auth session.');
      app.quit();
      return;
    }

    const userAlias = currentAuth.ghcAuth?.alias;
    if (!userAlias) {
      console.error('[EvalMode] FATAL: No user alias found in auth session.');
      app.quit();
      return;
    }

    console.error(`[EvalMode] Authenticated as: ${userAlias}`);

    // 3. Initialize AgentChatManager
    await agentChatManager.initialize(userAlias);
    console.error('[EvalMode] AgentChatManager initialized');

    // 4. Initialize MCPClientManager (for tool execution)
    try {
      await mcpClientManager.initialize(userAlias);
      console.error('[EvalMode] MCPClientManager initialized');
    } catch (error) {
      console.error('[EvalMode] WARNING: MCPClientManager init failed, tools may not work:', error);
    }

    // 5. Start the eval HTTP server
    const { EvalHttpServer } = await import('../lib/evalHarness/evalHttpServer');
    const server = new EvalHttpServer(userAlias);
    await server.start();

    console.error(`[EvalMode] HTTP server listening on http://127.0.0.1:${server.getPort()}/eval/`);
    console.error('[EvalMode] Endpoints: GET /eval/health, POST /eval/run, POST /eval/judge');

  } catch (error) {
    console.error('[EvalMode] FATAL: Failed to start eval mode:', error);
    app.quit();
  }
}
