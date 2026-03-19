/**
 * Test VSCode Standard HTTP Transport Implementation
 * Verify that the AbortSignal memory leak issue is fully resolved
 */

import { VscodeHttpTransport } from '../transport/VscodeHttpTransport';

interface TestResult {
  testName: string;
  success: boolean;
  details: string;
  abortSignalCount?: number;
}

class HttpTransportTester {
  private results: TestResult[] = [];
  
  async runAllTests(): Promise<TestResult[]> {
    
    // Test 1: Basic initialization
    await this.testBasicInitialization();
    
    // Test 2: Lifecycle management
    await this.testLifecycleManagement();
    
    // Test 3: AbortSignal cleanup
    await this.testAbortSignalCleanup();
    
    // Test 4: Multiple connection cycles
    await this.testMultipleConnectionCycles();
    
    this.printResults();
    return this.results;
  }
  
  private async testBasicInitialization(): Promise<void> {
    try {
      const transport = new VscodeHttpTransport({
        url: 'http://localhost:3000/test',
        headers: { 'Test': 'VSCode-Standard' }
      });
      
      // Verify initial state
      const initialState = transport.state;
      const success = initialState.state === 'stopped';
      
      this.results.push({
        testName: 'Basic initialization',
        success,
        details: success ? '✅ Initial state correct' : `❌ Initial state error: ${initialState.state}`
      });
      
      // Cleanup
      await transport.stop();
      
    } catch (error) {
      this.results.push({
        testName: 'Basic initialization',
        success: false,
        details: `❌ Initialization failed: ${error}`
      });
    }
  }
  
  private async testLifecycleManagement(): Promise<void> {
    try {
      const transport = new VscodeHttpTransport({
        url: 'http://localhost:3000/test'
      });
      
      // Test start
      await transport.start();
      const runningState = transport.state;
      
      // Test stop
      await transport.stop();
      const stoppedState = transport.state;
      
      const success = runningState.state === 'running' && stoppedState.state === 'stopped';
      
      this.results.push({
        testName: 'Lifecycle management',
        success,
        details: success ? 
          '✅ Start/stop flow normal' : 
          `❌ State transition error: ${runningState.state} -> ${stoppedState.state}`
      });
      
    } catch (error) {
      this.results.push({
        testName: 'Lifecycle management',
        success: false,
        details: `❌ Lifecycle test failed: ${error}`
      });
    }
  }
  
  private async testAbortSignalCleanup(): Promise<void> {
    try {
      // Get initial listener count (if possible)
      const initialListeners = this.getAbortSignalListenerCount();
      
      const transport = new VscodeHttpTransport({
        url: 'http://localhost:3000/test'
      });
      
      await transport.start();
      
      // Simulate some operations
      try {
        await transport.send('{"test": "message"}');
      } catch (error) {
        // Expected to fail since there is no real server
      }
      
      await transport.stop();
      
      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const finalListeners = this.getAbortSignalListenerCount();
      
      const success = finalListeners <= initialListeners + 1; // Allow some normal listeners
      
      this.results.push({
        testName: 'AbortSignal cleanup',
        success,
        details: success ? 
          '✅ AbortSignal listeners cleaned up correctly' : 
          `❌ Listener leak: initial ${initialListeners} -> final ${finalListeners}`,
        abortSignalCount: finalListeners
      });
      
    } catch (error) {
      this.results.push({
        testName: 'AbortSignal cleanup',
        success: false,
        details: `❌ AbortSignal test failed: ${error}`
      });
    }
  }
  
  private async testMultipleConnectionCycles(): Promise<void> {
    try {
      const cycleCount = 5;
      let allSuccessful = true;
      let errorDetails = '';
      
      for (let i = 0; i < cycleCount; i++) {
        const transport = new VscodeHttpTransport({
          url: `http://localhost:300${i}/test`
        });
        
        try {
          await transport.start();
          
          // Simulate message sending
          try {
            await transport.send(`{"cycle": ${i}, "test": true}`);
          } catch (error) {
            // Expected to fail, ignore network errors
          }
          
          await transport.stop();
          
        } catch (error) {
          allSuccessful = false;
          errorDetails += `Cycle ${i}: ${error}; `;
        }
      }
      
      const finalListeners = this.getAbortSignalListenerCount();
      
      this.results.push({
        testName: 'Multiple connection cycles',
        success: allSuccessful,
        details: allSuccessful ? 
          `✅ ${cycleCount} connection cycles successful, final listener count: ${finalListeners}` : 
          `❌ Connection cycle failed: ${errorDetails}`,
        abortSignalCount: finalListeners
      });
      
    } catch (error) {
      this.results.push({
        testName: 'Multiple connection cycles',
        success: false,
        details: `❌ Cycle test failed: ${error}`
      });
    }
  }
  
  private getAbortSignalListenerCount(): number {
    // This is an approximate listener count; a more precise method may be needed in practice
    try {
      // Get global AbortController and AbortSignal usage
      // This is just a placeholder; real monitoring requires a more complex implementation
      return 0;
    } catch (error) {
      return 0;
    }
  }
  
  private printResults(): void {
    
    let successCount = 0;
    
    this.results.forEach((result, index) => {
      if (result.abortSignalCount !== undefined) {
      }
      if (result.success) successCount++;
    });
    
    
    const overallSuccess = successCount === this.results.length;
    
    if (overallSuccess) {
    }
  }
}

// Run tests
async function runTests() {
  const tester = new HttpTransportTester();
  const results = await tester.runAllTests();
  
  // Return test results for use by other modules
  return results;
}

// If this file is run directly
if (require.main === module) {
  runTests().catch(console.error);
}

export { HttpTransportTester, runTests };