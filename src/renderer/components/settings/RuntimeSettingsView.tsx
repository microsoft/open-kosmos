'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { useToast } from '../ui/ToastProvider';
import RuntimeSettingsHeaderView from './RuntimeSettingsHeaderView';
import RuntimeSettingsContentView, { RuntimeStatus, RuntimeCheckingState, GitVersion, PythonVersion } from './RuntimeSettingsContentView';
import { DEFAULT_PYTHON_VERSION } from '../../lib/runtime/runtimeVersions';
import { appDataManager } from '../../lib/userData/appDataManager';
import { useFeatureFlag } from '../../lib/featureFlags';
import type { RuntimeEnvironment } from '../../lib/userData/types';
import '../../styles/RuntimeSettings.css';
import { createLogger } from '../../lib/utilities/logger';
import { useI18n } from '../../lib/i18n/useI18n';
const logger = createLogger('[RuntimeSettingsView]');

/** Polling interval for live status refresh while the Runtime tab is open (app-managed mode only). */
const STATUS_POLL_INTERVAL_MS = 60_000;

/** Default status shown before the first probe resolves. Per-section `checking` flags drive the "Checking…" UI. */
const DEFAULT_STATUS: RuntimeStatus = {
  bun: false,
  uv: false,
  bunPath: '',
  uvPath: '',
};

