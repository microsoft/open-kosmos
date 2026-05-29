import React, { useState, useEffect } from 'react';
import FreWelcomeView, { FrePromotedAgent } from './FreWelcomeView';
import FreSettingUpView, { SetupFlowType } from './FreSettingUpView';
import { isCdnConfigured } from '@shared/utils/cdn';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[FreOverlay]');

interface FreOverlayProps {
  onSkip: () => void;
}

// FRE View types
type FreView = 'welcome' | 'setup';

/**
 * FRE (First Run Experience) Overlay Component
 * Coordinator component that manages view switching between Welcome and Setting Up views
 *
 * For OpenKosmos brand:
 *   1. Shows Welcome View first (agent selection)
 *   2. Then shows Setting Up View
 *   3. Completes FRE
 */
const FreOverlay: React.FC<FreOverlayProps> = ({ onSkip }) => {
  // The Welcome View only exists to present CDN-backed promoted agents. When no
  // CDN is configured there can never be any promoted agents, so skip the
  // Welcome View entirely and go straight to basic setup — avoids showing an
  // empty "No agents available" screen the user has to dismiss manually.
  const welcomeAvailable = isCdnConfigured();
  const [currentView, setCurrentView] = useState<FreView>(
    welcomeAvailable ? 'welcome' : 'setup'
  );

  // Selected agent from welcome view (null = skip/basic setup)
  const [selectedAgent, setSelectedAgent] = useState<FrePromotedAgent | null>(null);

  // Setup flow type based on selection
  const [setupFlowType, setSetupFlowType] = useState<SetupFlowType>('basic');

  // State to track if we're on Windows (for title bar height)
  const [isWindows, setIsWindows] = useState(false);

  // Check platform on mount
  useEffect(() => {
    const checkPlatform = async () => {
      if (window.electronAPI && window.electronAPI.platform === 'win32') {
        setIsWindows(true);
      } else {
        try {
          const info = await window.electronAPI.getPlatformInfo();
          if (info.platform === 'win32') {
            setIsWindows(true);
          }
        } catch (e) {
          // Ignore - assume not Windows
        }
      }
    };
    checkPlatform();
  }, []);

  /**
   * Handle agent selection from Welcome View
   * Transitions to the setup view with the selected agent
   */
  const handleSelectAgent = (agent: FrePromotedAgent) => {
    logger.debug('[FRE] Agent selected from Welcome View:', agent.name);
    setSelectedAgent(agent);

    // Determine setup flow type based on agent name
    const agentNameLower = agent.name.toLowerCase();
    if (agentNameLower.includes('design')) {
      setSetupFlowType('basic');
    } else if (!agentNameLower.includes('basic')) {
      setSetupFlowType('basic');
    } else {
      setSetupFlowType('basic');
    }

    // Transition to setup view
    setCurrentView('setup');
  };

  /**
   * Handle skip from Welcome View
   * Sets basic setup flow and transitions to setup view
   */
  const handleSkipWelcome = () => {
    logger.debug('[FRE] User skipped Welcome View, starting basic setup');
    setSelectedAgent(null);
    setSetupFlowType('basic');
    setCurrentView('setup');
  };

  /**
   * Handle setup completion from Setting Up View
   * For OpenKosmos: complete FRE (freDone already set in FreSettingUpView)
   */
  const handleSetupComplete = () => {
    logger.debug('[FRE] OpenKosmos setup complete, closing FRE overlay');
    onSkip();
  };

  // Render Welcome View for OpenKosmos brand first
  if (currentView === 'welcome') {
    return (
      <FreWelcomeView
        onSelectAgent={handleSelectAgent}
        onSkip={handleSkipWelcome}
        isWindows={isWindows}
      />
    );
  }

  // Render Setting Up View
  return (
    <FreSettingUpView
      setupFlowType={setupFlowType}
      selectedAgent={selectedAgent}
      onSkip={onSkip}
      onSetupComplete={handleSetupComplete}
      isWindows={isWindows}
    />
  );
};

export default FreOverlay;
