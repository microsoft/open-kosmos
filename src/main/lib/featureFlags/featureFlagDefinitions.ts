/**
 * Feature Flag Definitions
 *
 * All feature flag configurations are defined in this file.
 *
 * Naming convention: openkosmosFeatureXXXXX
 *
 * When adding a new feature flag:
 * 1. Add the name to FeatureFlagName in types.ts
 * 2. Add the configuration in this file
 *
 * defaultValue supports two forms:
 * 1. Static boolean: defaultValue: false
 * 2. Dynamic function: defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'openkosmos'
 */

import { FeatureFlagConfig, FeatureFlagName, FeatureFlagContext, FeatureFlagDefaultValue } from './types';

/**
 * Feature Flag configuration list
 *
 * Grouped by feature module for easier maintenance
 */
export const FEATURE_FLAG_DEFINITIONS: FeatureFlagConfig[] = [
  // ============== Screenshot ==============
  {
    name: 'openkosmosFeatureScreenshot',
    description: 'Screenshot feature (enabled in all environments)',
    defaultValue: true,
  },

  // ============== Voice Input ==============
  {
    name: 'openkosmosFeatureVoiceInput',
    description: 'Voice Input (Speech-to-Text) feature (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Memex Memory ==============
  {
    name: 'openkosmosFeatureMemexMemory',
    description: 'Per-agent Zettelkasten memory via memex MCP (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Browser Control ==============
  {
    name: 'browserControl',
    description: 'Browser Control / Chrome Extension integration (dev environment only, Windows and macOS)',
    defaultValue: (ctx) => ctx.isDev && (ctx.platform === 'win32' || ctx.platform === 'darwin'),
  },

  // ============== Git Integration ==============
  {
    name: 'openkosmosUseGit',
    description: 'Git integration feature for version control operations',
    defaultValue: (ctx) => ctx.isDev, // Enable by default in dev environment for testing, can be enabled in prod as needed
  },

  // ============== Scheduler ==============
  {
    name: 'openkosmosFeatureScheduler',
    description: 'Cron-based scheduled task system',
    defaultValue: () => true,
  },

  // ============== Sub-Agent ==============
  {
    name: 'openkosmosFeatureSubAgent',
    description: 'Named Sub-Agent system — AGENT.md management, settings UI, agent editor tab, delegation prompt',
    defaultValue: false,
  },
  {
    name: 'openkosmosFeatureSubAgentAutoWake',
    description: 'Auto-wake parent session when background sub-agent results are ready',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Sync ==============
  {
    name: 'openkosmosUseSync',
    description: 'Sync feature for syncing profile data to GitHub repository',
    defaultValue: (ctx) => ctx.isDev, // Enable by default in dev environment for testing
  },


  // ============== Path Portability ==============
  {
    name: 'openkosmosPathPortability',
    description: 'Auto-convert workspace/knowledgeBase paths from other OSes (Windows↔macOS↔Linux) to local format when loading profile',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Coding Agent ==============
  {
    name: 'openkosmosFeatureCodingAgent',
    description: 'Foreground coding agent via Claude Code CLI (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Doctor ==============
  {
    name: 'openkosmosFeatureDoctor',
    description: 'Doctor (in-app self-diagnosis) Report Bug entry in UserMenu (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Buddy Companion ==============
  {
    name: 'openkosmosFeatureBuddy',
    description: 'Enable the Buddy companion widget',
    defaultValue:  (ctx) => ctx.isDev, // Enable by default in dev environment for testing
  },

  // ============== External Agent ==============
  {
    name: 'openkosmosFeatureExternalAgent',
    description: 'External Agent connection via WebSocket (enabled by default)',
    defaultValue: true,
  },

  // ============== Plugins ==============
  {
    name: 'openkosmosFeaturePlugins',
    description: 'Plugin management feature (dev environment only)',
    defaultValue: (ctx) => ctx.isDev,
  },

  // ============== Tool Search (Deferred Tool Loading) ==============
  {
    name: 'openkosmosFeatureToolSearch',
    description: 'Deferred tool loading: MCP tools are not sent to the LLM by default; a tool_search meta-tool enables on-demand discovery',
    defaultValue: (ctx) => ctx.isDev,
  },
];

/**
 * Map for fast configuration lookup
 */
export const FEATURE_FLAG_CONFIG_MAP: Map<FeatureFlagName, FeatureFlagConfig> = new Map(
  FEATURE_FLAG_DEFINITIONS.map(config => [config.name, config])
);

/**
 * Get feature flag configuration
 */
export function getFeatureFlagConfig(name: FeatureFlagName): FeatureFlagConfig | undefined {
  return FEATURE_FLAG_CONFIG_MAP.get(name);
}

/**
 * Get all feature flag names
 */
export function getAllFeatureFlagNames(): FeatureFlagName[] {
  return FEATURE_FLAG_DEFINITIONS.map(config => config.name);
}

/**
 * Resolve default value (supports both static values and dynamic functions)
 */
export function resolveDefaultValue(
  defaultValue: FeatureFlagDefaultValue,
  context: FeatureFlagContext
): boolean {
  if (typeof defaultValue === 'function') {
    return defaultValue(context);
  }
  return defaultValue;
}
