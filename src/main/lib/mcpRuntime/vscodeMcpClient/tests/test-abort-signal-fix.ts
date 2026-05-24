/**
 * AbortSignal memory leak fix verification test
 * Tests correct management of AbortController listeners in retry loops
 */

import * as http from 'http';
import { VscodeHttpTransport } from '../transport/VscodeHttpTransport';

// Utility function to monitor the number of AbortSignal listeners
function getAbortListenerCount(signal: AbortSignal): number {
  // @ts-ignore - access internal property for monitoring
  const listeners = signal._listeners || signal.listeners;
  if (Array.isArray(listeners)) {
    return listeners.length;
  }
  // For Node.js 20+ EventTarget implementation
  // @ts-ignore
  const eventTargetListeners = signal._events?.abort;
  if (Array.isArray(eventTargetListeners)) {
    return eventTargetListeners.length;
  }
  if (typeof eventTargetListeners === 'function') {
    return 1;
  }
  return 0;
}

// Create a mock MCP server for testing retry scenarios
function createMockServer(port: number = 3333) {
  let requestCount = 0;

  const server = http.createServer((req: any, res: any) => {
    requestCount++;

    // Simulate an unstable server: first few requests fail, then returns SSE
    if (requestCount <= 3) {
      // First 3 requests return 500 error to trigger retries
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }

    // From the 4th request onward, return a normal SSE stream
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Send initial event
      res.write('event: endpoint\n');
      res.write(`data: http://localhost:${port}/post\n\n`);

      // Send a heartbeat message every 2 seconds
      const interval = setInterval(() => {
        res.write('event: message\n');
        res.write('data: {"jsonrpc":"2.0","method":"ping"}\n\n');
      }, 2000);

      // Close connection after 10 seconds to trigger retry
      setTimeout(() => {
        clearInterval(interval);
        res.end();
      }, 10000);

    } else if (req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"jsonrpc":"2.0","result":"ok"}');
    }
  });

  return { server, getRequestCount: () => requestCount };
}

async function testAbortSignalFix() {

  // Start mock server
  const { server, getRequestCount } = createMockServer(3333);

  try {
    await new Promise<void>((resolve) => {
      server.listen(3333, () => {
        resolve();
      });
    });

    // Create HTTP Transport
    const transport = new VscodeHttpTransport({
      serverName: 'abort-signal-fix-test',
      url: 'http://localhost:3333',
      headers: {},
      timeout: 5000
    });

    // Get the internal AbortController for monitoring
    // @ts-ignore - access private property for testing
    const abortController = transport._abortCtrl;

    let initialListenerCount = 0;
    let maxListenerCount = 0;
    let finalListenerCount = 0;

    // Set up listeners to record messages and state changes
    transport.on('message', (message) => {
    });

    transport.on('log', (level, message) => {
    });

    transport.on('stateChange', (state) => {
    });

    // Record initial listener count
    initialListenerCount = getAbortListenerCount(abortController.signal);

    // Start transport
    await transport.start();

    // Send the first message, which triggers mode detection and the retry loop
    await transport.send('{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}');

    // Wait a while to let the retry loop run

    // Check listener count every 2 seconds
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const currentCount = getAbortListenerCount(abortController.signal);
      maxListenerCount = Math.max(maxListenerCount, currentCount);


      // If listener count exceeds the threshold, there is a leak
      if (currentCount > 10) {
        break;
      }

      // If connection is established and some messages received, end early
      if (getRequestCount() > 10 && currentCount <= 2) {
        break;
      }
    }

    // Record final listener count
    finalListenerCount = getAbortListenerCount(abortController.signal);

    // Stop transport
    await transport.stop();

    // Final check
    const afterStopCount = getAbortListenerCount(abortController.signal);

    // Output test results

    // Determine whether the test passed
    if (maxListenerCount <= 5 && afterStopCount === 0) {
      return true;
    } else {
      if (maxListenerCount > 5) {
      }
      if (afterStopCount > 0) {
      }
      return false;
    }

  } catch (error) {
    return false;
  } finally {
    // Close mock server
    server.close();
  }
}

// If this file is run directly, execute the test
if (require.main === module) {
  testAbortSignalFix().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    process.exit(1);
  });
}

export { testAbortSignalFix };