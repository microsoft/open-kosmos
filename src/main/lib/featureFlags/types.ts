/**
 * Feature Flag Type Definitions
 */

/**
 * All known Feature Flag names
 * Naming convention: kosmosFeatureXXXXX
 * Add new feature flags here
 */
export type FeatureFlagName =
  | 'kosmosFeatureToolbarSettings'    // Settings page Toolbar entry
  | 'kosmosFeatureMemory'             // Memory/Context Enhancement feature
  | 'kosmosFeatureScreenshot'         // Screenshot feature
  | 'kosmosFeatureVoiceInput'         // Voice Input (Speech-to-Text) feature
  | 'browserControl'                  // Browser Control / Chrome Extension feature
  // Add more feature flags here...
  ;

/**
 * Context for dynamically computing default values
 */
export interface FeatureFlagContext {
  /** Whether it is a development environment */
  isDev: boolean;
  /** Current brand name */
  brandName: string;
  /** Platform (darwin, win32, linux) */
  platform: NodeJS.Platform;
  /** CPU architecture (arm64, x64, ia32) */
  arch: NodeJS.Architecture;
}

/**
 * Default value type: can be a boolean or a function computed based on context
 */
export type FeatureFlagDefaultValue = boolean | ((ctx: FeatureFlagContext) => boolean);

/**
 * Feature Flag Configuration
 */
export interface FeatureFlagConfig {
  /** Flag name */
  name: FeatureFlagName;
  /** Description */
  description: string;
  /** 
   * Default value: can be a static boolean, or a function dynamically computed based on context
   * @example
   * // Static value
   * defaultValue: false
   * 
   * // Dynamic logic
   * defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'openkosmos'
   */
  defaultValue: FeatureFlagDefaultValue;
}

/**
 * Feature Flag State
 */
export interface FeatureFlagState {
  /** Flag name */
  name: FeatureFlagName;
  /** Current value */
  enabled: boolean;
  /** Source: default, cli (command line) */
  source: 'default' | 'cli';
}

/**
 * State map of all Feature Flags
 */
export type FeatureFlagsMap = Record<FeatureFlagName, FeatureFlagState>;

/**
 * Simplified Feature Flags value map
 */
export type FeatureFlagsValues = Record<FeatureFlagName, boolean>;
