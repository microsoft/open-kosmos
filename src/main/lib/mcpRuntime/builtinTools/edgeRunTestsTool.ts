import { BuiltinToolDefinition } from './types';

export interface EdgeRunTestsToolArgs {
  testTarget: string;
  testFilter?: string;
}

export interface EdgeRunTestsToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class EdgeRunTestsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'edge_run_tests',
      description: 'Run Edge Chromium gtest tests with an optional filter. The Edge environment must be initialized first via edge_init_environment.',
      inputSchema: {
        type: 'object',
        properties: {
          testTarget: {
            type: 'string',
            description: 'Test target to run (e.g., "components_unittests", "unit_tests")'
          },
          testFilter: {
            type: 'string',
            description: 'Optional gtest filter pattern (e.g., "MyTest.*", "SuiteA.TestB:SuiteC.*"). Defaults to "*" (all tests).'
          }
        },
        required: ['testTarget']
      }
    };
  }

  static async execute(args: EdgeRunTestsToolArgs): Promise<EdgeRunTestsToolResult> {
    if (!args.testTarget || typeof args.testTarget !== 'string' || !args.testTarget.trim()) {
      throw new Error('testTarget must be a non-empty string');
    }

    const { runTests } = await import('./edge/edgeTerminal');
    const filterString = args.testFilter || '*';
    const result = await runTests(args.testTarget, filterString);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code
    };
  }
}
