'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { useToast } from '../ui/ToastProvider';
import RuntimeSettingsHeaderView from './RuntimeSettingsHeaderView';
import RuntimeSettingsContentView, { RuntimeStatus, GitVersion, PythonVersion } from './RuntimeSettingsContentView';
import { DEFAULT_PYTHON_VERSION } from '../../lib/runtime/runtimeVersions';
import { appDataManager } from '../../lib/userData/appDataManager';
import { useFeatureFlag } from '../../lib/featureFlags';
import type { RuntimeEnvironment } from '../../lib/userData/types';
import '../../styles/RuntimeSettings.css';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[RuntimeSettingsView]');

const RuntimeSettingsView: React.FC = () => {
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnvironment | null>(null);
  // Independent install version draft state to avoid AppDataManager push interrupting user input fields
  const [installVersions, setInstallVersions] = useState({ bun: '', uv: '' });
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [gitVersion, setGitVersion] = useState<GitVersion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pythonVersions, setPythonVersions] = useState<PythonVersion[]>([]);
  const [newPythonVersion, setNewPythonVersion] = useState<string>(DEFAULT_PYTHON_VERSION);
  const [isPythonLoading, setIsPythonLoading] = useState(false);
  const { showSuccess, showError } = useToast();
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

  // loadData only loads status and python version list (these don't go through AppDataManager)
  const loadData = useCallback(async () => {
    try {
      const sts = await window.electronAPI.runtime.checkStatus();
      setStatus(sts);

      // Only check Git status if feature is enabled
      if (isGitEnabled) {
        const gitSts = await window.electronAPI.runtime.checkGitVersion();
        setGitVersion(gitSts);
      }

      if (sts.uv) {
        loadPythonVersions();
      }
    } catch (e) {
      logger.error(e);
    }
  }, [loadPythonVersions, isGitEnabled]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadData();
      showSuccess('Runtime status refreshed');
    } catch (e) {
      showError('Failed to refresh runtime status');
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData, showSuccess, showError]);

  const handleModeChange = useCallback(async (mode: 'system' | 'internal') => {
    try {
      await window.electronAPI.runtime.setMode(mode);
      // AppCacheManager will push update → AppDataManager → setRuntimeEnv auto-refresh
      showSuccess(`Switched to ${mode} mode`);
    } catch (e) {
      showError('Failed to switch mode');
    }
  }, [showSuccess, showError]);

  const handleInstall = useCallback(async (tool: 'bun' | 'uv') => {
    setIsLoading(true);
    try {
      const version = installVersions[tool];
      await window.electronAPI.runtime.install(tool, version);
      showSuccess(`Installed ${tool} v${version}`);
      await loadData();
    } catch (e: any) {
      showError(`Failed to install ${tool}: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [installVersions, loadData, showSuccess, showError]);

  const handleVersionChange = useCallback((tool: 'bun' | 'uv', value: string) => {
    setInstallVersions(prev => ({ ...prev, [tool]: value }));
  }, []);

  const handleInstallPython = useCallback(async () => {
    if (!newPythonVersion) return;
    setIsPythonLoading(true);
    try {
      await window.electronAPI.runtime.installPythonVersion(newPythonVersion);
      showSuccess(`Python ${newPythonVersion} installed successfully`);
      await loadPythonVersions();
    } catch (e: any) {
      showError(`Failed to install Python ${newPythonVersion}: ${e.message}`);
    } finally {
      setIsPythonLoading(false);
    }
  }, [newPythonVersion, loadPythonVersions, showSuccess, showError]);

  const handleUninstallPython = useCallback(async (version: string) => {
    if (!confirm(`Are you sure you want to uninstall Python ${version}?`)) return;
    setIsPythonLoading(true);
    try {
      await window.electronAPI.runtime.uninstallPythonVersion(version);
      showSuccess(`Uninstalled Python ${version}`);
      // pinnedPythonVersion is auto-updated via AppCacheManager → AppDataManager push, no manual setConfig needed
      await loadPythonVersions();
    } catch (e: any) {
      showError(`Failed to uninstall: ${e.message}`);
    } finally {
      setIsPythonLoading(false);
    }
  }, [loadPythonVersions, showSuccess, showError]);

  const handlePinPythonVersion = useCallback(async (version: string) => {
    try {
      await window.electronAPI.runtime.setPinnedPythonVersion(version);
      // AppCacheManager will push update → AppDataManager → setRuntimeEnv auto-refresh
      showSuccess(`Pinned Python ${version}`);
    } catch {
      showError('Failed to pin version');
    }
  }, [showSuccess, showError]);

  const handleCleanUvCache = useCallback(async () => {
    setIsLoading(true);
    try {
      await window.electronAPI.runtime.cleanUvCache();
      showSuccess('uv cache cleaned');
    } catch (e) {
      showError('Failed to clean uv cache');
    } finally {
      setIsLoading(false);
    }
  }, [showSuccess, showError]);

  // Merge AppDataManager runtimeEnv with installVersions draft for the view config
  const configForView = runtimeEnv
    ? { ...runtimeEnv, bunVersion: installVersions.bun, uvVersion: installVersions.uv }
    : null;

  if (!configForView || !status) {
    return (
      <div className="runtime-settings-view">
        <div className="runtime-settings-loading">
          Loading runtime status...
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
        onUninstallPython={handleUninstallPython}
        onPinPythonVersion={handlePinPythonVersion}
        onCleanUvCache={handleCleanUvCache}
        onRefresh={loadData}
      />
    </div>
  );
};

export default RuntimeSettingsView;
