import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { browserCoreToolSchemas } from './tool-schemas-browser-core';
import { browserNavigationToolSchemas } from './tool-schemas-browser-navigation';
import { browserInteractionToolSchemas } from './tool-schemas-browser-interaction';
import { browserSupportToolSchemas } from './tool-schemas-browser-support';

export const TOOL_SCHEMAS: Tool[] = [
  ...browserCoreToolSchemas,
  ...browserNavigationToolSchemas,
  ...browserInteractionToolSchemas,
  ...browserSupportToolSchemas,
];
