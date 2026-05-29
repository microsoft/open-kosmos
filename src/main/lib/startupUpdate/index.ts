/**
 * Startup Update Module
 *
 * Handles checking and installing updates for MCP servers, Skills, and Agents
 * during application startup.
 */

export { StartupUpdateService, mergeEnv, mergeAgentMcpServers, mergeAgentSkills } from './startupUpdateService';
export type { StartupUpdateStep, StartupUpdateProgress, StartupUpdateResult } from './startupUpdateService';