const RuntimeSettingsView: React.FC = () => {
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnvironment | null>(null);
  // Independent install version draft state to avoid AppDataManager push interrupting user input fields
  const [installVersions, setInstallVersions] = useState({ bun: '', uv: '' });
  // Status starts from a default so the tab renders immediately; each slice is filled in independently.
  const [status, setStatus] = useState<RuntimeStatus>(DEFAULT_STATUS);
  const [checking, setChecking] = useState<RuntimeCheckingState>({ core: true, git: true });
  const [gitVersion, setGitVersion] = useState<GitVersion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pythonVersions, setPythonVersions] = useState<PythonVersion[]>([]);
  const [newPythonVersion, setNewPythonVersion] = useState<string>(DEFAULT_PYTHON_VERSION);
  const [isPythonLoading, setIsPythonLoading] = useState(false);
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();
  const isGitEnabled = useFeatureFlag('openkosmosUseGit');

  // Subscribe to AppDataManager, receive runtimeEnvironment changes in real time
  useEffect(() => {
    // Read current cache directly (appDataManager initialized by backend push, no manual pull needed)
    const rt = appDataManager.getRuntimeEnvironment();
    if (rt) {
      setRuntimeEnv(rt);
      setInstallVersions({ bun: rt.bunVersion, uv: rt.uvVersion });
    }

    const unsub = appDataManager.subscribe((cfg) => {
      const rt = cfg.runtimeEnvironment;
      if (rt) {
        setRuntimeEnv(rt);
        // Sync version number (server pushes new version after installation completes)
        setInstallVersions({ bun: rt.bunVersion, uv: rt.uvVersion });
      }
    });

    return unsub;
  }, []);

  const loadPythonVersions = useCallback(async () => {
    try {
      const versions = await window.electronAPI.runtime.listPythonVersions();
      setPythonVersions(versions);
    } catch (e) {
      logger.error(e);
    }
  }, []);

  // ── Independent status checks ──
  // Each component is probed on its own IPC channel so the tab renders immediately
  // and each row updates as soon as its own probe resolves (no waiting on the slowest).

  const checkCore = useCallback(async () => {
    setChecking((c) => ({ ...c, core: true }));
    try {
      const core = await window.electronAPI.runtime.checkCore();
      setStatus((s) => ({ ...s, ...core }));
      if (core.uv) loadPythonVersions();
    } catch (e) {
      logger.error(e);
    } finally {
      setChecking((c) => ({ ...c, core: false }));
    }
  }, [loadPythonVersions]);


  const checkGit = useCallback(async () => {
    if (!isGitEnabled) {
      setChecking((c) => ({ ...c, git: false }));
      return;
    }
    setChecking((c) => ({ ...c, git: true }));
    try {
      const gitSts = await window.electronAPI.runtime.checkGitVersion();
      setGitVersion(gitSts);
    } catch (e) {
      logger.error(e);
    } finally {
      setChecking((c) => ({ ...c, git: false }));
    }
  }, [isGitEnabled]);

  // Fire every check independently and in parallel.
  const checkAll = useCallback(() => {
    checkCore();
    checkGit();
  }, [checkCore, checkGit]);

  // Run all checks immediately on mount, then poll while the tab is open (app-managed mode only).
  // Polling is scoped to this component: leaving the Runtime tab unmounts the view (React Router
  // <Route element>), which clears the interval via the cleanup below. Additionally, polling is
  // paused while the page is hidden (window minimized / switched away / background) so we don't
  // keep spawning runtime probe subprocesses every minute when no one is looking.
  const isInternalMode = runtimeEnv?.mode === 'internal';
  useEffect(() => {
    // Initial check always runs on mount (and when re-entering the tab).
    checkAll();
    if (!isInternalMode) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (timer === null) {
        timer = setInterval(checkAll, STATUS_POLL_INTERVAL_MS);
      }
    };
    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Refresh immediately on return so the user sees fresh status, then resume polling.
        checkAll();
        startPolling();
      }
    };

    // Only poll if the page is currently visible.
    if (!document.hidden) startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
    };
  }, [checkAll, isInternalMode]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      checkAll();
      showSuccess(t('settings.runtime.refreshing'));
    } catch (e) {
      showError(t('settings.runtime.refreshFailed'));
    } finally {
      setIsRefreshing(false);
    }
  }, [checkAll, showSuccess, showError, t]);

  const handleModeChange = useCallback(async (mode: 'system' | 'internal') => {
    try {
      await window.electronAPI.runtime.setMode(mode);
      // AppCacheManager will push update → AppDataManager → setRuntimeEnv auto-refresh
      showSuccess(t('settings.runtime.switchedMode', { mode }));
    } catch (e) {
      showError(t('settings.runtime.switchModeFailed'));
    }
  }, [showSuccess, showError, t]);

  const handleInstall = useCallback(async (tool: 'bun' | 'uv') => {
    setIsLoading(true);
    try {
      const version = installVersions[tool];
      await window.electronAPI.runtime.install(tool, version);
      showSuccess(t('settings.runtime.installedTool', { tool, version }));
      await checkCore();
    } catch (e: any) {
      showError(t('settings.runtime.installToolFailed', { tool, error: e.message }));
    } finally {
      setIsLoading(false);
    }
  }, [installVersions, checkCore, showSuccess, showError, t]);

  const handleVersionChange = useCallback((tool: 'bun' | 'uv', value: string) => {
    setInstallVersions(prev => ({ ...prev, [tool]: value }));
  }, []);

  const handleInstallPython = useCallback(async () => {
    if (!newPythonVersion) return;
    setIsPythonLoading(true);
    try {
      // "Update" performs install + pin in one action.
      await window.electronAPI.runtime.installPythonVersion(newPythonVersion);
      await window.electronAPI.runtime.setPinnedPythonVersion(newPythonVersion);
      showSuccess(t('settings.runtime.pythonInstalledDefault', { version: newPythonVersion }));
      await loadPythonVersions();
    } catch (e: any) {
      showError(t('settings.runtime.pythonUpdateFailed', { version: newPythonVersion, error: e.message }));
    } finally {
      setIsPythonLoading(false);
    }
  }, [newPythonVersion, loadPythonVersions, showSuccess, showError, t]);

  const handleCleanUvCache = useCallback(async () => {
    setIsLoading(true);
    try {
      await window.electronAPI.runtime.cleanUvCache();
      showSuccess(t('settings.runtime.uvCacheCleaned'));
    } catch (e) {
      showError(t('settings.runtime.uvCacheCleanFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [showSuccess, showError, t]);

  // Merge AppDataManager runtimeEnv with installVersions draft for the view config
  const configForView = runtimeEnv
    ? { ...runtimeEnv, bunVersion: installVersions.bun, uvVersion: installVersions.uv }
    : null;

  // Wait only for runtime config (read synchronously from AppDataManager cache on mount).
  // Status is no longer gated here — the tab renders immediately and each row shows a
  // "Checking…" state until its own probe resolves.
  if (!configForView) {
    return (
      <div className="runtime-settings-view">
        <div className="runtime-settings-loading">
          {t('settings.runtime.loadingStatus')}
        </div>
      </div>
    );
  }

  return (
    <div className="runtime-settings-view">
      <RuntimeSettingsHeaderView
        mode={configForView.mode}
        bunInstalled={status.bun}
        uvInstalled={status.uv}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />
      <RuntimeSettingsContentView
        config={configForView}
        status={status}
        checking={checking}
        gitVersion={gitVersion}
        pythonVersions={pythonVersions}
        isLoading={isLoading}
        isPythonLoading={isPythonLoading}
        showGitVersion={isGitEnabled}
        newPythonVersion={newPythonVersion}
        onModeChange={handleModeChange}
        onInstall={handleInstall}
        onVersionChange={handleVersionChange}
        onNewPythonVersionChange={setNewPythonVersion}
        onInstallPython={handleInstallPython}
        onCleanUvCache={handleCleanUvCache}
      />
    </div>
  );
};

export default RuntimeSettingsView;
