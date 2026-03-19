import { BuiltinToolDefinition } from './types';

export interface EdgeInitEnvironmentToolArgs {
  repoPath: string;
  buildPath?: string;
}

export interface EdgeInitEnvironmentToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  initialized: boolean;
}

export class EdgeInitEnvironmentTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'edge_init_environment',
      description: 'Initialize the Edge Chromium development environment. Sets up depot_tools, runs gclient sync, and prepares the build environment. Must be called before using edge_build_target or edge_run_tests.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: {
            type: 'string',
            description: 'Absolute path to the Edge Chromium repository root (e.g., "D:\\\\edge\\\\src")'
          },
          buildPath: {
            type: 'string',
            description: 'Optional build output directory name relative to <repoPath>/out/ (default: "debug_x64")'
          }
        },
        required: ['repoPath']
      }
    };
  }

  static async execute(args: EdgeInitEnvironmentToolArgs): Promise<EdgeInitEnvironmentToolResult> {
    if (!args.repoPath || typeof args.repoPath !== 'string' || !args.repoPath.trim()) {
      throw new Error('repoPath must be a non-empty string');
    }

    const { initializeEdgeEnvironment } = await import('./edge/edgeTerminal');
    const result = await initializeEdgeEnvironment(args.repoPath, args.buildPath);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      initialized: result.code === 0
    };
  }
}
