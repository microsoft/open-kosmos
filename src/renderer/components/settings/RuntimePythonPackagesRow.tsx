import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import { createLogger } from '../../lib/utilities/logger';
import { parsePackageSpecs } from '../../../shared/utils/pythonPackageSpec';
import { useI18n } from '../../lib/i18n/useI18n';

const logger = createLogger('[RuntimePythonPackagesRow]');

interface PythonPackage {
  name: string;
  version: string;
}

interface RuntimePythonPackagesRowProps {
  /** Gate: the venv only exists once uv + an interpreter are installed. */
  ready: boolean;
  /** True while the app-managed interpreter is being installed/updated and the venv is rebuilt. */
  updating?: boolean;
  /** Pinned interpreter identity; changing it means the venv was recreated, so reload the list. */
  refreshKey?: string | null;
  /** Reports package install/remove activity so the parent can block Python/runtime mutations. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Manage third-party Python packages inside the app-managed venv ({userData}/python-venv).
 * Without this, a local Python MCP server needing libraries (e.g. `mcp`, `httpx`) forced
 * users to drop into a terminal and run uv by hand. Add installs via `uv pip install`,
 * remove via `uv pip uninstall`, list via `uv pip list`.
 */
const RuntimePythonPackagesRow: React.FC<RuntimePythonPackagesRowProps> = ({ ready, updating = false, refreshKey, onBusyChange }) => {
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();
  const [packages, setPackages] = useState<PythonPackage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const list = await window.electronAPI.runtime.listPythonPackages();
      setPackages(list);
    } catch (e) {
      logger.error(e);
    }
  }, [ready]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const packageBusy = isBusy || removing !== null;
  useEffect(() => {
    onBusyChange?.(packageBusy);
  }, [onBusyChange, packageBusy]);

  useEffect(() => () => {
    onBusyChange?.(false);
  }, [onBusyChange]);

  const handleAdd = useCallback(async () => {
    const specs = parsePackageSpecs(input);
    if (specs.length === 0) return;
    setIsBusy(true);
    try {
      await window.electronAPI.runtime.addPythonPackages(specs);
      showSuccess(t('settings.runtime.packageInstalled', { packages: specs.join(', ') }));
      setInput('');
      await load();
    } catch (e: any) {
      showError(t('settings.runtime.packageInstallFailed', { error: e?.message ?? e }));
    } finally {
      setIsBusy(false);
    }
  }, [input, load, showSuccess, showError, t]);

  const handleRemove = useCallback(async (name: string) => {
    setRemoving(name);
    try {
      await window.electronAPI.runtime.uninstallPythonPackage(name);
      showSuccess(t('settings.runtime.packageRemoved', { name }));
      await load();
    } catch (e: any) {
      showError(t('settings.runtime.packageRemoveFailed', { name, error: e?.message ?? e }));
    } finally {
      setRemoving(null);
    }
  }, [load, showSuccess, showError, t]);

  if (!ready) return null;

  // Any in-flight install/remove — or an interpreter update rebuilding the venv — blocks all
  // package actions; the venv is mutated serially and must not change underfoot mid-operation.
  const busy = packageBusy || updating;

  return (
    <div className="toolbar-settings-card runtime-packages-block">
      <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
        <div className="setting-label-container">
          <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.runtime.pythonPackagesTitle')}</label>
          <p className="runtime-card-desc">{t('settings.runtime.pythonPackagesDescription')}</p>
        </div>
      </div>
      <div className="runtime-component-row toolbar-setting-item">
        <div className="runtime-component-meta">
          <span className="setting-label">{t('settings.runtime.addPackage')} <span className="runtime-component-tag">{t('settings.runtime.venvLibraries')}</span></span>
        </div>
        <div className="runtime-component-actions">
          <input
            className="runtime-package-input"
            placeholder={t('settings.runtime.pythonPackagePlaceholder')}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button
            className="runtime-action-btn"
            disabled={busy || input.trim().length === 0}
            onClick={handleAdd}
          >
            {isBusy ? t('settings.runtime.adding') : t('settings.computerUse.add')}
          </button>
        </div>
      </div>
      {packages.length > 0 && (
        <ul className="runtime-package-list">
          {packages.map((pkg) => (
            <li key={pkg.name} className="runtime-package-item">
              <span className="runtime-package-name" title={`${pkg.name} ${pkg.version}`}>
                {pkg.name}<span className="runtime-package-version">{pkg.version}</span>
              </span>
              <button
                className="runtime-package-remove"
                aria-label={t('settings.runtime.removePackage', { name: pkg.name })}
                disabled={busy}
                onClick={() => handleRemove(pkg.name)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RuntimePythonPackagesRow;
