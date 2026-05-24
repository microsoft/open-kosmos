/**
 * Feature Flag type definitions
 */

/**
 * All known Feature Flag names
 * Naming convention: openkosmosFeatureXXXXX
 * Add new feature flags here
 */
export type FeatureFlagName =
  | 'openkosmosFeatureToolbarSettings'    // Settings page Toolbar entry
  | 'openkosmosFeatureMemory'             // Memory/Context Enhancement feature
  | 'openkosmosFeatureScreenshot'         // Screenshot capture feature
  | 'openkosmosFeatureVoiceInput'         // Voice Input (Speech-to-Text) feature
  | 'browserControl'                  // Browser Control / Chrome Extension feature
  | 'openkosmosUseGit'                    // Git integration feature
  | 'openkosmosFeatureScheduler'          // Cron-based scheduled task system
  | 'openkosmosFeatureSubAgent'           // Sub-Agent system
  | 'openkosmosFeatureSubAgentAutoWake'   // Auto-wake parent on background result ready
  | 'openkosmosUseSync'                   // Sync feature for profile data

  | 'openkosmosFeatureRemoteChannel'      // Remote Channel / Remote Control feature
  | 'openkosmosPathPortability'           // Cross-OS path conversion for profile sync
  | 'openkosmosFeatureRemoteChannelGraphDownload'   // Use Graph API for remote channel attachment downloads
  | 'openkosmosFeatureBuddy'              // Buddy companion widget
  | 'openkosmosFeatureMemexMemory'        // Per-agent Zettelkasten memory via memex MCP
  | 'openkosmosFeatureCodingAgent'       // Foreground coding agent (Claude Code CLI)
  | 'openkosmosFeatureAzureCli'          // Built-in Azure CLI execute tool
  | 'openkosmosFeatureExternalAgent'    // External Agent via WebSocket
  | 'openkosmosFeatureDoctor'            // Doctor (in-app self-diagnosis) entry in UserMenu
  | 'openkosmosFeatureSendTeamsMessage'  // Teams write tools (send, react, edit) and Outlook email
  | 'openkosmosFeatureAgencyCLI'         // Microsoft 365 MCP servers via Agency CLI
  | 'openkosmosFeatureToolSearch'        // Deferred tool loading for large tool sets
  | 'openkosmosFeaturePlugins'           // Plugin management feature
  // Add more feature flags here...
  ;

/**
 * Context used for dynamically computing default values
 */
export interface FeatureFlagContext {
  /** Whether this is a development environment */
  isDev: boolean;
  /** Current brand name */
  brandName: string;
  /** Platform (darwin, win32, linux) */
  platform: NodeJS.Platform;
  /** CPU architecture (arm64, x64, ia32) */
  arch: NodeJS.Architecture;
}

/**
 * Default value type: can be a boolean, or a function that computes based on context
 */
export type FeatureFlagDefaultValue = boolean | ((ctx: FeatureFlagContext) => boolean);

/**
 * Feature Flag configuration
 */
export interface FeatureFlagConfig {
  /** Flag name */
  name: FeatureFlagName;
  /** Description */
  description: string;
  /**
   * Default value: can be a static boolean, or a function that dynamically computes based on context
   * @example
   * // Static value
   * defaultValue: false
   *
   * // Dynamic logic
   * defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'pm-studio'
   */
  defaultValue: FeatureFlagDefaultValue;
}

/**
 * Feature Flag state
 */
export interface FeatureFlagState {
  /** Flag name */
  name: FeatureFlagName;
  /** Current value */
  enabled: boolean;
  /** Source: default or cli (command line) */
  source: 'default' | 'cli';
}

/**
 * State map for all Feature Flags
 */
export type FeatureFlagsMap = Record<FeatureFlagName, FeatureFlagState>;

/**
 * Simplified Feature Flags value map
 */
export type FeatureFlagsValues = Record<FeatureFlagName, boolean>;
