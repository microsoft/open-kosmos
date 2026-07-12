import React, { useState } from 'react';
import '../../styles/ContentView.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/RuntimeSettings.css';
import { BUN_VERSIONS, UV_VERSIONS, PYTHON_VERSIONS } from '../../lib/runtime/runtimeVersions';
import type { RuntimeEnvironment } from '../../lib/userData/types';
import RuntimeSystemDependencyRows from './RuntimeSystemDependencyRows';
import RuntimePythonPackagesRow from './RuntimePythonPackagesRow';
import { useI18n } from '../../lib/i18n/useI18n';

export interface RuntimeStatus {
  bun: boolean;
  uv: boolean;
  bunPath: string;
  uvPath: string;
}

export interface GitVersion {
  installed: boolean;
  version: string | null;
  path: string | null;
}

/** Per-section "first probe in flight" flags — drive the "Checking…" UI instead of "Not installed". */
export interface RuntimeCheckingState {
  core: boolean;
  git: boolean;
}

export interface PythonVersion {
  version: string;
  semver?: string;
  path: string | null;
  status: 'installed' | 'available';
}

interface RuntimeSettingsContentViewProps {
  config: RuntimeEnvironment;
  status: RuntimeStatus;
  checking: RuntimeCheckingState;
  gitVersion: GitVersion | null;
  pythonVersions: PythonVersion[];
  isLoading: boolean;
  isPythonLoading: boolean;
  showGitVersion: boolean;
  newPythonVersion: string;
  onModeChange: (mode: 'system' | 'internal') => Promise<void>;
  onInstall: (tool: 'bun' | 'uv') => Promise<void>;
  onVersionChange: (tool: 'bun' | 'uv', value: string) => void;
  onNewPythonVersionChange: (value: string) => void;
  onInstallPython: () => Promise<void>;
  onCleanUvCache: () => Promise<void>;
}

/** Truncate a long path, keeping the last N segments visible */
export function truncatePath(path: string | null, maxLen = 48): string {
  if (!path) return '-';
  if (path.length <= maxLen) return path;
  const sep = path.includes('/') ? '/' : '\\';
  const parts = path.split(sep);
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = parts[i] + sep + result;
    if (('…' + sep + next).length > maxLen) break;
    result = next;
  }
  return '…' + sep + result;
}

