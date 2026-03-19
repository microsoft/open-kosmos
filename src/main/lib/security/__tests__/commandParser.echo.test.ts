/**
 * CommandParser - Echo Command Tests
 * Test accuracy of path extraction from echo commands
 */

import { CommandParser } from '../commandParser';

describe('CommandParser - Echo command path extraction', () => {
  describe('Basic echo redirection', () => {
    it('should identify the redirect path after echo', () => {
      const cmd = 'echo "content" > output.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.txt']);
    });

    it('should identify the append redirect path after echo', () => {
      const cmd = 'echo "content" >> log.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['log.txt']);
    });

    it('should identify Windows paths', () => {
      const cmd = 'echo "content" > C:\\Temp\\output.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['C:\\Temp\\output.txt']);
    });

    it('should identify quoted paths', () => {
      const cmd = 'echo "content" > "C:\\Program Files\\output.txt"';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['C:\\Program Files\\output.txt']);
    });
  });

  describe('Echo commands with complex content', () => {
    it('should not identify echo content as a path (even if it contains path separators)', () => {
      const cmd = `echo 'window.data = { path: "/some/path", value: "test" }' > output.js`;
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.js']);
      expect(paths).not.toContain('/some/path');
    });

    it('should not identify large JavaScript code blocks as paths', () => {
      const cmd = `echo '// Script
window.competitorIntelligenceData = {
    generation_info: {
        analysis_period: "2024-12-01 to 2025-01-10"
    }
};' > "prompts\\\\CN AI Browser\\\\data.js"`;
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['prompts\\CN AI Browser\\data.js']);
      expect(paths.length).toBe(1);
    });

    it('should correctly handle long content with newline characters', () => {
      const longContent = `// Comment line 1
// Comment line 2
window.data = {
    key1: "value1",
    key2: "value2"
};`;
      const cmd = `echo '${longContent}' > output.js`;
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.js']);
    });
  });

  describe('Edge cases', () => {
    it('should handle echo command without redirection', () => {
      const cmd = 'echo "Hello World"';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual([]);
    });

    it('should handle incorrect redirection syntax', () => {
      const cmd = 'echo "content" >';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual([]);
    });

    it('should identify stderr redirection', () => {
      const cmd = 'echo "content" 2> error.log';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['error.log']);
    });

    it('should handle relative paths', () => {
      const cmd = 'echo "content" > ./output/file.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['./output/file.txt']);
    });
  });

  describe('Real-world test cases', () => {
    it('Case 1: echo long JavaScript content to file', () => {
      const cmd = `echo '// China AI Browser Competitive Intelligence Data Bridge Script
// Generated: 2025-01-10T09:52:00.000Z
// Analysis Period: 2024-12-01 to 2025-01-10

window.competitorIntelligenceData = {
    generation_info: {
        analysis_period: "2024-12-01 to 2025-01-10",
        data_extraction_time: "2025-01-10T09:52:00.000Z",
        total_sources: 9,
        intelligence_reliability: "high_quality",
        geographic_scope: "Greater_China",
        analysis_focus: "ai_browser_competition"
    },
    
    doubao_browser: {
        company: "ByteDance",
        ai_model: "Doubao 1.6 Large Model",
        mau_estimate: "157M+ MAU (August 2025)",
        market_ranking: "China''s #1 AI chatbot app",
        key_features: [
            "Multi-modal AI (text, audio, video chat)",
            "Image, video, podcast generation"
        ]
    }
};

// Verify data loaded
console.log("Competitive intelligence data loaded successfully");' > "prompts\\\\CN AI Browser Dashboard and Analysis\\\\competitor_data_bridge.js"`;

      const paths = CommandParser.extractPathsFromCommand(cmd);
      
      // Should only identify the path after redirection
      expect(paths).toEqual(['prompts\\CN AI Browser Dashboard and Analysis\\competitor_data_bridge.js']);
      expect(paths.length).toBe(1);
      
      // Should not contain any parts from the JavaScript content
      expect(paths).not.toContain('Greater_China');
      expect(paths).not.toContain('ai_browser_competition');
    });
  });
});