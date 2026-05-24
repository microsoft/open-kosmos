/**
 * CommandParser - PowerShell New-Item command tests
 * Tests path extraction accuracy for New-Item commands
 */

import { CommandParser } from '../commandParser';

describe('CommandParser - PowerShell New-Item command path extraction', () => {
  describe('basic New-Item commands', () => {
    it('should recognize the path from the -Path parameter', () => {
      const cmd = 'New-Item -Path "output.txt" -ItemType File';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.txt']);
    });

    it('should recognize Windows paths', () => {
      const cmd = 'New-Item -Path "C:\\Temp\\output.txt" -ItemType File';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['C:\\Temp\\output.txt']);
    });

    it('should recognize relative paths', () => {
      const cmd = 'New-Item -Path ".\\config\\settings.json" -ItemType File';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['.\\config\\settings.json']);
    });
  });

  describe('New-Item commands with -Value parameter', () => {
    it('should not recognize -Value content as paths', () => {
      const cmd = 'New-Item -Path "output.js" -ItemType File -Value "window.data = { path: \\"/some/path\\" }"';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['output.js']);
      expect(paths).not.toContain('/some/path');
    });

    it('should correctly handle a large block of code in the -Value parameter', () => {
      const cmd = `New-Item -Path "prompts\\\\CN AI Browser\\\\data.js" -ItemType File -Value "// Script
window.competitorIntelligenceData = {
    generation_info: {
        analysis_period: \\"2024-12-01 至 2025-01-10\\"
    }
};"`;
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual(['prompts\\CN AI Browser\\data.js']);
      expect(paths.length).toBe(1);
    });
  });

  describe('real-world cases provided by user', () => {
    it('case 2: New-Item long JavaScript content to file', () => {
      const cmd = `New-Item -Path "prompts\\CN AI Browser Dashboard and Analysis\\competitor_data_bridge.js" -ItemType File -Value "// China AI Browser Competitive Intelligence Data Bridge Script
// Generated: 2025-01-10T09:52:00.000Z
// Analysis Period: 2024-12-01 至 2025-01-10

window.competitorIntelligenceData = {
    generation_info: {
        analysis_period: \\"2024-12-01 至 2025-01-10\\",
        data_extraction_time: \\"2025-01-10T09:52:00.000Z\\",
        total_sources: 9,
        intelligence_reliability: \\"high_quality\\",
        geographic_scope: \\"Greater_China\\",
        analysis_focus: \\"ai_browser_competition\\"
    },

    doubao_browser: {
        company: \\"字节跳动 (ByteDance)\\",
        ai_model: \\"Doubao 1.6 大模型\\",
        mau_estimate: \\"157M+ MAU (August 2025)\\",
        market_ranking: \\"China's #1 AI chatbot app\\",
        key_features: [
            \\"Multi-modal AI (text, audio, video chat)\\",
            \\"Image, video, podcast generation\\"
        ]
    }
};

// 验证数据加载
console.log(\\"竞争情报数据加载完成\\");"`;

      const paths = CommandParser.extractPathsFromCommand(cmd);

      // should only recognize the -Path parameter path
      expect(paths).toEqual(['prompts\\CN AI Browser Dashboard and Analysis\\competitor_data_bridge.js']);
      expect(paths.length).toBe(1);

      // should not contain any content from the -Value parameter
      expect(paths).not.toContain('Greater_China');
      expect(paths).not.toContain('ai_browser_competition');
    });
  });

  describe('edge cases', () => {
    it('should handle commands with no -Path parameter', () => {
      const cmd = 'New-Item -ItemType Directory';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual([]);
    });

    it('should handle -Path followed by another parameter', () => {
      const cmd = 'New-Item -Path -ItemType File';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths).toEqual([]);
    });

    it('should recognize multiple path parameters (if present)', () => {
      const cmd = 'New-Item -Path "file1.txt" -Destination "file2.txt"';
      const paths = CommandParser.extractPathsFromCommand(cmd);
      expect(paths.length).toBeGreaterThanOrEqual(1);
      expect(paths).toContain('file1.txt');
    });
  });
});