const RuntimeSettingsContentView: React.FC<RuntimeSettingsContentViewProps> = ({
  config,
  status,
  checking,
  gitVersion,
  pythonVersions,
  isLoading,
  isPythonLoading,
  showGitVersion,
  newPythonVersion,
  onModeChange,
  onInstall,
  onVersionChange,
  onNewPythonVersionChange,
  onInstallPython,
  onCleanUvCache,
}) => {
  const { t } = useI18n();
  const [isPackageBusy, setIsPackageBusy] = useState(false);
  const runtimeMutationDisabled = isLoading || isPackageBusy;
  const pythonMutationDisabled = isPythonLoading || isPackageBusy;

  const pinnedPython = config?.pinnedPythonVersion;
  const installedPinned = pinnedPython
    ? pythonVersions.find(
        (py) => py.status === 'installed' && (py.version === pinnedPython || py.semver === pinnedPython),
      )
    : undefined;
  const pythonInstalled = !!installedPinned?.path;

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <div className="toolbar-settings-card">
              <div
                className="toolbar-setting-item"
                style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}
              >
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>
                    {t('settings.runtime.runtimeMode')}
                  </label>
                  <p className="runtime-card-desc">{t('settings.runtime.runtimeModeDescription')}</p>
                </div>
              </div>

              <label
                className={`runtime-mode-row toolbar-setting-item ${config.mode === 'internal' ? 'runtime-mode-row--active' : ''}`}
                onClick={() => {
                  if (!isPackageBusy) onModeChange('internal');
                }}
              >
                <div className="setting-label-container">
                  <span className="setting-label">{t('settings.runtime.appManagedRecommended')}</span>
                  <span className="runtime-card-desc">{t('settings.runtime.appManagedRecommendedDescription')}</span>
                </div>
                <input
                  type="radio"
                  name="runtimeMode"
                  checked={config.mode === 'internal'}
                  disabled={isPackageBusy}
                  onChange={() => {
                    if (!isPackageBusy) onModeChange('internal');
                  }}
                  className="runtime-radio"
                />
              </label>

              <label
                className={`runtime-mode-row toolbar-setting-item ${config.mode === 'system' ? 'runtime-mode-row--active' : ''}`}
                onClick={() => {
                  if (!isPackageBusy) onModeChange('system');
                }}
              >
                <div className="setting-label-container">
                  <span className="setting-label">{t('settings.runtime.userSystemEnvironment')}</span>
                  <span className="runtime-card-desc">{t('settings.runtime.userSystemDescription')}</span>
                </div>
                <input
                  type="radio"
                  name="runtimeMode"
                  checked={config.mode === 'system'}
                  disabled={isPackageBusy}
                  onChange={() => {
                    if (!isPackageBusy) onModeChange('system');
                  }}
                  className="runtime-radio"
                />
              </label>
            </div>

            {config.mode === 'internal' && (
              <>
                <div className="toolbar-settings-card">
                  <div
                    className="toolbar-setting-item"
                    style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}
                  >
                    <div className="setting-label-container">
                      <label className="setting-label" style={{ fontWeight: 500 }}>
                        {t('settings.runtime.appManagedEnvironment')}
                      </label>
                      <p className="runtime-card-desc">{t('settings.runtime.appManagedEnvironmentDescription')}</p>
                    </div>
                    {process.env.NODE_ENV === 'development' && (
                      <button className="runtime-text-btn" onClick={onCleanUvCache} disabled={runtimeMutationDisabled}>
                        {t('settings.runtime.cleanCache')}
                      </button>
                    )}
                  </div>

                  <div className="runtime-component-row toolbar-setting-item">
                    <div className="runtime-component-meta">
                      <span className="setting-label">
                        Bun <span className="runtime-component-tag">{t('settings.runtime.nodeNpxTag')}</span>
                      </span>
                      <span className={`runtime-status-dot ${status.bun ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                        {status.bun ? (
                          <span title={status.bunPath}>{truncatePath(status.bunPath)}</span>
                        ) : checking.core ? (
                          t('settings.runtime.checking')
                        ) : (
                          t('settings.runtime.notInstalled')
                        )}
                      </span>
                    </div>
                    <div className="runtime-component-actions">
                      <div className="runtime-version-field">
                        <select value={config.bunVersion} onChange={(e) => onVersionChange('bun', e.target.value)} className="runtime-version-input-sm">
                          {BUN_VERSIONS.map((entry) => (
                            <option key={entry.version} value={entry.version}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button className="runtime-action-btn" disabled={runtimeMutationDisabled} onClick={() => onInstall('bun')}>
                        {status.bun ? t('settings.runtime.update') : t('settings.runtime.install')}
                      </button>
                    </div>
                  </div>

                  <div className="runtime-component-row toolbar-setting-item">
                    <div className="runtime-component-meta">
                      <span className="setting-label">
                        uv <span className="runtime-component-tag">{t('settings.runtime.pythonManagerTag')}</span>
                      </span>
                      <span className={`runtime-status-dot ${status.uv ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                        {status.uv ? (
                          <span title={status.uvPath}>{truncatePath(status.uvPath)}</span>
                        ) : checking.core ? (
                          t('settings.runtime.checking')
                        ) : (
                          t('settings.runtime.notInstalled')
                        )}
                      </span>
                    </div>
                    <div className="runtime-component-actions">
                      <div className="runtime-version-field">
                        <select value={config.uvVersion} onChange={(e) => onVersionChange('uv', e.target.value)} className="runtime-version-input-sm">
                          {UV_VERSIONS.map((entry) => (
                            <option key={entry.version} value={entry.version}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button className="runtime-action-btn" disabled={runtimeMutationDisabled} onClick={() => onInstall('uv')}>
                        {status.uv ? t('settings.runtime.update') : t('settings.runtime.install')}
                      </button>
                    </div>
                  </div>

                  <div className="runtime-component-row toolbar-setting-item">
                    <div className="runtime-component-meta">
                      <span className="setting-label">
                        Python <span className="runtime-component-tag">{t('settings.runtime.pythonInterpreterTag')}</span>
                      </span>
                      <span className={`runtime-status-dot ${pythonInstalled ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
                        {pythonInstalled ? (
                          <span title={installedPinned?.path || ''}>{truncatePath(installedPinned?.path || '')}</span>
                        ) : checking.core ? (
                          t('settings.runtime.checking')
                        ) : (
                          t('settings.runtime.notInstalled')
                        )}
                      </span>
                    </div>
                    <div className="runtime-component-actions">
                      <div className="runtime-version-field">
                        <select value={newPythonVersion} onChange={(e) => onNewPythonVersionChange(e.target.value)} className="runtime-version-input-sm">
                          {PYTHON_VERSIONS.map((entry) => (
                            <option key={entry.version} value={entry.version}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button className="runtime-action-btn" disabled={pythonMutationDisabled} onClick={onInstallPython}>
                        {isPythonLoading ? t('settings.runtime.updating') : t('settings.runtime.update')}
                      </button>
                    </div>
                  </div>

                  <RuntimeSystemDependencyRows checking={checking} gitVersion={gitVersion} showGitVersion={showGitVersion} />

                  {isLoading && <div className="runtime-loading-bar">{t('settings.runtime.installingNotice')}</div>}
                </div>

                <RuntimePythonPackagesRow
                  ready={status.uv && pythonInstalled}
                  updating={isLoading || isPythonLoading}
                  refreshKey={pinnedPython}
                  onBusyChange={setIsPackageBusy}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RuntimeSettingsContentView;
