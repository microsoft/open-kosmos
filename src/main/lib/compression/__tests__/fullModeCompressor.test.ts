/**
 * Unit tests for FullModeCompressor - SKILL.md protection logic
 * 
 * Tests the new feature that preserves the first successful SKILL.md
 * read_file tool call and its corresponding tool result during context compression.
 */

// Mock ghcModelApi to avoid actual API calls
jest.mock('../../llm/ghcModelApi', () => ({
  ghcModelApi: {
    callModel: jest.fn().mockResolvedValue('<summary>Test summary content</summary>')
  }
}));

import { FullModeCompressor, createFullModeCompressor } from '../fullModeCompressor';
import { Message, MessageHelper } from '../../types/chatTypes';

// Helper to create test messages
function createUserMessage(text: string, id?: string): Message {
  return MessageHelper.createTextMessage(text, 'user', id || `user_${Date.now()}`);
}

function createAssistantMessage(text: string, id?: string, tool_calls?: any[]): Message {
  const msg = MessageHelper.createTextMessage(text, 'assistant', id || `assistant_${Date.now()}`);
  if (tool_calls) {
    msg.tool_calls = tool_calls;
  }
  return msg;
}

function createToolResultMessage(content: string, tool_call_id: string, name: string, id?: string): Message {
  return MessageHelper.createToolMessage(content, tool_call_id, name, id);
}

// Helper to create a SKILL.md read_file tool call
function createSkillToolCall(id: string, filePath: string) {
  return {
    id,
    type: 'function',
    function: {
      name: 'read_file',
      arguments: JSON.stringify({ filePath })
    }
  };
}

// Helper to create a successful SKILL.md tool result
function createSkillToolResult(tool_call_id: string): string {
  return JSON.stringify({
    content: "---\nname: titan-dynamic-query\ndescription: Execute and analyze dynamic SQL queries...\n---\n\n# Titan Dynamic Query SKILL\n\n## Purpose\n\nThis skill enables the analysis and execution of dynamic SQL queries...",
    fileName: "skill.md",
    startLine: 1,
    endLine: 383,
    totalLines: 383,
    size: 17324,
    truncated: false
  });
}

