/**
 * Tests for Bing Web Search timeout fix
 * 
 * Issue: Bing/Google pages use extensive async loading (ads, tracking, dynamic content)
 * which causes 'networkidle' wait strategy to timeout after 60 seconds.
 * 
 * Fix: Changed waitUntil from 'networkidle' to 'domcontentloaded' and added
 * proper selector waiting for search results (li.b_algo).
 * 
 * Test case from bug report:
 * {
 *   "success": true,
 *   "totalQueries": 1,
 *   "totalResults": 0,
 *   "results": [],
 *   "errors": [
 *     "Search query \"Comet browser Google Play Store\" failed: TimeoutError: page.goto: Timeout 60000ms exceeded.\n
 *      Call log:\n - navigating to \"https://www.bing.com/search?q=Comet%20browser%20Google%20Play%20Store&setlang=en&cc=us\", 
 *      waiting until \"networkidle\"\n"
 *   ],
 *   "timestamp": "2026-01-27T04:12:14.356Z"
 * }
 */

import * as fs from 'fs';
import * as path from 'path';

describe('BingWebSearchTool - Timeout Fix Verification', () => {
  const toolFilePath = path.join(__dirname, '..', 'bingWebSearchTool.ts');
  let toolSourceCode: string;

  beforeAll(() => {
    // Read the actual source code to verify the fix is in place
    toolSourceCode = fs.readFileSync(toolFilePath, 'utf-8');
  });

  describe('page.goto() wait strategy', () => {
    it('should use domcontentloaded instead of networkidle for page.goto', () => {
      // The fix: page.goto should use waitUntil: 'domcontentloaded'
      // NOT waitUntil: 'networkidle' which causes 60s timeout
      
      // Find page.goto calls and check their waitUntil value
      const gotoPattern = /page\.goto\([^)]+waitUntil:\s*['"](\w+)['"]/g;
      const matches = [...toolSourceCode.matchAll(gotoPattern)];
      
      expect(matches.length).toBeGreaterThan(0);
      
      for (const match of matches) {
        const waitUntilValue = match[1];
        expect(waitUntilValue).toBe('domcontentloaded');
        expect(waitUntilValue).not.toBe('networkidle');
      }
    });

    it('should NOT have any networkidle in page.goto calls', () => {
      // Ensure no page.goto with networkidle exists
      const badPattern = /page\.goto\([^)]+waitUntil:\s*['"]networkidle['"]/;
      expect(toolSourceCode).not.toMatch(badPattern);
    });
  });

  describe('waitForLoadState calls', () => {
    it('should use domcontentloaded for waitForLoadState', () => {
      // The fix: waitForLoadState should use 'domcontentloaded' not 'networkidle'
      const loadStatePattern = /waitForLoadState\(\s*['"](\w+)['"]/g;
      const matches = [...toolSourceCode.matchAll(loadStatePattern)];
      
      // Should have domcontentloaded calls
      const domContentLoadedCalls = matches.filter(m => m[1] === 'domcontentloaded');
      expect(domContentLoadedCalls.length).toBeGreaterThan(0);
      
      // Should NOT have networkidle calls
      const networkIdleCalls = matches.filter(m => m[1] === 'networkidle');
      expect(networkIdleCalls.length).toBe(0);
    });
  });

  describe('search result selector waiting', () => {
    it('should wait for li.b_algo selector for search results', () => {
      // The fix adds waiting for specific search result selector
      // instead of relying on networkidle
      expect(toolSourceCode).toContain("waitForSelector('li.b_algo'");
    });

    it('should have graceful error handling for selector timeout', () => {
      // The fix should not throw on selector timeout, just warn and continue
      expect(toolSourceCode).toContain('Search result selector timed out, attempting to continue processing');
    });
  });

  describe('page stability handling', () => {
    it('should have graceful handling when page is not stable', () => {
      // The fix should not throw error when page is not stable
      // Instead, it should log warning and continue
      expect(toolSourceCode).toContain('Page did not fully stabilize, but continuing to parse results');
    });

    it('should NOT throw error on page instability', () => {
      // Old code threw: throw new Error('Page failed to stabilize, may still be navigating')
      // New code should NOT have this
      expect(toolSourceCode).not.toContain("throw new Error('Page failed to stabilize, may still be navigating')");
    });
  });

  describe('timeout configuration', () => {
    it('should use reasonable timeout for selector waiting (not 60s)', () => {
      // The selector wait should have a shorter timeout than the page timeout
      // to allow for graceful fallback
      const selectorTimeoutPattern = /waitForSelector\([^)]+timeout:\s*Math\.min\(timeout,\s*(\d+)\)/;
      const match = toolSourceCode.match(selectorTimeoutPattern);
      
      expect(match).toBeTruthy();
      if (match) {
        const selectorTimeout = parseInt(match[1], 10);
        expect(selectorTimeout).toBeLessThanOrEqual(30000); // Should be <= 30s
      }
    });
  });
});

describe('GoogleWebSearchTool - Timeout Fix Verification', () => {
  const toolFilePath = path.join(__dirname, '..', 'googleWebSearchTool.ts');
  let toolSourceCode: string;

  beforeAll(() => {
    try {
      toolSourceCode = fs.readFileSync(toolFilePath, 'utf-8');
    } catch {
      toolSourceCode = ''; // File might not exist
    }
  });

  it('should use domcontentloaded instead of networkidle for page.goto', () => {
    if (!toolSourceCode) {
      console.log('googleWebSearchTool.ts not found, skipping');
      return;
    }

    const gotoPattern = /page\.goto\([^)]+waitUntil:\s*['"](\w+)['"]/g;
    const matches = [...toolSourceCode.matchAll(gotoPattern)];
    
    if (matches.length === 0) {
      // No explicit waitUntil, which is fine
      return;
    }
    
    for (const match of matches) {
      const waitUntilValue = match[1];
      expect(waitUntilValue).not.toBe('networkidle');
    }
  });
});

describe('BingImageSearchTool - Timeout Fix Verification', () => {
  const toolFilePath = path.join(__dirname, '..', 'bingImageSearchTool.ts');
  let toolSourceCode: string;

  beforeAll(() => {
    try {
      toolSourceCode = fs.readFileSync(toolFilePath, 'utf-8');
    } catch {
      toolSourceCode = '';
    }
  });

  it('should use domcontentloaded instead of networkidle for page.goto', () => {
    if (!toolSourceCode) {
      console.log('bingImageSearchTool.ts not found, skipping');
      return;
    }

    const badPattern = /page\.goto\([^)]+waitUntil:\s*['"]networkidle['"]/;
    expect(toolSourceCode).not.toMatch(badPattern);
  });

  it('should NOT have networkidle in waitForLoadState calls', () => {
    if (!toolSourceCode) return;

    const loadStatePattern = /waitForLoadState\(\s*['"]networkidle['"]/g;
    const matches = [...toolSourceCode.matchAll(loadStatePattern)];
    expect(matches.length).toBe(0);
  });
});

describe('GoogleImageSearchTool - Timeout Fix Verification', () => {
  const toolFilePath = path.join(__dirname, '..', 'googleImageSearchTool.ts');
  let toolSourceCode: string;

  beforeAll(() => {
    try {
      toolSourceCode = fs.readFileSync(toolFilePath, 'utf-8');
    } catch {
      toolSourceCode = '';
    }
  });

  it('should use domcontentloaded instead of networkidle for page.goto', () => {
    if (!toolSourceCode) {
      console.log('googleImageSearchTool.ts not found, skipping');
      return;
    }

    const badPattern = /page\.goto\([^)]+waitUntil:\s*['"]networkidle['"]/;
    expect(toolSourceCode).not.toMatch(badPattern);
  });

  it('should NOT have networkidle in waitForLoadState calls', () => {
    if (!toolSourceCode) return;

    const loadStatePattern = /waitForLoadState\(\s*['"]networkidle['"]/g;
    const matches = [...toolSourceCode.matchAll(loadStatePattern)];
    expect(matches.length).toBe(0);
  });
});
