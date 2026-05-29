/**
 * OpenKosmos Notifier - Send lifecycle notifications to OpenKosmos HTTP server (port 8000).
 *
 * Endpoints:
 * - POST /api/server-up   — Called after Native Server starts successfully
 * - POST /api/server-down  — Called before Native Server exits
 *
 * All notifications are fire-and-forget: they never throw and never block process exit.
 */
import * as http from 'http';
import { OpenKosmos_HTTP_BASE } from './constant';

const NOTIFY_TIMEOUT_MS = 2000;

/**
 * Send a POST request to OpenKosmos HTTP server.
 * Resolves on success or silently on any failure (timeout, connection refused, etc.).
 */
function postToOpenKosmos(path: string, body: Record<string, unknown>): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const data = JSON.stringify(body);
      const url = new URL(path, OpenKosmos_HTTP_BASE);

      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: NOTIFY_TIMEOUT_MS,
        },
        (res) => {
          // Drain response to free socket
          res.resume();
          res.on('end', () => resolve());
        },
      );

      req.on('error', () => {
        console.error(`[OpenKosmosNotifier] Failed to notify ${path} (connection error, OpenKosmos may not be running)`);
        resolve();
      });

      req.on('timeout', () => {
        console.error(`[OpenKosmosNotifier] Notify ${path} timed out after ${NOTIFY_TIMEOUT_MS}ms`);
        req.destroy();
        resolve();
      });

      req.write(data);
      req.end();
    } catch (err) {
      console.error(`[OpenKosmosNotifier] Unexpected error notifying ${path}:`, err);
      resolve();
    }
  });
}

/**
 * Notify OpenKosmos that the Native Server has started and is ready.
 * @param port - The port the Native Server is listening on
 */
export function notifyServerUp(port: number): Promise<void> {
  console.error(`[OpenKosmosNotifier] Notifying OpenKosmos: server-up (port=${port})`);
  return postToOpenKosmos('/api/server-up', { port });
}

/**
 * Notify OpenKosmos that the Native Server is about to shut down.
 * @param reason - Why the server is shutting down
 *   - "browser-closed": Browser was closed, stdin EOF
 *   - "browser-switch": OpenKosmos requested browser switch via /control/set-browser
 *   - "signal": SIGINT or SIGTERM received
 *   - "error": Uncaught exception or fatal error
 */
export function notifyServerDown(reason: string): Promise<void> {
  console.error(`[OpenKosmosNotifier] Notifying OpenKosmos: server-down (reason=${reason})`);
  return postToOpenKosmos('/api/server-down', { reason });
}