describe('FullModeCompressor - SKILL.md Protection', () => {
  let compressor: FullModeCompressor;

  beforeEach(() => {
    compressor = createFullModeCompressor({
      preserveRecentMessages: 3,
      preserveFirstUserMessage: true,
      preserveFirstSkillToolCall: true,
      enableDebugLog: false
    });
  });

  describe('findFirstSkillToolCallIndices', () => {
    it('should find SKILL.md tool call and its result', () => {
      const messages: Message[] = [
        createUserMessage('I want to analyze data from Titan', 'msg_1'),
        createAssistantMessage('I can help with that!', 'msg_2'),
        createUserMessage('Option 4', 'msg_3'),
        createAssistantMessage(
          "I'll load the Titan Dynamic Query skill",
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skills/titan-dynamic-query/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_5'
        ),
        createAssistantMessage('Perfect! The skill is loaded.', 'msg_6'),
      ];

      // Access private method via any type for testing
      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      expect(indices).toHaveLength(2);
      expect(indices).toContain(3); // Assistant message with tool_call
      expect(indices).toContain(4); // Tool result message
    });

    it('should be case-insensitive for skill.md filename', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/SKILL.MD')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      expect(indices).toHaveLength(2);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
    });

    it('should only protect the first SKILL.md, not subsequent ones', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading first skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
        createAssistantMessage(
          'Loading second skill',
          'msg_4',
          [createSkillToolCall('tool_call_2', '/another/path/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_2'),
          'tool_call_2',
          'read_file',
          'msg_5'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      // Should only contain indices for the first skill
      expect(indices).toHaveLength(2);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
      expect(indices).not.toContain(3);
      expect(indices).not.toContain(4);
    });

    it('should not protect failed tool results', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          '{"error": "File not found"}',
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      // Should include the tool call but not the error result
      expect(indices).toHaveLength(1);
      expect(indices).toContain(1);
    });

    it('should not protect tool results with very short content', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          'Short',  // Less than 100 chars
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      expect(indices).toHaveLength(1);
      expect(indices).toContain(1);
    });

    it('should return empty array when no SKILL.md tool call exists', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading file',
          'msg_2',
          [{
            id: 'tool_call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ filePath: '/path/to/config.json' })
            }
          }]
        ),
        createToolResultMessage(
          '{"config": "value"}',
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      expect(indices).toHaveLength(0);
    });

    it('should handle messages without tool_calls', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage('Just a response', 'msg_2'),
        createUserMessage('Another message', 'msg_3'),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      expect(indices).toHaveLength(0);
    });
  });

  describe('analyzeMessageStructure', () => {
    it('should include firstSkillToolCallIndices in analysis result', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
        createAssistantMessage('Done', 'msg_4'),
        createUserMessage('Continue', 'msg_5'),
        createAssistantMessage('OK', 'msg_6'),
        createUserMessage('More', 'msg_7'),
        createAssistantMessage('Sure', 'msg_8'),
      ];

      const analysis = (compressor as any).analyzeMessageStructure(messages);
      
      expect(analysis.firstSkillToolCallIndices).toHaveLength(2);
      expect(analysis.firstSkillToolCallIndices).toContain(1);
      expect(analysis.firstSkillToolCallIndices).toContain(2);
    });

    it('should return empty array when preserveFirstSkillToolCall is false', () => {
      const disabledCompressor = createFullModeCompressor({
        preserveFirstSkillToolCall: false
      });

      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading skill',
          'msg_2',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_3'
        ),
      ];

      const analysis = (disabledCompressor as any).analyzeMessageStructure(messages);
      
      expect(analysis.firstSkillToolCallIndices).toHaveLength(0);
    });
  });

  describe('compressMessages with SKILL.md protection', () => {
    it('should preserve SKILL.md tool call and result in compressed output', async () => {
      // Create a conversation that needs compression (more than preserveRecentMessages + first user)
      const messages: Message[] = [
        createUserMessage('I want to analyze data', 'msg_1'),               // Index 0 - First user
        createAssistantMessage('What kind?', 'msg_2'),                       // Index 1
        createUserMessage('Option 4', 'msg_3'),                              // Index 2
        createAssistantMessage(                                               // Index 3 - Skill tool call
          'Loading skill',
          'msg_4',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(                                              // Index 4 - Skill result
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_5'
        ),
        createAssistantMessage('Skill loaded!', 'msg_6'),                    // Index 5
        createUserMessage('Run query X', 'msg_7'),                           // Index 6
        createAssistantMessage('Running...', 'msg_8'),                       // Index 7
        createUserMessage('Show results', 'msg_9'),                          // Index 8 - Recent
        createAssistantMessage('Here they are', 'msg_10'),                   // Index 9 - Recent
        createUserMessage('Thanks', 'msg_11'),                               // Index 10 - Recent
      ];

      const result = await compressor.compressMessages(messages);

      // Check that compression happened
      expect(result.success).toBe(true);
      expect(result.compressedMessages.length).toBeLessThan(messages.length);

      // Find preserved messages by ID
      const preservedIds = result.compressedMessages.map(m => m.id);
      
      // First user message should be preserved
      expect(preservedIds).toContain('msg_1');
      
      // SKILL.md tool call and result should be preserved
      expect(preservedIds).toContain('msg_4'); // Tool call message
      expect(preservedIds).toContain('msg_5'); // Tool result message
      
      // Recent messages should be preserved
      expect(preservedIds).toContain('msg_9');
      expect(preservedIds).toContain('msg_10');
      expect(preservedIds).toContain('msg_11');
    });

    it('should not include SKILL.md messages in summary generation', async () => {
      const { ghcModelApi } = require('../../llm/ghcModelApi');
      
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage('Response 1', 'msg_2'),
        createAssistantMessage(
          'Loading skill',
          'msg_3',
          [createSkillToolCall('tool_call_1', '/path/to/skill.md')]
        ),
        createToolResultMessage(
          createSkillToolResult('tool_call_1'),
          'tool_call_1',
          'read_file',
          'msg_4'
        ),
        createAssistantMessage('Middle message', 'msg_5'),
        createUserMessage('Recent 1', 'msg_6'),
        createAssistantMessage('Recent 2', 'msg_7'),
        createUserMessage('Recent 3', 'msg_8'),
      ];

      await compressor.compressMessages(messages);

      // Check that the summary prompt was called
      expect(ghcModelApi.callModel).toHaveBeenCalled();
      
      // Get the prompt that was passed to the model
      const callArgs = ghcModelApi.callModel.mock.calls[0];
      const summaryPrompt = callArgs[1];
      
      // The SKILL.md content should NOT be in the summary prompt
      // (it's protected, so it shouldn't be summarized)
      expect(summaryPrompt).not.toContain('titan-dynamic-query');
    });
  });

  describe('edge cases', () => {
    it('should handle multiple tool calls in same message', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading multiple',
          'msg_2',
          [
            {
              id: 'tool_call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ filePath: '/path/to/config.json' })
              }
            },
            createSkillToolCall('tool_call_2', '/path/to/skill.md')
          ]
        ),
        createToolResultMessage('{"config": true}', 'tool_call_1', 'read_file', 'msg_3'),
        createToolResultMessage(createSkillToolResult('tool_call_2'), 'tool_call_2', 'read_file', 'msg_4'),
      ];

      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      
      // Should find the assistant message and the skill result
      expect(indices).toHaveLength(2);
      expect(indices).toContain(1); // Assistant message
      expect(indices).toContain(3); // Skill result (not config result)
    });

    it('should handle tool call with malformed arguments', () => {
      const messages: Message[] = [
        createUserMessage('Test', 'msg_1'),
        createAssistantMessage(
          'Loading',
          'msg_2',
          [{
            id: 'tool_call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: 'not valid json'
            }
          }]
        ),
      ];

      // Should not throw
      const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
      expect(indices).toHaveLength(0);
    });

    it('should handle empty messages array', () => {
      const indices = (compressor as any).findFirstSkillToolCallIndices([]);
      expect(indices).toHaveLength(0);
    });

    it('should handle SKILL.md in various path formats', () => {
      const testPaths = [
        '/Users/user/skills/my-skill/skill.md',
        '/Users/user/skills/my-skill/SKILL.md',
        '/Users/user/skills/my-skill/Skill.MD',
        'C:\\Users\\user\\skills\\my-skill\\skill.md',
        './skills/skill.md',
        'skill.md'
      ];

      for (const path of testPaths) {
        const messages: Message[] = [
          createUserMessage('Test'),
          createAssistantMessage(
            'Loading',
            undefined,
            [createSkillToolCall('tool_call_1', path)]
          ),
          createToolResultMessage(
            createSkillToolResult('tool_call_1'),
            'tool_call_1',
            'read_file'
          ),
        ];

        const indices = (compressor as any).findFirstSkillToolCallIndices(messages);
        expect(indices.length).toBeGreaterThan(0);
      }
    });
  });

  describe('configuration', () => {
    it('should use default config when not specified', () => {
      const defaultCompressor = createFullModeCompressor();
      const config = defaultCompressor.getConfig();
      
      expect(config.preserveFirstSkillToolCall).toBe(true);
      expect(config.summaryModel).toBe('claude-haiku-4.5');
    });

    it('should allow disabling SKILL.md protection', () => {
      const noProtectionCompressor = createFullModeCompressor({
        preserveFirstSkillToolCall: false
      });
      const config = noProtectionCompressor.getConfig();
      
      expect(config.preserveFirstSkillToolCall).toBe(false);
    });

    it('should allow updating config at runtime', () => {
      const comp = createFullModeCompressor({ preserveFirstSkillToolCall: true });
      expect(comp.getConfig().preserveFirstSkillToolCall).toBe(true);
      
      comp.updateConfig({ preserveFirstSkillToolCall: false });
      expect(comp.getConfig().preserveFirstSkillToolCall).toBe(false);
    });
  });
});
