import React, { useState, useEffect } from 'react';
import {
  StartupValidationResult,
  ValidationStage,
  ValidationStatus,
  StartupAction
} from '../../types/startupValidationTypes';
import { performTwoStageValidation } from '../../lib/startup/startupValidation';
import '../../styles/StartupPage.css';
import { APP_NAME, BRAND_NAME } from '@shared/constants/branding';

let appIcon: string;
try {
  const iconModule = require(`../../assets/${BRAND_NAME}/app.svg`);
  appIcon = iconModule.default || iconModule;
} catch (error) {
  console.error(`Failed to load app icon for brand ${BRAND_NAME}:`, error);
  appIcon = '';
}

interface StartupPageProps {
  onComplete: (result: StartupValidationResult) => void;
}

interface ValidationStep {
  id: string;
  stage: ValidationStage;
  label: string;
  completed: boolean;
  inProgress: boolean;
  error?: string;
}

export const StartupPage: React.FC<StartupPageProps> = ({ onComplete }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [showBrand, setShowBrand] = useState(false);
  const [validationResult, setValidationResult] = useState<StartupValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  const validationSteps: ValidationStep[] = [
    {
      id: 'stage1',
      stage: ValidationStage.STAGE_1,
      label: 'Scanning local profiles...',
      completed: false,
      inProgress: false
    },
  ];

  const [steps, setSteps] = useState(validationSteps);

  useEffect(() => {
    // Get app version
    const getAppVersion = async () => {
      try {
        const version = await window.electronAPI.getVersion();
        setAppVersion(version);
      } catch (error) {
        setAppVersion('Unknown');
      }
    };

    getAppVersion();

    // Show brand animation first
    const brandTimer = setTimeout(() => {
      setShowBrand(true);
    }, 300);

    // Start validation sequence after brand is shown
    // Optimized: reduced from 1500ms to 800ms
    const validationTimer = setTimeout(() => {
      performStartupValidation();
    }, 800);

    return () => {
      clearTimeout(brandTimer);
      clearTimeout(validationTimer);
    };
  }, []);

  const performStartupValidation = async () => {
    const startTime = Date.now();
    const logWithTime = (msg: string, ...args: any[]) => {
      const elapsed = Date.now() - startTime;
    };

    try {
      logWithTime('🚀 Starting startup validation...');

      // Start profile scanning with visual feedback
      logWithTime('📝 Setting step to inProgress...');
      setSteps(prev => prev.map((step, index) =>
        index === 0 ? { ...step, inProgress: true } : step
      ));
      setCurrentStepIndex(0);
      logWithTime('✓ Step state updated to inProgress');
      
      // Add minimum delay to show progress animation
      // Optimized: reduced from 800ms to 400ms
      logWithTime('⏱️ Waiting 400ms for progress animation...');
      await new Promise(resolve => setTimeout(resolve, 400));
      logWithTime('✓ Progress animation delay completed');
      
      // Execute validation
      logWithTime('🔍 Executing performTwoStageValidation()...');
      const validationStartTime = Date.now();
      const result = await performTwoStageValidation();
      const validationDuration = Date.now() - validationStartTime;
      logWithTime(`✓ Validation completed in ${validationDuration}ms`, result);
      
      // Add delay to show validation in progress
      // Optimized: reduced from 600ms to 300ms
      logWithTime('⏱️ Waiting 300ms to show validation in progress...');
      await new Promise(resolve => setTimeout(resolve, 300));
      logWithTime('✓ Validation progress delay completed');
      
      // Update completion status with dynamic label showing found profiles
      const totalProfiles = result.stage2.totalProfiles || 0;
      const finalLabel = totalProfiles > 0
        ? `Scanning local profiles. Found ${totalProfiles} valid profiles`
        : 'Scanning local profiles. No profiles found';
      
      logWithTime('📊 Updating step to completed=true...');
      setSteps(prev => prev.map((step, index) =>
        index === 0 ? {
          ...step,
          inProgress: false,
          completed: true,
          label: finalLabel,
          error: result.stage2.status === ValidationStatus.ERROR ? result.stage2.error : undefined
        } : step
      ));
      logWithTime('✓ Step state updated to completed=true');
      logWithTime('🎯 Progress should now be 100% (1/1 steps completed)');
      
      // Add delay to show completion animation
      // Optimized: reduced from 400ms to 200ms
      logWithTime('⏱️ Waiting 200ms for completion animation...');
      await new Promise(resolve => setTimeout(resolve, 200));
      logWithTime('✓ Completion animation delay completed');
      
      // Save validation result
      logWithTime('💾 Saving validation result...');
      setValidationResult(result);
      logWithTime('✓ Validation result saved');
      
      // All steps completed
      logWithTime('🏁 Setting isCompleted=true...');
      setIsCompleted(true);
      logWithTime('✓ isCompleted flag set to true');
      
      logWithTime('✅ Startup validation completed, recommended action:', result.recommendedAction);

      // Add final delay before completion to show final state
      // Optimized: increased from 500ms to 800ms to ensure user sees 100% progress
      logWithTime('⏱️ ⭐ CRITICAL: Waiting 800ms to ensure user sees 100% progress bar...');
      await new Promise(resolve => setTimeout(resolve, 800));
      logWithTime('✓ ⭐ Final display delay completed - user should have seen 100%');
      
      // Complete with proper timing
      logWithTime('🎬 Calling onComplete() to trigger page transition...');
      onComplete(result);
      logWithTime('✓ onComplete() called - page should transition now');
      
    } catch (error) {

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setValidationError(errorMessage);
      
      // Update step to show error
      setSteps(prev => prev.map((step, index) =>
        index === 0 ? {
          ...step,
          inProgress: false,
          completed: false,
          error: errorMessage
        } : step
      ));
      
      // Create error result
      const errorResult: StartupValidationResult = {
        stage1: {
          status: ValidationStatus.SUCCESS,
          stage: ValidationStage.STAGE_1,
          timestamp: Date.now(),
          hasLocalStorageSession: false,
          sessionValid: false
        },
        stage2: {
          status: ValidationStatus.ERROR,
          stage: ValidationStage.STAGE_2,
          timestamp: Date.now(),
          totalProfiles: 0,
          validUsers: [],
          expiredUsers: [],
          invalidUsers: [],
          authManagerInitialized: false,
          authManagerProfiles: [],
          skippedDueToValidSession: false,
          error: errorMessage
        },
        recommendedAction: StartupAction.SHOW_ERROR,
        totalDuration: 0,
        completedAt: Date.now()
      };
      
      setValidationResult(errorResult);
      setIsCompleted(true);
      
      // Complete immediately without delay
      onComplete(errorResult);
    }
  };

  const completedSteps = steps.filter(step => step.completed).length;
  const progressPercentage = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;
  
  // Debug: Log progress changes
  React.useEffect(() => {
  }, [progressPercentage, isCompleted]);

  return (
    <div className="startup-page">
      {/* Main content */}
      <div className="startup-content">
        {/* Logo */}
        <div className="startup-logo-container">
          <img 
            src={appIcon} 
            alt={APP_NAME} 
            width="128" 
            height="128" 
          />
        </div>

        {/* Progress bar */}
        <div className="startup-progress-bar">
          <div className="startup-progress-fill" style={{ width: `${progressPercentage}%` }} />
        </div>
      </div>
    </div>
  );
};