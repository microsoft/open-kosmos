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
import SettingsPage from '../components/pages/SettingsPage';
import RuntimeSettingsView from '../components/settings/RuntimeSettingsView';
import AppearanceSettingsView from '../components/settings/AppearanceSettingsView';
import VoiceInputSettingsView from '../components/settings/VoiceInputSettingsView';
import ScreenshotSettingsView from '../components/settings/ScreenshotSettingsView';
import SyncSettingsView from '../components/settings/SyncSettingsView';
import AboutAppView from '../components/settings/AboutAppView';
import CodingCliSettingsView from '../components/settings/CodingCliSettingsView';
import ArchivedAgentsView from '../components/settings/ArchivedAgentsView';
import BrowserSettingsView from '../components/settings/BrowserSettingsView';
import MemexSettingsView from '../components/settings/MemexSettingsView';
import ProfileMemoryEditorView from '../components/settings/ProfileMemoryEditorView';
import ComputerUseSettingsView from '../components/settings/ComputerUseSettingsView';
import AgentHooksView from '../components/agentHooks/AgentHooksView';
import HookEditorView from '../components/agentHooks/HookEditorView';
import LanguageSettingsView from '../components/settings/LanguageSettingsView';
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
  const location = useLocation();

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

  useEffect(() => {
    void window.electronAPI?.recordCrashBreadcrumb?.('route-change', {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search]);

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
          <Route path="appearance" element={<AppearanceSettingsView />} />
          <Route path="voice-input" element={<VoiceInputSettingsView />} />
          <Route path="screenshot" element={<ScreenshotSettingsView />} />
          <Route path="mcp" element={<McpView />} />
          <Route path="mcp/new" element={<AddNewMcpServerView />} />
          <Route path="mcp/edit/:editServerName" element={<AddNewMcpServerView />} />
          <Route path="mcp/import-vscode" element={<ImportVscodeMcpServerView />} />
          <Route path="runtime" element={<RuntimeSettingsView />} />
          <Route path="skills" element={<SkillsView />} />
          <Route path="agent-hooks" element={<AgentHooksView />} />
          <Route path="agent-hooks/new" element={<HookEditorView />} />
          <Route path="agent-hooks/edit/:editHookId" element={<HookEditorView />} />
          <Route path="sync" element={<SyncSettingsView />} />
          <Route path="language" element={<LanguageSettingsView />} />
          <Route path="about" element={<AboutAppView />} />
          <Route path="browser" element={<BrowserSettingsView />} />
          <Route path="memex" element={<MemexSettingsView />} />
          <Route path="memex/new" element={<ProfileMemoryEditorView />} />
          <Route path="memex/edit/:slug" element={<ProfileMemoryEditorView />} />
          <Route path="computer-use" element={<ComputerUseSettingsView />} />
          <Route path="archived-agents" element={<ArchivedAgentsView />} />
          {/* Coding CLI route — gated at runtime by the per-profile master switch */}
          <Route path="coding-cli" element={<CodingCliSettingsView />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
