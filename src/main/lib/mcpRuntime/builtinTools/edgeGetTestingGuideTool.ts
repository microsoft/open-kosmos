import { BuiltinToolDefinition } from './types';

const AVAILABLE_GUIDES = [
  'create_unit_tests',
  'add_unit_test',
  'add_unit_test_instructions',
  'code_analysis',
  'test_case_generation',
  'mock_generation',
] as const;

type GuideName = typeof AVAILABLE_GUIDES[number];

export interface EdgeGetTestingGuideToolArgs {
  guide: GuideName;
}

export interface EdgeGetTestingGuideToolResult {
  guide: string;
  content: string;
}

const GUIDE_DESCRIPTIONS: Record<GuideName, string> = {
  create_unit_tests: 'Step-by-step agent prompt for creating unit tests for Chromium source files',
  add_unit_test: 'Agent prompt for generating comprehensive unit tests for complex Chromium C++ files',
  add_unit_test_instructions: 'Comprehensive C++/Chromium unit testing reference guide with templates, patterns, and troubleshooting',
  code_analysis: 'Systematic guide for analyzing C++ code structure, dependencies, and data flow',
  test_case_generation: 'Guide for LLM-driven test case generation with coverage optimization strategies',
  mock_generation: 'Guide for intelligent mock generation, dependency analysis, and test environment setup',
};

export class EdgeGetTestingGuideTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'edge_get_testing_guide',
      description: `Retrieve Edge/Chromium C++ unit testing guides and prompt templates. Available guides: ${AVAILABLE_GUIDES.map(g => `"${g}" - ${GUIDE_DESCRIPTIONS[g]}`).join('; ')}`,
      inputSchema: {
        type: 'object',
        properties: {
          guide: {
            type: 'string',
            enum: [...AVAILABLE_GUIDES],
            description: 'The guide/prompt to retrieve. Options: ' + AVAILABLE_GUIDES.join(', ')
          }
        },
        required: ['guide']
      }
    };
  }

  static async execute(args: EdgeGetTestingGuideToolArgs): Promise<EdgeGetTestingGuideToolResult> {
    if (!args.guide || !AVAILABLE_GUIDES.includes(args.guide as GuideName)) {
      throw new Error(`Invalid guide name: "${args.guide}". Available: ${AVAILABLE_GUIDES.join(', ')}`);
    }

    const content = await this.loadGuide(args.guide as GuideName);

    return {
      guide: args.guide,
      content
    };
  }

  private static async loadGuide(guide: GuideName): Promise<string> {
    let raw: string;

    switch (guide) {
      case 'create_unit_tests':
        raw = (await import('./edge/prompts/create_unit_tests.prompt.md')).default;
        break;
      case 'add_unit_test':
        raw = (await import('./edge/prompts/add_unit_test.prompt.md')).default;
        break;
      case 'add_unit_test_instructions':
        raw = (await import('./edge/prompts/add_unit_test.instructions.md')).default;
        break;
      case 'code_analysis':
        raw = (await import('./edge/prompts/code_analysis_guide.md')).default;
        break;
      case 'test_case_generation':
        raw = (await import('./edge/prompts/llm_test_case_generation_guide.md')).default;
        break;
      case 'mock_generation':
        raw = (await import('./edge/prompts/test_support_mock_guide.md')).default;
        break;
      default:
        throw new Error(`Unknown guide: ${guide}`);
    }

    // Replace original MCP tool names with Kosmos built-in tool names
    return raw
      .replace(/mcp_edge_ut_init_edge_environment/g, 'edge_init_environment')
      .replace(/mcp_edge_ut_init/g, 'edge_init_environment')
      .replace(/mcp_edge_ut_build_target/g, 'edge_build_target')
      .replace(/mcp_edge_ut_build/g, 'edge_build_target')
      .replace(/mcp_edge_ut_run_tests/g, 'edge_run_tests');
  }
}
