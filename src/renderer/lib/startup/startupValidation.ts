// src/renderer/lib/startup/startupValidation.ts
// Startup validation core logic implementation

import {
  ValidationStage,
  ValidationStatus,
  Stage1ValidationResult,
  Stage2ValidationResult,
  StartupValidationResult,
  StartupAction,
  ValidationOptions
} from '../../types/startupValidationTypes';

/**
 * Stage 1: Validate session in localStorage
 * Check if session in AuthManager is valid and verify refresh token
 */
export async function validateLocalStorageSession(): Promise<Stage1ValidationResult> {
  const startTime = Date.now();
  
  try {
    
    // Initialize result object
    const result: Stage1ValidationResult = {
      status: ValidationStatus.FAILED,
      stage: ValidationStage.STAGE_1,
      timestamp: startTime,
      hasLocalStorageSession: false,
      sessionValid: false
    };
    
    // Check ghcSession in localStorage
    const ghcSessionData = localStorage.getItem('ghcSession');
    if (!ghcSessionData) {
      result.duration = Date.now() - startTime;
      return result;
    }
    
    result.hasLocalStorageSession = true;
    
    // Parse session data
    let sessionData;
    try {
      sessionData = JSON.parse(ghcSessionData);
    } catch (parseError) {
      result.error = 'Invalid session data format';
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Basic validation: check required fields
    if (!sessionData.user || !sessionData.refreshToken || !sessionData.expiresAt) {
      result.error = 'Incomplete session data';
      result.duration = Date.now() - startTime;
      return result;
    }
    
    result.sessionData = sessionData;
    
    // Check if token is expired
    const now = Date.now();
    const expiresAt = sessionData.expiresAt;
    
    if (expiresAt <= now) {
      
      // Token expired, verify refresh token
      const refreshResult = await validateRefreshToken(sessionData.refreshToken);
      result.refreshTokenValid = refreshResult;
      
      if (refreshResult) {
        result.status = ValidationStatus.SUCCESS;
        result.sessionValid = true;
      } else {
        result.sessionValid = false;
      }
    } else {
      result.status = ValidationStatus.SUCCESS;
      result.sessionValid = true;
      result.refreshTokenValid = true;
    }
    
    result.duration = Date.now() - startTime;
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      status: ValidationStatus.ERROR,
      stage: ValidationStage.STAGE_1,
      timestamp: startTime,
      duration,
      hasLocalStorageSession: false,
      sessionValid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Stage 2: AuthManager initialization and profile validation
 * Skip localStorage check; directly execute AuthManager initialization, scan and validate profiles
 */
export async function validateLocalProfiles(stage1Result?: Stage1ValidationResult): Promise<Stage2ValidationResult> {
  const startTime = Date.now();
  
  try {
    
    // Initialize result object
    const result: Stage2ValidationResult = {
      status: ValidationStatus.FAILED,
      stage: ValidationStage.STAGE_2,
      timestamp: startTime,
      totalProfiles: 0,
      validUsers: [],
      expiredUsers: [],
      invalidUsers: [],
      authManagerInitialized: false,
      authManagerProfiles: [],
      skippedDueToValidSession: false
    };
    
    
    try {
      // Step 1: Initialize AuthManager and fetch data from SigninOps
      const { AuthManagerProxy } = await import('../auth/authManagerProxy');
      const authManager = new AuthManagerProxy();
      
      const localAuths = await authManager.getLocalActiveAuths();
      
      // Build a compatible initialization result format
      const initResult = {
        initializedAuths: localAuths.map(a => a.ghcAuth?.user?.login || 'unknown'),
        validatedAuths: localAuths.map(a => a.ghcAuth?.user?.login || 'unknown'),
        recoverableAuths: [] as string[],
        failedAuths: [] as string[],
        totalDuration: 0
      };
      
      result.authManagerInitialized = true;
      
      
      // Step 2: Convert AuthManager results to StartupValidation format
      
      // 🔥 Use AuthData directly without any mapping or reconstruction
      const validAuthProfiles = localAuths.map(authData => ({
        authData: authData,  // Directly save the complete AuthData
        alias: authData.ghcAuth.alias,
        isValid: true,
        type: 'valid' as const
      }));
      
      const recoverableAuthProfiles: any[] = [];
      
      // Set results - directly use profiles containing AuthData
      result.validUsers = validAuthProfiles;
      result.expiredUsers = recoverableAuthProfiles;
      result.totalProfiles = validAuthProfiles.length + recoverableAuthProfiles.length;
      result.authManagerProfiles = validAuthProfiles;
      
      // Record failed auths as invalidUsers
      for (const failedAuthId of initResult.failedAuths) {
        result.invalidUsers.push({
          alias: failedAuthId,
          reason: 'AuthManager initialization failed'
        });
      }
      
      
    } catch (authManagerError) {
      result.error = authManagerError instanceof Error ? authManagerError.message : 'AuthManager initialization failed';
      result.status = ValidationStatus.ERROR;
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Determine if Stage 2 is successful
    if (result.totalProfiles > 0) {
      result.status = ValidationStatus.SUCCESS;
    } else {
      result.status = ValidationStatus.SUCCESS; // No profiles is also a success state
    }
    
    result.duration = Date.now() - startTime;
    
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      status: ValidationStatus.ERROR,
      stage: ValidationStage.STAGE_2,
      timestamp: startTime,
      duration,
      totalProfiles: 0,
      validUsers: [],
      expiredUsers: [],
      invalidUsers: [],
      authManagerInitialized: false,
      authManagerProfiles: [],
      skippedDueToValidSession: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}


/**
 * Validate if refresh token is valid
 * Verify by attempting to refresh token through AuthManager
 */
export async function validateRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    
    // Import AuthManager and attempt to refresh token
    const { AuthManagerProxy } = await import('../auth/authManagerProxy');
    const authManager = new AuthManagerProxy();
    
    // Get current auth
    const currentAuth = await authManager.getCurrentAuthAsync();
    if (!currentAuth) {
      return false;
    }
    
    // Attempt to refresh copilot token
    const refreshResult = await authManager.refreshCopilotToken();
    
    if (refreshResult.success) {
      return true;
    } else {
      return false;
    }
    
  } catch (error) {
    return false;
  }
}

/**
 * Main function to execute simplified validation (no localStorage check)
 * Directly proceed to AuthManager initialization and profile scanning
 */
export async function performTwoStageValidation(options: ValidationOptions = {}): Promise<StartupValidationResult> {
  const startTime = Date.now();
  
  try {
    
    // Stage 1: Skip localStorage check - create a mock successful stage1 result
    const stage1Result: Stage1ValidationResult = {
      status: ValidationStatus.SUCCESS,
      stage: ValidationStage.STAGE_1,
      timestamp: startTime,
      duration: 0,
      hasLocalStorageSession: false,
      sessionValid: false // Always false since we're not checking localStorage
    };
    
    
    // Stage 2: Always execute AuthManager initialization (unless explicitly skipped)
    let stage2Result: Stage2ValidationResult;
    if (options.skipStage2) {
      stage2Result = {
        status: ValidationStatus.SUCCESS,
        stage: ValidationStage.STAGE_2,
        timestamp: Date.now(),
        duration: 0,
        totalProfiles: 0,
        validUsers: [],
        expiredUsers: [],
        invalidUsers: [],
        authManagerInitialized: false,
        authManagerProfiles: [],
        skippedDueToValidSession: false
      };
    } else {
      // Always proceed with AuthManager initialization since we don't check localStorage
      stage2Result = await validateLocalProfiles(stage1Result);
    }
    
    // Analyze results and recommend actions
    const recommendedAction = determineStartupAction(stage1Result, stage2Result);
    
    const totalDuration = Date.now() - startTime;
    
    const finalResult: StartupValidationResult = {
      stage1: stage1Result,
      stage2: stage2Result,
      recommendedAction,
      totalDuration,
      completedAt: Date.now()
    };
    
    
    return finalResult;
    
  } catch (error) {
    
    // Return error result
    const totalDuration = Date.now() - startTime;
    return {
      stage1: {
        status: ValidationStatus.ERROR,
        stage: ValidationStage.STAGE_1,
        timestamp: startTime,
        hasLocalStorageSession: false,
        sessionValid: false,
        error: 'Fatal validation error'
      },
      stage2: {
        status: ValidationStatus.ERROR,
        stage: ValidationStage.STAGE_2,
        timestamp: startTime,
        totalProfiles: 0,
        validUsers: [],
        expiredUsers: [],
        invalidUsers: [],
        authManagerInitialized: false,
        authManagerProfiles: [],
        skippedDueToValidSession: false,
        error: 'Fatal validation error'
      },
      recommendedAction: StartupAction.SHOW_ERROR,
      totalDuration,
      completedAt: Date.now()
    };
  }
}

/**
 * Determine recommended startup action based on validation results (no localStorage dependency)
 */
function determineStartupAction(stage1: Stage1ValidationResult, stage2: Stage2ValidationResult): StartupAction {
  
  // Detailed debug log
  
  // If any stage has errors, show error page
  if (stage1.status === ValidationStatus.ERROR || stage2.status === ValidationStatus.ERROR) {
    return StartupAction.SHOW_ERROR;
  }
  
  // Only use AuthManager results
  if (stage2.authManagerInitialized && stage2.authManagerProfiles && stage2.authManagerProfiles.length > 0) {
    // 🔥 New business logic: auto-login if there is only one valid user
    if (stage2.validUsers.length === 1 && stage2.expiredUsers.length === 0) {
      return StartupAction.AUTO_LOGIN_SINGLE_USER;
    }
    
    // Multiple users or expired users, require user selection
    return StartupAction.SHOW_USER_SELECTION;
  }
  
  // No profiles, show new user signup
  return StartupAction.SHOW_NEW_USER_SIGNUP;
}