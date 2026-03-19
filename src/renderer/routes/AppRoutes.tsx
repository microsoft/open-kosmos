import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { StartupPage } from '../components/pages/StartupPage';
import { SignInPage } from '../components/pages/SignInPage';
import { DataLoadingPage } from '../components/pages/DataLoadingPage';
import { AgentPage } from '../components/pages/AgentPage';
import ChatView from '../components/chat/ChatView';
import McpView from '../components/mcp/McpView';
import AddNewMcpServerView from '../components/mcp/AddNewMcpServerView';
import ImportVscodeMcpServerView from '../components/mcp/ImportVscodeMcpServerView';
import SkillsView from '../components/skills/SkillsView';
import MemoryView from '../components/memory/MemoryView';
import SettingsPage from '../components/pages/SettingsPage';
import RuntimeSettingsView from '../components/settings/RuntimeSettingsView';
import VoiceInputSettingsView from '../components/settings/VoiceInputSettingsView';
import ScreenshotSettingsView from '../components/settings/ScreenshotSettingsView';
import AboutAppView from '../components/settings/AboutAppView';
import BrowserControlView from '../components/settings/BrowserControlView';
import AgentChatEditingView from '../components/chat/agent-area/AgentChatEditingView';
import AgentChatCreationView from '../components/chat/agent-area/AgentChatCreationView';
import CreateCustomAgentView from '../components/chat/agent-area/CreateCustomAgentView';
import { RequireAuth } from './RequireAuth';
import { useFeatureFlag } from '../lib/featureFlags';
import {
  StartupValidationResult,
  StartupAction,
} from '../types/startupValidationTypes';
import { createLogger } from '../lib/utilities/logger';
import { AutoLoginSingleUser } from '../components/auth/AutoLoginSingleUser';
import { useAuthContext } from '../components/auth/AuthProvider';

const logger = createLogger('[AppRoutes]');

// Wrapper for StartupPage
const StartupWrapper: React.FC = () => {
  const navigate = useNavigate();

  const handleStartupComplete = (result: StartupValidationResult) => {
    logger.debug('Startup complete, action:', result.recommendedAction);

    if (result.recommendedAction === StartupAction.AUTO_LOGIN_SINGLE_USER) {
      navigate('/auto-login', { state: { startupResult: result } });
    } else if (
      result.recommendedAction === StartupAction.SHOW_USER_SELECTION ||
      result.recommendedAction === StartupAction.SHOW_NEW_USER_SIGNUP
    ) {
      navigate('/login', { state: { startupResult: result } });
    } else {
      navigate('/login');
    }
  };

  return <StartupPage onComplete={handleStartupComplete} />;
};

// Wrapper for AutoLogin
const AutoLoginWrapper: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const startupResult = location.state
    ?.startupResult as StartupValidationResult;

  if (!startupResult) {
    return <Navigate to="/" replace />;
  }

  const handleSuccess = () => {
    // On success, go to loading page to load data
    navigate('/loading');
  };

  const handleFailure = () => {
    // On failure, go to login page
    navigate('/login', { state: { startupResult } });
  };

  return (
    <AutoLoginSingleUser
      startupValidationResult={startupResult}
      onSuccess={handleSuccess}
      onFailure={handleFailure}
    />
  );
};

// Wrapper for SignInPage
const SignInWrapper: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const startupResult = location.state?.startupResult as
    | StartupValidationResult
    | undefined;

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/loading');
    }
  }, [isAuthenticated, navigate]);

  return <SignInPage startupResult={startupResult} />;
};

// Wrapper for DataLoadingPage
const DataLoadingWrapper: React.FC = () => {
  const navigate = useNavigate();
  const handleDataReady = () => {
    navigate('/agent');
  };
  return <DataLoadingPage onDataReady={handleDataReady} />;
};

export const AppRoutes: React.FC = () => {
  const navigate = useNavigate();
  
  // Chrome Extension / Browser Control route (controlled by feature flag)
  const browserControlEnabled = useFeatureFlag('browserControl');

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (data: { route: string; state?: any }) => {
      logger.debug('Received navigate:to event', data);
      if (data && data.route) {
        navigate(data.route, { state: data.state });
      }
    };

    const cleanup = window.electronAPI?.on('navigate:to', handleNavigate);
    return cleanup;
  }, [navigate]);

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<StartupWrapper />} />
      <Route path="/login" element={<SignInWrapper />} />
      <Route path="/auto-login" element={<AutoLoginWrapper />} />
      <Route path="/loading" element={<DataLoadingWrapper />} />

      {/* Protected Routes */}
      <Route element={<RequireAuth />}>
        <Route path="/agent" element={<AgentPage />}>
          <Route index element={<Navigate to="/agent/chat" replace />} />
          <Route path="chat" element={<ChatView />} />
          <Route path="chat/creation" element={<AgentChatCreationView />} />
          <Route path="chat/creation/custom-agent" element={<CreateCustomAgentView />} />
          <Route path="chat/:chatId" element={<ChatView />} />
          <Route path="chat/:chatId/:sessionId" element={<ChatView />} />
          <Route path="chat/:chatId/settings" element={<AgentChatEditingView />} />
          <Route path="chat/:chatId/settings/*" element={<AgentChatEditingView />} />
        </Route>
        
        {/* Settings Routes - separate from agent */}
        <Route path="/settings" element={<SettingsPage />}>
          <Route index element={<Navigate to="mcp" replace />} />
          <Route path="voice-input" element={<VoiceInputSettingsView />} />
          <Route path="screenshot" element={<ScreenshotSettingsView />} />
          <Route path="mcp" element={<McpView />} />
          <Route path="mcp/new" element={<AddNewMcpServerView />} />
          <Route path="mcp/edit/:editServerName" element={<AddNewMcpServerView />} />
          <Route path="mcp/import-vscode" element={<ImportVscodeMcpServerView />} />
          <Route path="runtime" element={<RuntimeSettingsView />} />
          <Route path="skills" element={<SkillsView />} />
          <Route path="memory" element={<MemoryView />} />
          <Route path="about" element={<AboutAppView />} />
          {/* Browser Control route controlled by feature flag */}
          {browserControlEnabled && (
            <Route path="browser-control" element={<BrowserControlView />} />
          )}
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
