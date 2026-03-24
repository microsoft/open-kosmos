/**
 * Common selector constants
 *
 * ⚠️ The app currently has very few data-testid attributes, so selectors are primarily based on:
 *   - Text matching (text=...)
 *   - CSS class names (.class-name)
 *   - Semantic roles (role)
 *
 * data-testid attributes should be gradually added to key components to improve selector stability.
 *
 * Naming convention: {MODULE}_{COMPONENT}_{ELEMENT}, all uppercase with underscores.
 */
export const Selectors = {
  // ==================== App.tsx Initial Loading Screen ====================
  /** App initialization loading screen (dark background #1c1c1c) */
  LOADING_SCREEN_TEXT: 'text=Initializing Core Services',
  LOADING_SCREEN_BRAND: 'text=OpenKosmos',
  LOADING_SPINNER: '.animate-spin',

  // ==================== StartupPage (route /) ====================
  /** StartupPage root element */
  STARTUP_PAGE: '.startup-page',
  /** StartupPage progress bar track */
  STARTUP_PROGRESS_BAR: '.startup-progress-bar',
  /** StartupPage progress bar fill */
  STARTUP_PROGRESS_FILL: '.startup-progress-fill',
  /** StartupPage logo container */
  STARTUP_LOGO: '.startup-logo-container',
  /** StartupPage content area */
  STARTUP_CONTENT: '.startup-content',

  // ==================== SignInPage (route /login) ====================
  /** SignInPage root element */
  SIGN_IN_PAGE: '.signin-page',
  /** SignInPage card */
  SIGN_IN_CARD: '.signin-card',
  /** SignInPage card title */
  SIGN_IN_CARD_TITLE: '.signin-card-title',

  // --- State 2: Default login (new user) ---
  /** "Welcome to OpenKosmos" title */
  SIGN_IN_WELCOME_TITLE: 'text=Welcome to',
  /** Main sign-in button */
  SIGN_IN_BUTTON: 'button:has-text("Sign In with GitHub Copilot")',
  /** Sign-in button loading state */
  SIGN_IN_BUTTON_LOADING: 'button:has-text("Connecting to GitHub")',

  // --- State 1: Profile selection ---
  /** Profile selection title */
  SIGN_IN_CHOOSE_PROFILE: 'text=Choose Your Profile',
  /** New account sign-in button */
  SIGN_IN_NEW_ACCOUNT: 'button:has-text("Sign In with New GitHub Account")',

  // --- State 3: Generating device code ---
  /** "Generating Device Code" title */
  SIGN_IN_GENERATING_CODE: 'text=Generating Device Code',
  /** Generating code loading animation */
  SIGN_IN_LOADING_ICON: '.signin-loading-icon',

  // --- State 4: Device code flow ---
  /** "GitHub Copilot Authorization" title */
  SIGN_IN_DEVICE_FLOW_TITLE: 'text=GitHub Copilot Authorization',
  /** Device code display (<code> element with mono font text) */
  SIGN_IN_DEVICE_CODE: 'code.font-mono',
  /** Copy button */
  SIGN_IN_COPY_BUTTON: 'button:has-text("Copy")',
  /** "Copied" state button */
  SIGN_IN_COPIED_BUTTON: 'button:has-text("Copied")',
  /** Cancel authorization button */
  SIGN_IN_CANCEL_AUTH: 'button:has-text("Cancel Authorization")',
  /** Manually open authorization page button */
  SIGN_IN_MANUAL_OPEN: 'button:has-text("Manually open GitHub")',

  // ==================== AutoLoginSingleUser (route /auto-login) ====================
  /** Auto-login loading text */
  AUTO_LOGIN_SIGNING_IN: 'text=Signing In...',
  /** Auto-login profile loading text */
  AUTO_LOGIN_LOADING_PROFILE: 'text=Loading your profile...',

  // ==================== DataLoadingPage (route /loading) ====================
  /** DataLoading root element */
  DATA_LOADING_PAGE: '.data-loading-page',
  /** DataLoading welcome text */
  DATA_LOADING_WELCOME: '.data-loading-welcome',
  /** DataLoading progress bar */
  DATA_LOADING_PROGRESS_BAR: '.data-loading-progress-bar',
  /** DataLoading progress fill */
  DATA_LOADING_PROGRESS_FILL: '.data-loading-progress-fill',
  /** DataLoading details list */
  DATA_LOADING_DETAILS: '.data-loading-details',

  // ==================== Agent / Chat Page ====================
  /** Chat input textarea */
  CHAT_TEXTAREA: '.chat-textarea',
  /** Chat send button (idle state) */
  CHAT_SEND_BUTTON: '.send-button:not(.cancel-button)',
  /** Chat cancel button (streaming state) */
  CHAT_CANCEL_BUTTON: '.send-button.cancel-button',
  /** Chat input container */
  CHAT_INPUT_CONTAINER: '.chat-input-container',
  /** User message container */
  CHAT_USER_MESSAGE: '.message-container.user-message-container',
  /** Assistant message container */
  CHAT_ASSISTANT_MESSAGE: '.message-container.assistant-message-container',
  /** Message content (markdown body) */
  CHAT_MESSAGE_CONTENT: '.message-content.markdown-body',
  /** Message streaming state */
  CHAT_MESSAGE_STREAMING: '.message-content.markdown-body.streaming',
  /** Model selector */
  CHAT_MODEL_SELECTOR: '.model-selector',
  /** Model selection button */
  CHAT_MODEL_BUTTON: '.model-selector .model-button',
  /** Legacy selector — kept for backward compatibility */
  CHAT_INPUT:
    'textarea[placeholder*="message"], textarea[placeholder*="Message"]',
  CHAT_SEND_BUTTON_LEGACY:
    'button[aria-label*="send"], button[aria-label*="Send"]',

  // ==================== Navigation ====================
  NAV_SETTINGS: 'a[href*="settings"]',
  NAV_AGENT: 'a[href*="agent"]',

  // ==================== Settings Page ====================
  SETTINGS_NAV_MCP: 'a[href*="settings/mcp"]',
  SETTINGS_NAV_RUNTIME: 'a[href*="settings/runtime"]',
  SETTINGS_NAV_SKILLS: 'a[href*="settings/skills"]',
  SETTINGS_NAV_MEMORY: 'a[href*="settings/memory"]',
  SETTINGS_NAV_ABOUT: 'a[href*="settings/about"]',
  SETTINGS_NAV_VOICE: 'a[href*="settings/voice-input"]',
  SETTINGS_NAV_TTS: 'a[href*="settings/tts"]',
  SETTINGS_NAV_SCREENSHOT: 'a[href*="settings/screenshot"]',
  SETTINGS_NAV_BROWSER: 'a[href*="settings/browser-control"]',
  SETTINGS_NAV_TOOLBAR: 'a[href*="settings/toolbar"]',

  // ==================== MCP Management ====================
  MCP_ADD_SERVER_BUTTON: 'button:has-text("Add")',
  MCP_LIBRARY: 'a[href*="mcp-library"]',

  // ==================== Common UI ====================
  DIALOG_OVERLAY: '[role="dialog"]',
  DIALOG_CONFIRM:
    'button:has-text("Confirm"), button:has-text("OK"), button:has-text("Yes")',
  DIALOG_CANCEL:
    'button:has-text("Cancel"), button:has-text("No"), button:has-text("Close")',
} as const;
