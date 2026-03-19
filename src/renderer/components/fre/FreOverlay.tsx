import React, { useState, useEffect } from 'react';
import FreWelcomeView, { FrePromotedAgent } from './FreWelcomeView';
import FreSettingUpView, { SetupFlowType } from './FreSettingUpView';

interface FreOverlayProps {
  onSkip: () => void;
}

// FRE View types
type FreView = 'welcome' | 'setup';

/**
 * FRE (First Run Experience) Overlay Component
 * Coordinator component that manages view switching between Welcome and Setting Up views
 * 
 * 1. Shows Welcome View first (agent selection)
 * 2. Then shows Setting Up View
 * 3. Completes FRE
 */
const FreOverlay: React.FC<FreOverlayProps> = ({ onSkip }) => {
  // Start with welcome view
  const [currentView, setCurrentView] = useState<FreView>('welcome');
  
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
   * Sets the setup flow type based on selected agent and transitions to setup view
   */
  const handleSelectAgent = (agent: FrePromotedAgent) => {
    console.log('[FRE] Agent selected from Welcome View:', agent.name);
    setSelectedAgent(agent);
    
    // Determine setup flow type based on agent name
    const agentNameLower = agent.name.toLowerCase();
    if (agentNameLower.includes('design')) {
      setSetupFlowType('design-agent');
    } else {
      // Default flow for promoted agents
      setSetupFlowType('pm-agent');
    }
    
    // Transition to setup view
    setCurrentView('setup');
  };

  /**
   * Handle skip from Welcome View
   * Sets basic setup flow and transitions to setup view
   */
  const handleSkipWelcome = () => {
    console.log('[FRE] User skipped Welcome View, starting basic setup');
    setSelectedAgent(null);
    setSetupFlowType('basic');
    setCurrentView('setup');
  };

  /**
   * Handle setup completion from Setting Up View
   * Complete FRE (freDone already set in FreSettingUpView)
   */
  const handleSetupComplete = () => {
    console.log('[FRE] Setup complete, closing FRE overlay');
    onSkip();
  };

  // Render Welcome View first
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
