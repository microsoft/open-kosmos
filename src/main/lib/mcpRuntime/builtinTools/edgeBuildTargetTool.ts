import { BuiltinToolDefinition } from './types';

export interface EdgeBuildTargetToolArgs {
  buildTarget: string;
}

export interface EdgeBuildTargetToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class EdgeBuildTargetTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'edge_build_target',
      description: 'Build an Edge Chromium target using autoninja. The Edge environment must be initialized first via edge_init_environment.',
      inputSchema: {
        type: 'object',
        properties: {
          buildTarget: {
            type: 'string',
            description: 'Build target to compile (e.g., "components_unittests", "unit_tests", "chrome")'
          }
        },
        required: ['buildTarget']
      }
    };
  }

  static async execute(args: EdgeBuildTargetToolArgs): Promise<EdgeBuildTargetToolResult> {
    if (!args.buildTarget || typeof args.buildTarget !== 'string' || !args.buildTarget.trim()) {
      throw new Error('buildTarget must be a non-empty string');
    }

    const { runBuild } = await import('./edge/edgeTerminal');
    const result = await runBuild(args.buildTarget);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code
    };
  }
}
