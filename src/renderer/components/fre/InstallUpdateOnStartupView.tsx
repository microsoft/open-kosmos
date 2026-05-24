import React, { useState, useEffect, useRef } from 'react';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[InstallUpdateOnStartupView]');

// Windows title bar height constant (must match WindowsTitleBar.css)
const WINDOWS_TITLE_BAR_HEIGHT = 40;

// Get display name from BRAND_CONFIG, fallback to APP_NAME
const getDisplayName = () => BRAND_CONFIG?.windowTitle || BRAND_CONFIG?.shortcutName || APP_NAME;

type UpdateStep = 'check-models' | 'check-mcp' | 'install-mcp' | 'check-skills' | 'install-skills' | 'check-agents' | 'install-agents' | 'complete';

interface UpdateStatus {
  step: UpdateStep;
  message: string;
  progress: number;
  error?: string;
}

export interface InstallUpdateOnStartupViewProps {
  onComplete: () => void;
  onSkip: () => void;
  isWindows: boolean;
}

/**
 * Install Update On Startup View Component
 * Checks for and installs library updates (MCP, Skills, Agents) at application startup.
 * UI/UX matches FreSettingUpView exactly, but with different execution steps.
 */
const InstallUpdateOnStartupView: React.FC<InstallUpdateOnStartupViewProps> = ({
  onComplete,
  onSkip,
  isWindows,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    step: 'check-mcp',
    message: 'Preparing...',
    progress: 0,
  });

  // Use ref to prevent double invocation in React Strict Mode
  const updateStartedRef = useRef(false);

  // Auto-start update check when component mounts
  useEffect(() => {
    if (updateStartedRef.current) {
      logger.debug('[StartupUpdate][View] Update already started, skipping duplicate invocation');
      return;
    }
    updateStartedRef.current = true;
    startUpdateCheck();
  }, []);

  // Listen for progress events from main process
  useEffect(() => {
    if (!window.electronAPI?.startupUpdate?.onProgress) return;

    const unsubscribe = window.electronAPI.startupUpdate.onProgress((progress) => {
      logger.debug('[StartupUpdate][View] Progress update:', progress);
      setUpdateStatus({
        step: progress.step as UpdateStep,
        message: progress.message,
        progress: progress.progress,
        error: progress.error,
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const startUpdateCheck = async () => {
    const startTime = Date.now();
    logger.debug('[StartupUpdate][View] Starting update check...');
    setIsUpdating(true);

    try {
      setUpdateStatus({
        step: 'check-models',
        message: 'Checking for updates...',
        progress: 1,
      });

      const result = await window.electronAPI.startupUpdate.checkAndInstallUpdates();

      if (!result.success) {
        throw new Error(result.error || 'Update check failed');
      }

      const data = result.data;
      const totalDuration = Date.now() - startTime;

      if (data?.hasUpdates) {
        logger.debug(`[StartupUpdate][View] Updates installed in ${totalDuration}ms:`, {
          mcp: data.updatedMcpCount,
          skills: data.updatedSkillCount,
          agents: data.updatedAgentCount,
        });
      } else {
        logger.debug(`[StartupUpdate][View] No updates needed (${totalDuration}ms)`);
      }

      // Wait briefly to show completion message
      await new Promise(resolve => setTimeout(resolve, 800));

      // Complete
      onComplete();
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      logger.error('[StartupUpdate][View] Update check failed:', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        currentStep: updateStatus.step,
        totalDuration,
      });
      setUpdateStatus({
        step: updateStatus.step,
        message: 'Update check failed.',
        progress: updateStatus.progress,
        error: error instanceof Error ? error.message : String(error),
      });
      setIsUpdating(false);
    }
  };

  const handleRetry = () => {
    logger.debug('[StartupUpdate][View] User triggered retry...');
    updateStartedRef.current = false;
    setUpdateStatus({
      step: 'check-models',
      message: 'Preparing...',
      progress: 0,
    });
    startUpdateCheck();
  };

  const handleSkip = () => {
    logger.debug('[StartupUpdate][View] User skipped update check');
    onSkip();
  };

  // Define update steps with labels
  const updateSteps = [
    { step: 'check-models', label: 'Refreshing Models' },
    { step: 'check-mcp', label: 'Checking MCP Updates' },
    { step: 'install-mcp', label: 'Installing MCP Updates' },
    { step: 'check-skills', label: 'Checking Skill Updates' },
    { step: 'install-skills', label: 'Installing Skill Updates' },
    { step: 'check-agents', label: 'Checking Agent Updates' },
    { step: 'install-agents', label: 'Installing Agent Updates' },
    { step: 'complete', label: 'Complete' },
  ];

  const currentStepIndex = updateSteps.findIndex(s => s.step === updateStatus.step);
  const totalSteps = updateSteps.length;
  const displayStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : totalSteps;
  const currentStepLabel = updateSteps.find(s => s.step === updateStatus.step)?.label || 'Completing...';

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
              Checking for updates
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
              {getDisplayName()} is checking for the latest updates ...
            </p>
          </div>

          {/* Progress Section */}
          {isUpdating && !updateStatus.error && (
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
                  width: `${updateStatus.progress}%`,
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
          {updateStatus.error && (
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
                {updateStatus.error}
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
                Retry
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
      {updateStatus.error && (
        <div style={{
          position: 'absolute',
          bottom: '32px',
          right: '32px',
        }}>
          <button
            onClick={handleSkip}
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
            Skip
          </button>
        </div>
      )}
    </div>
  );
};

export default InstallUpdateOnStartupView;
