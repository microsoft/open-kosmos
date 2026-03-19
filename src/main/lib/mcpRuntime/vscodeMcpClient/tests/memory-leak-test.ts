/**
 * Memory Leak Test Suite for AbortSignal Management
 * 🧪 Test suite to validate EventTarget memory leak fixes
 * 
 * This test specifically targets the issue where 750+ abort listeners
 * were being added in attachStreamableBackchannel retry loops.
 */

import { AbortSignalMonitor, createSafeCombinedSignal } from '../utils/AbortSignalMonitor';
import { VscodeHttpTransport } from '../transport/VscodeHttpTransport';

interface TestResult {
  testName: string;
  success: boolean;
  initialListeners: number;
  finalListeners: number;
  details: string;
}

export class MemoryLeakTester {
  private results: TestResult[] = [];
  
  /**
   * Test 1: Backchannel retry scenario - the original problem
   */
  async testBackchannelRetryScenario(): Promise<TestResult> {
    const testName = 'Backchannel retry scenario test';
    AbortSignalMonitor.reset();
    const initialListeners = AbortSignalMonitor.getTotalListeners();
    
    
    try {
      // Simulate the exact problematic scenario from attachStreamableBackchannel
      const mainController = new AbortController();
      let peakListeners = 0;
      
      // This was the problematic retry loop
      for (let retry = 0; retry < 15; retry++) {
        // Each retry was creating a new backchannel controller
        const backchannelController = AbortSignalMonitor.createMonitoredController('attachStreamableBackchannel');
        
        // This call was adding 2 listeners per retry (one for each input signal)
        const combinedSignal = createSafeCombinedSignal([
          mainController.signal,
          backchannelController.signal
        ], 'Backchannel');
        
        const currentListeners = AbortSignalMonitor.getTotalListeners();
        peakListeners = Math.max(peakListeners, currentListeners);
        
        // Simulate connection failure and retry
        backchannelController.abort();
        
        await this.delay(10); // Small delay to simulate async operations
      }
      
      // Cleanup main controller
      mainController.abort();
      await this.delay(50); // Allow cleanup
      
      const finalListeners = AbortSignalMonitor.getTotalListeners();
      
      // With the fix, final listeners should be 0 or very low
      const success = finalListeners <= 5 && peakListeners <= AbortSignalMonitor['MAX_LISTENERS_PER_SIGNAL'];
      
      return {
        testName,
        success,
        initialListeners,
        finalListeners,
        details: `After 15 retries - peak: ${peakListeners}, final: ${finalListeners} (limit: ${AbortSignalMonitor['MAX_LISTENERS_PER_SIGNAL']})`
      };
      
    } catch (error) {
      return {
        testName,
        success: false,
        initialListeners,
        finalListeners: -1,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Test 2: Combined signal optimization
   */
  async testCombinedSignalOptimization(): Promise<TestResult> {
    const testName = 'Combined signal optimization test';
    AbortSignalMonitor.reset();
    const initialListeners = AbortSignalMonitor.getTotalListeners();
    
    
    try {
      const controllers: AbortController[] = [];
      
      // Test 1: Single signal should be returned directly
      const singleController = new AbortController();
      controllers.push(singleController);
      
      const singleSignal = createSafeCombinedSignal([singleController.signal], 'single');
      const afterSingle = AbortSignalMonitor.getTotalListeners();
      
      // Should be same signal, no new listeners
      const singleOptimized = singleSignal === singleController.signal && afterSingle === initialListeners;
      
      // Test 2: Aborted signals should be filtered out
      const abortedController = new AbortController();
      const activeController = new AbortController();
      controllers.push(activeController);
      
      abortedController.abort();
      
      const mixedSignal = createSafeCombinedSignal([
        abortedController.signal, 
        activeController.signal
      ], 'mixed');
      const afterMixed = AbortSignalMonitor.getTotalListeners();
      
      // Should return the active signal directly
      const mixedOptimized = mixedSignal === activeController.signal;
      
      // Cleanup
      controllers.forEach(c => c.abort());
      await this.delay(50);
      
      const finalListeners = AbortSignalMonitor.getTotalListeners();
      const success = singleOptimized && mixedOptimized && finalListeners <= 2;
      
      return {
        testName,
        success,
        initialListeners,
        finalListeners,
        details: `Single signal optimization: ${singleOptimized ? '✓' : '✗'}, Mixed signal optimization: ${mixedOptimized ? '✓' : '✗'}`
      };
      
    } catch (error) {
      return {
        testName,
        success: false,
        initialListeners,
        finalListeners: -1,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Test 3: Stress test with many controllers
   */
  async testStressScenario(): Promise<TestResult> {
    const testName = 'Stress test scenario';
    AbortSignalMonitor.reset();
    const initialListeners = AbortSignalMonitor.getTotalListeners();
    
    
    try {
      const controllers: AbortController[] = [];
      let hitLimit = false;
      
      // Try to create many combined signals until we hit the limit
      for (let i = 0; i < 30 && !hitLimit; i++) {
        try {
          const controller1 = new AbortController();
          const controller2 = new AbortController();
          controllers.push(controller1, controller2);
          
          const combinedSignal = createSafeCombinedSignal([
            controller1.signal,
            controller2.signal
          ], `stress-${i}`);
          
          await this.delay(5);
          
        } catch (error) {
          if (error instanceof Error && error.message.includes('listener limit exceeded')) {
            hitLimit = true;
          } else {
            throw error;
          }
        }
      }
      
      const peakListeners = AbortSignalMonitor.getTotalListeners();
      
      // Cleanup all controllers
      controllers.forEach(c => c.abort());
      await this.delay(100);
      
      const finalListeners = AbortSignalMonitor.getTotalListeners();
      
      // Success if we either hit the safety limit or stayed under control
      const success = (hitLimit && peakListeners <= AbortSignalMonitor['MAX_LISTENERS_PER_SIGNAL'] + 10) || 
                     (!hitLimit && peakListeners <= AbortSignalMonitor['MAX_LISTENERS_PER_SIGNAL']);
      
      return {
        testName,
        success,
        initialListeners,
        finalListeners,
        details: `Created ${controllers.length / 2} signal groups, peak listeners: ${peakListeners}, safety limit: ${hitLimit ? '✓' : '✗'}`
      };
      
    } catch (error) {
      return {
        testName,
        success: false,
        initialListeners,
        finalListeners: -1,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Test 4: HTTP Transport lifecycle with abort signal monitoring
   */
  async testTransportLifecycle(): Promise<TestResult> {
    const testName = 'HTTP transport lifecycle test';
    AbortSignalMonitor.reset();
    const initialListeners = AbortSignalMonitor.getTotalListeners();
    
    
    try {
      const transports: VscodeHttpTransport[] = [];
      
      // Create and immediately stop several transports
      for (let i = 0; i < 5; i++) {
        const transport = new VscodeHttpTransport({
          url: `http://localhost:${3000 + i}/mcp`,
          timeout: 5000
        });
        
        transports.push(transport);
        
        // Start transport (this may fail, but we're testing cleanup)
        try {
          await transport.start();
        } catch (error) {
          // Expected to fail without server, ignore
        }
        
        await this.delay(50);
        
        // Stop transport - this should clean up all listeners
        transport.stop();
        
        await this.delay(50);
      }
      
      const finalListeners = AbortSignalMonitor.getTotalListeners();
      
      // After stopping all transports, should be clean
      const success = finalListeners <= initialListeners + 3; // Small margin for timing
      
      return {
        testName,
        success,
        initialListeners,
        finalListeners,
        details: `Created and stopped ${transports.length} transport instances, final listeners: ${finalListeners}`
      };
      
    } catch (error) {
      return {
        testName,
        success: false,
        initialListeners,
        finalListeners: -1,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Run all tests and return results
   */
  async runAllTests(): Promise<{
    allPassed: boolean;
    results: TestResult[];
  }> {
    
    // Enable monitoring
    AbortSignalMonitor.setEnabled(true);
    
    const testMethods = [
      this.testBackchannelRetryScenario,
      this.testCombinedSignalOptimization,
      this.testStressScenario,
      this.testTransportLifecycle
    ];
    
    this.results = [];
    
    for (const testMethod of testMethods) {
      try {
        const result = await testMethod.call(this);
        this.results.push(result);
        
        const status = result.success ? '✅ Passed' : '❌ Failed';
        
      } catch (error) {
        const result: TestResult = {
          testName: 'Unknown test',
          success: false,
          initialListeners: 0,
          finalListeners: -1,
          details: `Exception: ${error instanceof Error ? error.message : String(error)}`
        };
        this.results.push(result);
      }
    }
    
    const allPassed = this.results.every(r => r.success);
    
    // Print summary
    this.printSummary();
    
    return { allPassed, results: this.results };
  }
  
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private printSummary(): void {
    
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    
    
    if (failedTests > 0) {
      this.results.filter(r => !r.success).forEach(result => {
      });
    }
    
    // Overall memory leak check
    const leakCheck = AbortSignalMonitor.checkForLeaks();
    if (leakCheck.hasLeaks) {
    } else {
    }
    
    const finalStats = AbortSignalMonitor.getStats();
    
    const overallStatus = passedTests === totalTests ? '🎉 All tests passed!' : '⚠️ Some tests failed';
  }
}

// Export for external usage
export async function runMemoryLeakTests(): Promise<boolean> {
  const tester = new MemoryLeakTester();
  const { allPassed } = await tester.runAllTests();
  return allPassed;
}

// Auto-run if executed directly
if (require.main === module) {
  runMemoryLeakTests()
    .then(passed => {
      process.exit(passed ? 0 : 1);
    })
    .catch(error => {
      process.exit(1);
    });
}

export default MemoryLeakTester;