/**
 * CommandParser - Echo command tests
 * Tests path extraction accuracy for echo commands
 */

import { CommandParser } from '../commandParser';

describe('CommandParser - Echo command path extraction', () => {
  describe('basic echo redirection', () => {
    it('should recognize the redirection path after echo', () => {
      const cmd = 'echo "content" > output.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.txt']);
    });

    it('should recognize the append redirection path after echo', () => {
      const cmd = 'echo "content" >> log.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['log.txt']);
    });

    it('should recognize Windows paths', () => {
      const cmd = 'echo "content" > C:\\Temp\\output.txt';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['C:\\Temp\\output.txt']);
    });

    it('should recognize quoted paths', () => {
      const cmd = 'echo "content" > "C:\\Program Files\\output.txt"';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['C:\\Program Files\\output.txt']);
    });
  });

  describe('echo commands with complex content', () => {
    it('should not recognize echo content as paths (even when it contains path separators)', () => {
      const cmd = `echo 'window.data = { path: "/some/path", value: "test" }' > output.js`;
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.js']);
      expect(paths).not.toContain('/some/path');
    });

    it('should not recognize a large block of JavaScript code as paths', () => {
      const cmd = `echo '// Script
window.competitorIntelligenceData = {
    generation_info: {
        analysis_period: "2024-12-01 至 2025-01-10"
    }
};' > "prompts\\\\CN AI Browser\\\\data.js"`;
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['prompts\\CN AI Browser\\data.js']);
      expect(paths.length).toBe(1);
    });

    it('should correctly handle long content with line breaks', () => {
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

  describe('edge cases', () => {
    it('should handle echo commands with no redirection', () => {
      const cmd = 'echo "Hello World"';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual([]);
    });

    it('should handle malformed redirection syntax', () => {
      const cmd = 'echo "content" >';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual([]);
    });

    it('should recognize stderr redirection', () => {
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

  describe('real-world cases provided by user', () => {
    it('case 1: echo long JavaScript content to file', () => {
      const cmd = `echo '// China AI Browser Competitive Intelligence Data Bridge Script
// Generated: 2025-01-10T09:52:00.000Z
// Analysis Period: 2024-12-01 至 2025-01-10

window.competitorIntelligenceData = {
    generation_info: {
        analysis_period: "2024-12-01 至 2025-01-10",
        data_extraction_time: "2025-01-10T09:52:00.000Z",
        total_sources: 9,
        intelligence_reliability: "high_quality",
        geographic_scope: "Greater_China",
        analysis_focus: "ai_browser_competition"
    },

    doubao_browser: {
        company: "字节跳动 (ByteDance)",
        ai_model: "Doubao 1.6 大模型",
        mau_estimate: "157M+ MAU (August 2025)",
        market_ranking: "China''s #1 AI chatbot app",
        key_features: [
            "Multi-modal AI (text, audio, video chat)",
            "Image, video, podcast generation"
        ]
    }
};

// 验证数据加载
console.log("竞争情报数据加载完成");' > "prompts\\\\CN AI Browser Dashboard and Analysis\\\\competitor_data_bridge.js"`;

      const paths = CommandParser.extractPathsFromCommand(cmd);

      // should only recognize the path after the redirection
      expect(paths).toEqual(['prompts\\CN AI Browser Dashboard and Analysis\\competitor_data_bridge.js']);
      expect(paths.length).toBe(1);

      // should not contain any part of the JavaScript content
      expect(paths).not.toContain('Greater_China');
      expect(paths).not.toContain('ai_browser_competition');
    });
  });
});