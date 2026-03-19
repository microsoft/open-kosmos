/**
 * AbortSignal listener management test under retry scenarios
 * Simulates real MCP server connection and retry loops
 */

import { VscodeHttpTransport } from '../transport/VscodeHttpTransport';

// Utility function to monitor the number of AbortSignal listeners
function getAbortListenerCount(signal: AbortSignal): number {
  // @ts-ignore - Access internal property for monitoring
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

// Create a more realistic MCP server mock with reconnection support
function createRealisticMockServer(port: number = 3334) {
  const http = require('http');
  let requestCount = 0;
  let connectionCount = 0;
  
  const server = http.createServer((req: any, res: any) => {
    requestCount++;
    
    if (req.method === 'POST') {
      // POST request: simulate StreamableHTTP
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'test-session-123'
      });
      res.end('{"jsonrpc":"2.0","result":"initialized"}');
      
    } else if (req.method === 'GET') {
      // GET request: simulate SSE backchannel
      connectionCount++;
      const currentConnection = connectionCount;
      
      
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      
      // Send initial connection confirmation
      res.write('event: message\n');
      res.write('data: {"jsonrpc":"2.0","method":"notifications/initialized"}\n\n');
      
      let messageCount = 0;
      const interval = setInterval(() => {
        messageCount++;
        res.write('event: message\n');
        res.write(`data: {"jsonrpc":"2.0","method":"ping","params":{"count":${messageCount}}}\n\n`);
        
        // Simulate unstable connection: disconnect after every 5 messages
        if (messageCount >= 5) {
          clearInterval(interval);
          res.end();
        }
      }, 1000);
      
      // Cleanup logic
      req.on('close', () => {
        clearInterval(interval);
      });
      
      req.on('error', () => {
        clearInterval(interval);
      });
    }
  });
  
  return { 
    server, 
    getRequestCount: () => requestCount,
    getConnectionCount: () => connectionCount 
  };
}

async function testRetryScenario() {
  
  // Start mock server
  const { server, getRequestCount, getConnectionCount } = createRealisticMockServer(3334);
  
  try {
    await new Promise<void>((resolve, reject) => {
      server.listen(3334, (err: any) => {
        if (err) reject(err);
        else {
          resolve();
        }
      });
    });
    
    // Create HTTP Transport
    const transport = new VscodeHttpTransport({
      url: 'http://localhost:3334',
      headers: {},
      timeout: 5000
    });
    
    // Get the internal AbortController for monitoring
    // @ts-ignore - Access private property for testing
    const abortController = transport._abortCtrl;
    
    let initialListenerCount = 0;
    let maxListenerCount = 0;
    let listenerCountHistory: number[] = [];
    
    // Set up listeners
    let messageCount = 0;
    transport.on('message', (message) => {
      messageCount++;
    });
    
    transport.on('log', (level, message) => {
      if (level === 'trace') return; // Ignore excessive trace logs
    });
    
    transport.on('stateChange', (state) => {
    });
    
    // Record initial listener count
    initialListenerCount = getAbortListenerCount(abortController.signal);
    
    // Start transport
    await transport.start();
    
    // Send initialization message, which establishes StreamableHTTP connection and SSE backchannel
    await transport.send('{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}');
    
    
    // Monitor for 60 seconds, during which multiple SSE reconnections will occur
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const currentCount = getAbortListenerCount(abortController.signal);
      listenerCountHistory.push(currentCount);
      maxListenerCount = Math.max(maxListenerCount, currentCount);
      
      // Report detailed status every 5 seconds
      if (i % 5 === 4) {
        
        // If listener count grows abnormally, alert immediately
        if (currentCount > 10) {
          break;
        }
      }
    }
    
    // Record final state
    const finalListenerCount = getAbortListenerCount(abortController.signal);
    
    // Stop transport
    await transport.stop();
    
    // Check after stopping
    const afterStopCount = getAbortListenerCount(abortController.signal);
    
    // Analyze listener count changes
    const avgListenerCount = listenerCountHistory.reduce((a, b) => a + b, 0) / listenerCountHistory.length;
    const maxConsecutiveHigh = getMaxConsecutiveHigh(listenerCountHistory, 5);
    
    // Output detailed test results
    
    
    // Determine whether the test passes
    const isHealthy = maxListenerCount <= 5 && 
                     afterStopCount === 0 && 
                     maxConsecutiveHigh <= 10 &&
                     avgListenerCount <= 3;
    
    if (isHealthy) {
      return true;
    } else {
      if (maxListenerCount > 5) {
      }
      if (afterStopCount > 0) {
      }
      if (maxConsecutiveHigh > 10) {
      }
      if (avgListenerCount > 3) {
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

// Function to analyze consecutive high values
function getMaxConsecutiveHigh(values: number[], threshold: number): number {
  let maxConsecutive = 0;
  let currentConsecutive = 0;
  
  for (const value of values) {
    if (value >= threshold) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }
  
  return maxConsecutive;
}

// If this file is run directly, execute the test
if (require.main === module) {
  testRetryScenario().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    process.exit(1);
  });
}

export { testRetryScenario };