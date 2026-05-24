/**
 * search_agents facade — list installed agents.
 */

import {
  BuiltinToolDefinition,
  SearchAgentsInput,
  FacadeResult,
  errorResult,
} from './types';
import { ListAgentsTool } from '../listAgentsTool';

export class SearchAgentsFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_agents',
      description:
        'List installed/configured agents. ' +
        'Use "installed: true" to list all installed agents.',
      inputSchema: {
        type: 'object',
        properties: {
          installed: {
            type: 'boolean',
            description: 'true = list all installed/configured agents',
          },
        },
      },
    };
  }

  static async execute(args: SearchAgentsInput): Promise<FacadeResult> {
    if (!args.installed) {
      return errorResult(
        'Provide "installed: true" to list installed agents.',
      );
    }

    const result = await ListAgentsTool.execute();
    return result as unknown as FacadeResult;
  }
}
