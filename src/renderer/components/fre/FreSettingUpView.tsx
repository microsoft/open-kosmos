import React, { useState, useEffect, useRef } from 'react';
import { APP_NAME, BRAND_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import { profileDataManager } from '@renderer/lib/userData';
import { FrePromotedAgent } from './FreWelcomeView';

// Windows title bar height constant (must match WindowsTitleBar.css)
const WINDOWS_TITLE_BAR_HEIGHT = 40;

// Get display name from BRAND_CONFIG, fallback to APP_NAME
const getDisplayName = () => BRAND_CONFIG?.windowTitle || BRAND_CONFIG?.shortcutName || APP_NAME;

// Helper to check if version string meets criteria (>= 3.10.0)
const isVersionCompatible = (versionStr: string): boolean => {
  try {
    const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return false;
    const [_, major, minor] = match.map(Number);
    if (major > 3) return true;
    if (major < 3) return false;
    return minor >= 10;
  } catch (e) {
    return false;
  }
};

// Setup flow types based on agent selection
export type SetupFlowType = 'basic' | 'pm-agent' | 'design-agent';

type SetupStep = 'bun' | 'uv' | 'python' | 'builtin-assets' | 'mcp-server' | 'skills' | 'agent' | 'done';

import { BUILTIN_SKILL_NAMES } from '../../../shared/constants/builtinSkills';

/**
 * Built-in skills that must be installed during FRE.
 * These are installed as a common step for all setup flows (basic/pm-agent/design-agent).
 */
const BUILTIN_SKILLS: string[] = BUILTIN_SKILL_NAMES;

interface SetupStatus {
  step: SetupStep;
  message: string;
  progress: number;
  error?: string;
}

export interface FreSettingUpViewProps {
  setupFlowType: SetupFlowType;
  selectedAgent: FrePromotedAgent | null;
  onSkip: () => void;
  /** Called when setup completes successfully */
  onSetupComplete?: () => void;
  isWindows: boolean;
}

/**
 * FRE Setting Up View Component
 * Handles the runtime environment setup process
 */
const FreSettingUpView: React.FC<FreSettingUpViewProps> = ({
  setupFlowType,
  selectedAgent,
  onSkip,
  onSetupComplete,
  isWindows,
}) => {
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>({
    step: 'bun',
    message: 'Preparing...',
    progress: 0,
  });
  
  // Use ref to prevent double invocation in React Strict Mode
  const setupStartedRef = useRef(false);

  // Auto-start setup when component mounts
  useEffect(() => {
    if (setupStartedRef.current) {
      console.log('[FRE][SettingUp] Setup already started, skipping duplicate invocation');
      return;
    }
    setupStartedRef.current = true;
    startSetup();
  }, []);

  const startSetup = async () => {
    const setupStartTime = Date.now();
    console.log('[FRE][SettingUp] Starting setup process...', { setupFlowType, selectedAgent: selectedAgent?.name });
    setIsSettingUp(true);

    try {
      // Pre-Step: Check Status
      const status = await window.electronAPI.runtime.checkStatus();
      console.log('[FRE][SettingUp] Step 0: Initial runtime status', status);

      // Step 1: Set runtime mode to internal and install Bun (15%)
      console.log('[FRE][SettingUp] Step 1: Setting runtime mode to internal...');
      setSetupStatus({
        step: 'bun',
        message: 'Configuring runtime environment...',
        progress: 5,
      });
      await window.electronAPI.runtime.setMode('internal');
      console.log('[FRE][SettingUp] Step 1: Runtime mode set to internal');
      
      // Now install Bun
      console.log('[FRE][SettingUp] Step 1: Checking/Installing Bun...');
      const bunStartTime = Date.now();
      
      if (status.bun) {
        setSetupStatus({
          step: 'bun',
          message: 'Bun is already installed, verifying...',
          progress: 20,
        });
        console.log(`[FRE][SettingUp] Step 1: Bun already installed at ${status.bunPath}, skipping install.`);
      } else {
        setSetupStatus({
          step: 'bun',
          message: 'Installing Bun (Node.js/npx Replacement) v1.3.6...',
          progress: 10,
        });
        await window.electronAPI.runtime.install('bun', '1.3.6');
        console.log(`[FRE][SettingUp] Step 1: Bun installed in ${Date.now() - bunStartTime}ms`);
      }

      // Step 2: Install uv (30%)
      console.log('[FRE][SettingUp] Step 2: Checking/Installing uv...');
      const uvStartTime = Date.now();
      
      if (status.uv) {
        setSetupStatus({
          step: 'uv',
          message: 'uv is already installed, verifying...',
          progress: 35,
        });
        console.log(`[FRE][SettingUp] Step 2: uv already installed at ${status.uvPath}, skipping install.`);
      } else {
        setSetupStatus({
          step: 'uv',
          message: 'Installing uv (Python Manager) v0.6.17...',
          progress: 25,
        });
        await window.electronAPI.runtime.install('uv', '0.6.17');
        console.log(`[FRE][SettingUp] Step 2: uv installed in ${Date.now() - uvStartTime}ms`);
      }

      // Step 3: Install Python via uv and set as default (50%)
      console.log('[FRE][SettingUp] Step 3: Setting up Python (Checking local versions >= 3.10.0)...');
      const pythonStartTime = Date.now();
      
      setSetupStatus({
        step: 'python',
        message: 'Checking for existing Python...',
        progress: 35,
      });

      let compatiblePython = null;
      try {
        const scanStartTime = Date.now();
        const versions = await window.electronAPI.runtime.listPythonVersionsFast();
        const scanDuration = Date.now() - scanStartTime;
        console.log(`[FRE][SettingUp] Step 3: Fast Python scan completed in ${scanDuration}ms, found ${versions.length} versions:`, versions);
        
        const installed = versions.filter((v) => v.status === 'installed' && isVersionCompatible(v.semver || v.version));
        
        if (installed.length > 0) {
           compatiblePython = installed[0];
        }
      } catch (err) {
        console.warn('[FRE][SettingUp] Step 3: Failed to check local python versions:', err);
      }

      if (compatiblePython) {
          console.log(`[FRE][SettingUp] Step 3: Found compatible local Python: ${compatiblePython.version} at ${compatiblePython.path}`);
          setSetupStatus({
            step: 'python',
            message: `Using existing Python ${compatiblePython.semver || compatiblePython.version}...`,
            progress: 45,
          });
          
          const pinTarget = compatiblePython.version;
          await window.electronAPI.runtime.setPinnedPythonVersion(pinTarget);
          console.log('[FRE][SettingUp] Step 3: Pinned local Python successfully.');
      } else {
          setSetupStatus({
            step: 'python',
            message: 'Installing Python 3.10.12...',
            progress: 40,
          });

          console.log('[FRE][SettingUp] Step 3a: No compatible local Python found. Installing Python 3.10.12...');
          await window.electronAPI.runtime.installPythonVersion('3.10.12');
          console.log(`[FRE][SettingUp] Step 3a: Python 3.10.12 installation completed in ${Date.now() - pythonStartTime}ms`);
          
          console.log('[FRE][SettingUp] Step 3b: Setting pinned Python version to 3.10.12...');
          const pinStartTime = Date.now();
          await window.electronAPI.runtime.setPinnedPythonVersion('3.10.12');
          console.log(`[FRE][SettingUp] Step 3b: Python version pinned in ${Date.now() - pinStartTime}ms`);
      }
      
      console.log(`[FRE][SettingUp] Step 3: Total Python setup completed in ${Date.now() - pythonStartTime}ms`);

      // Step 3.6: Install built-in assets (common step for ALL flows)
      console.log('[FRE][SettingUp] Step 3.6: Installing built-in assets...');
      const builtinAssetsStartTime = Date.now();
      setSetupStatus({
        step: 'builtin-assets',
        message: 'Installing built-in skills...',
        progress: 50,
      });

      await installBuiltinAssets();
      console.log(`[FRE][SettingUp] Step 3.6: Built-in assets installation completed in ${Date.now() - builtinAssetsStartTime}ms`);

      // Steps 4-6 depend on setupFlowType
      let agentResult: { chatId?: string; chatSessionId?: string } = { chatId: '', chatSessionId: '' };
      
      const needsAgentSetup = setupFlowType === 'pm-agent' || setupFlowType === 'design-agent';
      
      if (needsAgentSetup) {
        const agentName = setupFlowType === 'pm-agent' ? 'PM Agent' : 'Design Agent';
        console.log(`[FRE][SettingUp] Step 4: Fetching ${agentName} config and installing MCP Servers...`);
        const mcpStartTime = Date.now();
        setSetupStatus({
          step: 'mcp-server',
          message: 'Installing MCP Servers...',
          progress: 55,
        });

        let agentLibConfig = selectedAgent;
        if (!agentLibConfig) {
          agentLibConfig = await fetchAgentConfigByName(agentName);
        }
        
        if (!agentLibConfig) {
          throw new Error(`Failed to fetch ${agentName} configuration`);
        }

        await installRequiredMcpServers(agentLibConfig);
        console.log(`[FRE][SettingUp] Step 4: MCP Servers installation completed in ${Date.now() - mcpStartTime}ms`);

        // Step 5: Install required Skills (75%)
        console.log('[FRE][SettingUp] Step 5: Installing required Skills...');
        const skillsStartTime = Date.now();
        setSetupStatus({
          step: 'skills',
          message: 'Installing Skills...',
          progress: 70,
        });

        await installRequiredSkills(agentLibConfig);
        console.log(`[FRE][SettingUp] Step 5: Skills installation completed in ${Date.now() - skillsStartTime}ms`);

        // Step 6: Install the Agent (80%)
        console.log(`[FRE][SettingUp] Step 6: Starting ${agentName} installation...`);
        const agentStartTime = Date.now();
        setSetupStatus({
          step: 'agent',
          message: `Installing ${agentName}...`,
          progress: 75,
        });

        agentResult = await installAgentFromConfig(agentLibConfig);
        console.log(`[FRE][SettingUp] Step 6: ${agentName} installation completed in ${Date.now() - agentStartTime}ms`);
        
        console.log('[FRE][SettingUp] Step 7: Selecting installed agent as primary...');
        agentResult = await selectPrimaryAgentForKosmos();
        console.log('[FRE][SettingUp] Step 7b: Primary agent selected:', agentResult);
      } else {
        console.log('[FRE][SettingUp] Steps 4-7: Skipping MCP/Skills/Agent installation (basic setup)');
        
        console.log('[FRE][SettingUp] Step 4 (Basic): Selecting primary agent...');
        setSetupStatus({
          step: 'done',
          message: 'Selecting primary agent...',
          progress: 90,
        });
        agentResult = await selectPrimaryAgentForKosmos();
        console.log('[FRE][SettingUp] Step 4 (Basic): Primary agent selected:', agentResult);
      }

      // Step 8: Complete (100%)
      console.log('[FRE][SettingUp] Step 8: Setup completing...');
      setSetupStatus({
        step: 'done',
        message: 'Setup complete! Starting ' + getDisplayName() + '...',
        progress: 100,
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update freDone to complete FRE
      console.log('[FRE][SettingUp] Step 8: Marking FRE as done...');
      const userAlias = profileDataManager.getCurrentUserAlias();
      if (userAlias && window.electronAPI?.profile?.updateFreDone) {
        await window.electronAPI.profile.updateFreDone(userAlias, true);
        console.log('[FRE][SettingUp] Step 8: FRE done flag set for user:', userAlias);
      } else {
        console.warn('[FRE][SettingUp] Step 8: Could not set FRE done flag - userAlias or API missing', { userAlias });
      }
      
      // Call onSetupComplete to finalize
      if (onSetupComplete) {
        onSetupComplete();
      }

      const totalDuration = Date.now() - setupStartTime;
      console.log(`[FRE][SettingUp] Setup process completed successfully in ${totalDuration}ms`);

    } catch (error) {
      const totalDuration = Date.now() - setupStartTime;
      console.error('[FRE][SettingUp] Runtime setup failed:', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        currentStep: setupStatus.step,
        totalDuration
      });
      setSetupStatus({
        step: setupStatus.step,
        message: 'Setup failed. Please try again.',
        progress: setupStatus.progress,
        error: error instanceof Error ? error.message : String(error),
      });
      setIsSettingUp(false);
    }
  };

  /**
   * Fetch agent configuration by name (CDN library removed - returns null)
   */
  const fetchAgentConfigByName = async (agentName: string): Promise<any | null> => {
    console.log(`[FRE][SettingUp] Agent library not available (CDN removed), skipping ${agentName} config fetch`);
    return null;
  };

  /**
   * Install required MCP Servers from agent config (CDN library removed - skipped)
   */
  const installRequiredMcpServers = async (agentConfig: any) => {
    console.log('[FRE][SettingUp] MCP library not available (CDN removed), skipping MCP installation');
  };

  /**
   * Install required Skills from agent config (CDN library removed - skipped)
   */
  const installRequiredSkills = async (agentConfig: any) => {
    console.log('[FRE][SettingUp] Skill library not available (CDN removed), skipping skill installation');
  };

  /**
   * Install built-in assets (CDN library removed - skipped)
   */
  const installBuiltinAssets = async () => {
    console.log('[FRE][SettingUp] Skill library not available (CDN removed), skipping built-in assets installation');
  };

  /**
   * Install agent from config
   */
  const installAgentFromConfig = async (agentLibConfig: any): Promise<{ chatId?: string; chatSessionId?: string }> => {
    const agentName = agentLibConfig.configuration?.name || agentLibConfig.name;
    console.log(`[FRE][SettingUp] Starting ${agentName} installation...`);
    const startTime = Date.now();
    
    try {
      const configuration = agentLibConfig.configuration || {};

      let workspace = configuration.workspace || '';
      if (workspace.includes('@KOSMOS_')) {
        const placeholderResult = await window.electronAPI.kosmos.replacePlaceholders({ workspace });
        if (placeholderResult.success && placeholderResult.data) {
          workspace = placeholderResult.data.workspace || workspace;
        }
      }

      const agentConfig = {
        name: configuration.name || agentLibConfig.name,
        emoji: configuration.emoji || '🤖',
        avatar: configuration.avatar || '',
        model: configuration.model || 'claude-sonnet-4',
        mcp_servers: configuration.mcp_servers || [],
        system_prompt: configuration.system_prompt || '',
        context_enhancement: configuration.context_enhancement,
        skills: configuration.skills || [],
        workspace: workspace,
        version: agentLibConfig.version || '1.0.0',
        zero_states: configuration.zero_states,
      };

      const result = await window.electronAPI.builtinTools.execute('add_agent_by_config', agentConfig);
      
      let resultData = result.data;
      if (typeof resultData === 'string') {
        try { resultData = JSON.parse(resultData); } catch (e) { /* ignore */ }
      }

      // Check both outer IPC success AND inner tool result success
      const toolSuccess = result.success && (resultData?.success !== false);
      if (!toolSuccess) {
        const errorMsg = result.error || resultData?.error || resultData?.message || '';
        if (errorMsg.includes('already exists')) {
          console.log(`[FRE][SettingUp] ${agentName} already installed, skipping...`);
          return await setAgentAsPrimaryAndSwitch(agentConfig.name);
        }
        throw new Error(result.error || resultData?.error || resultData?.message || `Failed to install ${agentName}`);
      }

      const chatId = resultData?.chat_id;
      console.log(`[FRE][SettingUp] ${agentName} installed successfully in ${Date.now() - startTime}ms`);

      return await setAgentAsPrimaryAndSwitch(agentConfig.name, chatId);
    } catch (error) {
      console.error(`[FRE][SettingUp] Failed to install ${agentName}:`, error);
      return {};
    }
  };

  /**
   * Set agent as Primary Agent and switch to it
   */
  const setAgentAsPrimaryAndSwitch = async (agentName: string, chatId?: string): Promise<{ chatId?: string; chatSessionId?: string }> => {
    console.log('[FRE][SettingUp] Setting agent as Primary Agent and switching:', agentName);
    try {
      const result = await window.electronAPI.profile.setPrimaryAgent(agentName);
      if (result?.success) {
        console.log('[FRE][SettingUp] Agent set as Primary Agent successfully');
      } else {
        console.warn('[FRE][SettingUp] Failed to set agent as Primary Agent:', result?.error);
      }

      let targetChatId = chatId;
      if (!targetChatId) {
        const agentsResult = await window.electronAPI.builtinTools.execute('get_all_agents', {});
        if (agentsResult.success) {
          let agents = agentsResult.data;
          if (typeof agents === 'string') {
            try { agents = JSON.parse(agents); } catch (e) { /* ignore */ }
          }
          if (agents?.agents) {
            const targetAgent = agents.agents.find((a: any) => a.name === agentName);
            if (targetAgent?.chat_id) {
              targetChatId = targetAgent.chat_id;
            }
          }
        }
      }

      if (targetChatId) {
        const switchResult = await window.electronAPI.agentChat.startNewChatFor(targetChatId);
        if (switchResult?.success) {
          return { chatId: targetChatId, chatSessionId: switchResult.chatSessionId };
        }
      }
      return {};
    } catch (error) {
      console.error('[FRE][SettingUp] Error setting agent as Primary Agent:', error);
      return {};
    }
  };

  /**
   * Select primary agent for Kosmos
   */
  const selectPrimaryAgentForKosmos = async (): Promise<{ chatId?: string; chatSessionId?: string }> => {
    console.log('[FRE][SettingUp] Starting primary agent selection...');
    
    try {
      const profile = profileDataManager.getProfile();
      if (!profile) {
        console.warn('[FRE][SettingUp] No profile found, skipping primary agent selection');
        return {};
      }
      
      const primaryAgentName = (profile as any).primaryAgent || 'Kobi';
      const chats = (profile as any).chats || [];
      
      if (chats.length === 0) {
        console.warn('[FRE][SettingUp] No chats found in profile');
        return {};
      }
      
      const primaryChat = chats.find((chat: any) => chat.agent?.name === primaryAgentName);
      
      let targetChatId: string | undefined;
      
      if (primaryChat?.chat_id) {
        targetChatId = primaryChat.chat_id;
      } else {
        const firstChat = chats[0];
        if (firstChat?.chat_id) {
          targetChatId = firstChat.chat_id;
        }
      }
      
      if (!targetChatId) {
        return {};
      }
      
      const switchResult = await window.electronAPI.agentChat.startNewChatFor(targetChatId);
      if (switchResult?.success) {
        return { chatId: targetChatId, chatSessionId: switchResult.chatSessionId };
      }
      return { chatId: targetChatId };
    } catch (error) {
      console.error('[FRE][SettingUp] Failed to select primary agent:', error);
      return {};
    }
  };

  const handleRetry = () => {
    console.log('[FRE][SettingUp] User triggered retry...');
    setupStartedRef.current = false;
    setSetupStatus({
      step: 'bun',
      message: 'Preparing...',
      progress: 0,
    });
    startSetup();
  };

  const handleSkipSetup = async () => {
    const userAlias = profileDataManager.getCurrentUserAlias();
    if (userAlias && window.electronAPI?.profile?.updateFreDone) {
      await window.electronAPI.profile.updateFreDone(userAlias, true);
    }
    onSkip();
  };

  // Define setup steps with labels based on setupFlowType
  const getSetupSteps = () => {
    const basicSteps = [
      { step: 'bun', label: 'Installing Bun' },
      { step: 'uv', label: 'Installing uv' },
      { step: 'python', label: 'Installing Python' },
    ];

    // Built-in assets step (common for all flows)
    const builtinAssetsStep = [
      { step: 'builtin-assets', label: 'Installing Built-in Skills' },
    ];
    
    if (setupFlowType === 'pm-agent') {
      return [
        ...basicSteps,
        ...builtinAssetsStep,
        { step: 'mcp-server', label: 'Installing MCP Servers' },
        { step: 'skills', label: 'Installing Skills' },
        { step: 'agent', label: 'Installing PM Agent' },
      ];
    } else if (setupFlowType === 'design-agent') {
      return [
        ...basicSteps,
        ...builtinAssetsStep,
        { step: 'mcp-server', label: 'Installing MCP Servers' },
        { step: 'skills', label: 'Installing Skills' },
        { step: 'agent', label: 'Installing Design Agent' },
      ];
    }
    
    // Basic flow
    return [
      ...basicSteps,
      ...builtinAssetsStep,
    ];
  };
  
  const setupSteps = getSetupSteps();
  const currentStepIndex = setupSteps.findIndex(s => s.step === setupStatus.step);
  const totalSteps = setupSteps.length;
  const displayStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : totalSteps;
  const currentStepLabel = setupSteps.find(s => s.step === setupStatus.step)?.label || 'Completing setup...';

  // Track previous step for animation
  const [displayedStep, setDisplayedStep] = useState(currentStepLabel);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevStepRef = useRef(currentStepLabel);

  useEffect(() => {
    if (prevStepRef.current !== currentStepLabel) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayedStep(currentStepLabel);
        prevStepRef.current = currentStepLabel;
        setTimeout(() => setIsAnimating(false), 300);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [currentStepLabel]);

  return (
    <div
      style={{
        position: 'fixed',
        top: isWindows ? WINDOWS_TITLE_BAR_HEIGHT : 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(135deg, rgba(255, 251, 248, 0.98) 0%, rgba(255, 255, 255, 0.98) 50%, rgba(248, 244, 241, 0.98) 100%)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      {/* CSS for animations */}
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes slideOutUp {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(-20px); }
          }
          @keyframes slideInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
      
      {/* Main Content Container */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '64px',
        width: '766px',
        maxWidth: '90vw',
        animation: 'fadeIn 0.6s ease-out',
      }}>
        {/* Top Section: Title + Subtitle + Progress */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '32px',
          width: '100%',
        }}>
          {/* Title and Subtitle */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
          }}>
            <h1 style={{
              fontFamily: "'Abhaya Libre', Georgia, serif",
              fontStyle: 'normal',
              fontWeight: 700,
              fontSize: '28px',
              lineHeight: '33px',
              textAlign: 'center',
              color: '#322D29',
              margin: 0,
            }}>
              Setting up
            </h1>
            
            <p style={{
              fontFamily: "'Abhaya Libre', Georgia, serif",
              fontStyle: 'normal',
              fontWeight: 400,
              fontSize: '20px',
              lineHeight: '24px',
              textAlign: 'center',
              color: '#322D29',
              margin: 0,
              maxWidth: '770px',
            }}>
              {getDisplayName()} is preparing the environment for your first run ...
            </p>
          </div>

          {/* Progress Section */}
          {isSettingUp && !setupStatus.error && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              width: '100%',
              maxWidth: '500px',
            }}>
              {/* Progress Bar */}
              <div style={{
                width: '100%',
                height: '6px',
                background: '#F8F4F1',
                borderRadius: '3px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #0ea5e9, #06b6d4)',
                  borderRadius: '3px',
                  width: `${setupStatus.progress}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
              
              {/* Step Counter and Current Step Label */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                height: '24px',
                overflow: 'hidden',
              }}>
                <span style={{
                  fontFamily: "'Abhaya Libre', Georgia, serif",
                  fontWeight: 500,
                  fontSize: '14px',
                  color: '#6b7280',
                  minWidth: '32px',
                }}>
                  {displayStepNumber}/{totalSteps}
                </span>
                
                <div style={{
                  position: 'relative',
                  overflow: 'hidden',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontFamily: "'Abhaya Libre', Georgia, serif",
                    fontWeight: 500,
                    fontSize: '14px',
                    color: '#0ea5e9',
                    animation: isAnimating 
                      ? (displayedStep === currentStepLabel ? 'slideInUp 0.3s ease-out' : 'slideOutUp 0.3s ease-out')
                      : 'none',
                    whiteSpace: 'nowrap',
                  }}>
                    {displayedStep}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error State */}
          {setupStatus.error && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
            }}>
              <div style={{
                fontSize: '14px',
                color: '#ef4444',
                padding: '12px 20px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '8px',
                maxWidth: '500px',
                textAlign: 'center',
                wordBreak: 'break-word',
              }}>
                {setupStatus.error}
              </div>
              
              <button
                onClick={handleRetry}
                style={{
                  padding: '10px 24px',
                  background: '#0ea5e9',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#0284c7';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#0ea5e9';
                }}
              >
                Retry Setup
              </button>
            </div>
          )}
        </div>

        {/* Decorative Image Card */}
        <div style={{
          boxSizing: 'border-box',
          width: '332px',
          height: '224px',
          background: '#FFFFFF',
          border: '0.5px solid rgba(0, 0, 0, 0.1)',
          borderRadius: '32px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            boxSizing: 'border-box',
            position: 'absolute',
            width: '208px',
            height: '208px',
            right: '8px',
            top: '8px',
            background: '#FFFBF8',
            border: '0.5px solid rgba(0, 0, 0, 0.1)',
            borderRadius: '26px',
          }} />
          
          <div style={{
            position: 'absolute',
            left: '20px',
            top: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ width: '80px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
            <div style={{ width: '44px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
          </div>
          
          <div style={{
            position: 'absolute',
            left: '20px',
            top: '120px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ width: '69px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
            <div style={{ width: '69px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
            <div style={{ width: '44px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
            <div style={{ width: '44px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
          </div>
          
          <div style={{
            position: 'absolute',
            left: '20px',
            top: '184px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <div style={{ width: '12px', height: '12px', background: '#F8F4F1', borderRadius: '50%' }} />
            <div style={{ width: '56px', height: '6px', background: '#F8F4F1', borderRadius: '3px' }} />
          </div>
        </div>
      </div>
      
      {/* Skip Button - Bottom Right (only shown on error) */}
      {setupStatus.error && (
        <div style={{
          position: 'absolute',
          bottom: '32px',
          right: '32px',
        }}>
          <button
            onClick={handleSkipSetup}
            style={{
              padding: '10px 20px',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(203, 213, 225, 0.8)',
              borderRadius: '8px',
              color: '#525252',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 1)';
              e.currentTarget.style.borderColor = 'rgba(203, 213, 225, 1)';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
              e.currentTarget.style.borderColor = 'rgba(203, 213, 225, 0.8)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
            }}
          >
            Skip Setup
          </button>
        </div>
      )}
    </div>
  );
};

export default FreSettingUpView;
