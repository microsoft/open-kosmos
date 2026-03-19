'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { useToast } from '../ui/ToastProvider';
import RuntimeSettingsHeaderView from './RuntimeSettingsHeaderView';
import RuntimeSettingsContentView from './RuntimeSettingsContentView';
import { DEFAULT_PYTHON_VERSION } from '../../lib/runtime/runtimeVersions';
import { appDataManager } from '../../lib/userData/appDataManager';
import type { RuntimeEnvironment } from '../../lib/userData/types';
import '../../styles/RuntimeSettings.css';

interface RuntimeStatus {
  bun: boolean;
  uv: boolean;
  bunPath: string;
  uvPath: string;
}

interface PythonVersion {
  version: string;
  semver?: string;
  path: string | null;
  status: 'installed' | 'available';
}

const RuntimeSettingsView: React.FC = () => {
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnvironment | null>(null);
  // Independent install version draft state to prevent AppDataManager push from interrupting user's editing
  const [installVersions, setInstallVersions] = useState({ bun: '', uv: '' });
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pythonVersions, setPythonVersions] = useState<PythonVersion[]>([]);
  const [newPythonVersion, setNewPythonVersion] = useState<string>(DEFAULT_PYTHON_VERSION);
  const [isPythonLoading, setIsPythonLoading] = useState(false);
  const { showSuccess, showError } = useToast();

  // Subscribe to AppDataManager for real-time runtimeEnvironment changes
  useEffect(() => {
    // Read current cache directly (appDataManager is initialized by backend push, no manual fetch needed)
    const rt = appDataManager.getRuntimeEnvironment();
    if (rt) {
      setRuntimeEnv(rt);
      setInstallVersions({ bun: rt.bunVersion, uv: rt.uvVersion });
    }

    const unsub = appDataManager.subscribe((cfg) => {
      const rt = cfg.runtimeEnvironment;
      if (rt) {
        setRuntimeEnv(rt);
        // Sync version numbers (server pushes new version after installation completes)
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
      console.error(e);
    }
  }, []);

  // loadData only loads status and python version list (these don't go through AppDataManager)
  const loadData = useCallback(async () => {
    try {
      const sts = await window.electronAPI.runtime.checkStatus();
      setStatus(sts);
      if (sts.uv) {
        loadPythonVersions();
      }
    } catch (e) {
      console.error(e);
    }
  }, [loadPythonVersions]);

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
      // AppCacheManager pushes updates → AppDataManager → setRuntimeEnv auto-refreshes
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
      // AppCacheManager pushes updates → AppDataManager → setRuntimeEnv auto-refreshes
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

  // Merge AppDataManager's runtimeEnv with installVersions draft into view config
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
        pythonVersions={pythonVersions}
        isLoading={isLoading}
        isPythonLoading={isPythonLoading}
        newPythonVersion={newPythonVersion}
        onModeChange={handleModeChange}
        onInstall={handleInstall}
        onVersionChange={handleVersionChange}
        onNewPythonVersionChange={setNewPythonVersion}
        onInstallPython={handleInstallPython}
        onUninstallPython={handleUninstallPython}
        onPinPythonVersion={handlePinPythonVersion}
        onCleanUvCache={handleCleanUvCache}
      />
    </div>
  );
};

export default RuntimeSettingsView;
