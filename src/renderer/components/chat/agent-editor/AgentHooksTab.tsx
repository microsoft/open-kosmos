import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';

import '../../../styles/Agent.css';
import { TabComponentProps } from './types';
import type { HookDefinition } from '@shared/ipc/agentHooks';
import { agentHooksApi } from '../../../ipc/agentHooks';
import ListSearchBox from '../../ui/ListSearchBox';
import { createLogger } from '../../../lib/utilities/logger';
import { useI18n } from '../../../lib/i18n/useI18n';

const logger = createLogger('[AgentHooksTab]');

/**
 * AgentHooksTab - Agent Hooks configuration tab.
 *
 * Mirrors AgentSkillsTab/AgentMcpServersTab: it lists the global Hook library and
 * lets the user select which Hooks are bound to this Agent. Selected Hook ids are
 * stored in `agent.hooks: string[]`, exactly like `agent.skills` stores names.
 */
const AgentHooksTab: React.FC<TabComponentProps> = ({
  agentData,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  const [hooks, setHooks] = useState<HookDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedHooks, setSelectedHooks] = useState<Set<string>>(new Set());
  const [initialHooks, setInitialHooks] = useState<Set<string>>(new Set());
  const [isInitialized, setIsInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const isExternalAgent = agentData?.source === 'EXTERNAL';

  // Load the global Hook library once.
  useEffect(() => {
    if (isExternalAgent) {
      setHooks([]);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await agentHooksApi.listHooks();
        if (cancelled) return;
        if (res.success && res.data) {
          setHooks(res.data);
        } else {
          setLoadError(res.error ?? 'Failed to load hooks.');
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load hooks.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isExternalAgent]);

  // Initialize selection from agent data, preferring cached edits when present.
  useEffect(() => {
    if (!agentData?.id) return;

    if (isExternalAgent) {
      setSelectedHooks(prev => prev.size === 0 ? prev : new Set());
      if (!isInitialized) {
        setInitialHooks(new Set());
        setIsInitialized(true);
      }
      return;
    }

    const baseHooks = new Set<string>(agentData.hooks ?? []);

    const finalHooks = cachedData?.hooks ? new Set(cachedData.hooks) : baseHooks;
    setSelectedHooks(finalHooks);

    if (!isInitialized) {
      setInitialHooks(new Set(baseHooks));
      setIsInitialized(true);
    }
  }, [agentData?.id, agentData?.hooks, cachedData?.hooks, isExternalAgent, isInitialized]);

  const hasChanges = useMemo(() => {
    if (selectedHooks.size !== initialHooks.size) return true;
    for (const hookId of selectedHooks) {
      if (!initialHooks.has(hookId)) return true;
    }
    return false;
  }, [selectedHooks, initialHooks]);

  const lastNotifiedDataRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!isInitialized || !onDataChange) return;
    const hookIds = Array.from(selectedHooks);
    const dataKey = JSON.stringify(hookIds);
    if (lastNotifiedDataRef.current !== dataKey) {
      lastNotifiedDataRef.current = dataKey;
      onDataChange('hooks', { hooks: hookIds }, hasChanges);
    }
  }, [selectedHooks, hasChanges, isInitialized, onDataChange]);

  const handleHookToggle = useCallback(
    (hookId: string) => {
      if (readOnly) return;
      const hook = hooks.find((h) => h.id === hookId);
      setSelectedHooks((prev) => {
        const next = new Set(prev);
        if (next.has(hookId)) {
          // Always allow unbinding, including a stale binding to a now-disabled hook.
          next.delete(hookId);
        } else {
          // Only enabled hooks can be newly bound to the agent.
          if (hook && !hook.enabled) return prev;
          next.add(hookId);
        }
        return next;
      });
    },
    [readOnly, hooks],
  );

  const selectedCount = useMemo(() => {
    if (hooks.length === 0) return 0;
    return hooks.filter((hook) => selectedHooks.has(hook.id)).length;
  }, [hooks, selectedHooks]);

  const handleManageHooks = useCallback(() => {
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings/agent-hooks');
  }, [navigate, location.pathname]);

  // Navigate to the Hooks settings page and select a specific hook (mirrors the
  // Skills/MCP "manage" per-item action). The hook id travels as a query param so
  // AgentHooksView can select it on mount.
  const handleManageHook = useCallback(
    (hookId: string) => {
      sessionStorage.setItem('previousPath', location.pathname);
      // Close the agent editor overlay before navigating to the settings page.
      window.dispatchEvent(new CustomEvent('agent:closeEditor'));
      navigate(`/settings/agent-hooks?selectHook=${encodeURIComponent(hookId)}`);
    },
    [navigate, location.pathname],
  );

  const filteredHooks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === '') return hooks;
    return hooks.filter((hook) => hook.name.toLowerCase().includes(query));
  }, [hooks, searchQuery]);

  if (loadError) {
    logger.warn('Failed to load hooks for agent editor:', loadError);
  }

  if (isExternalAgent) {
    return (
      <div className="agent-tab">
        <div className="tab-header">
          <div className="header-summary">
            <span className="summary-text">{t('agent.hooks.externalUnavailable')}</span>
          </div>
          <div className="header-actions">
            <button
              className="manage-servers-btn"
              onClick={handleManageHooks}
              title={t('agent.hooks.manageAvailableTitle')}
            >
              {t('agent.hooks.manageAvailable')}
            </button>
          </div>
        </div>

        <div className="tab-body">
          <div className="empty-state">
            <h4>{t('agent.hooks.externalUnavailable')}</h4>
            <p>{t('agent.hooks.externalDescription')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-tab">
      <div className="tab-header">
        <div className="header-summary">
          <span className="summary-text">{t('agent.hooks.selectedCount', { count: selectedCount })}</span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleManageHooks}
            title={t('agent.hooks.manageAvailableTitle')}
          >
            {t('agent.hooks.manageAvailable')}
          </button>
        </div>
      </div>

      <div className="tab-body">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner">🔄</div>
            <span>{t('agent.hooks.loading')}</span>
          </div>
        ) : loadError ? (
          <div className="empty-state">
            <h4>{t('agent.hooks.loadFailedTitle')}</h4>
            <p>{loadError}</p>
          </div>
        ) : hooks.length > 0 ? (
          <div className="skill-cards">
            <ListSearchBox value={searchQuery} onChange={setSearchQuery} placeholder={t('agent.hooks.searchPlaceholder')} />
            {filteredHooks.map((hook) => {
              const isSelected = selectedHooks.has(hook.id);
              // A disabled hook can be unbound but never newly bound, so it is only
              // "selectable" when already selected. Enabled hooks are always selectable.
              const isSelectable = hook.enabled || isSelected;
              const isLocked = readOnly || !isSelectable;
              return (
                <div
                  key={hook.id}
                  className={`skill-card ${isSelected ? 'selected' : ''} ${readOnly ? 'readonly' : ''} ${
                    !isSelectable ? 'hook-not-selectable' : ''
                  }`}
                  onClick={() => !readOnly && handleHookToggle(hook.id)}
                  style={
                    readOnly
                      ? { cursor: 'default', opacity: 0.75 }
                      : !isSelectable
                        ? { cursor: 'not-allowed', opacity: 0.6 }
                        : undefined
                  }
                >
                  <div className="skill-card-header">
                    <div className="skill-info">
                      <input
                        type="checkbox"
                        className="skill-checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleHookToggle(hook.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={isLocked}
                        aria-label={t('agent.hooks.bindHook', { name: hook.name })}
                      />
                      <div className="skill-card-name-group">
                        <div className="server-title-row">
                          <span className="skill-card-name">{hook.name}</span>
                          <span className="skill-card-version">
                            {hook.enabled ? t('common.enabled') : t('common.disabled')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="skill-actions">
                      <button
                        className="manage-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleManageHook(hook.id);
                        }}
                        title={t('agent.hooks.manageHook')}
                        aria-label={t('agent.hooks.manageHookAria', { name: hook.name })}
                      >
                        <Settings size={14} />
                      </button>
                    </div>
                  </div>
                  {hook.description ? (
                    <div className="skill-card-description">{hook.description}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <h4>{t('agent.hooks.noAvailable')}</h4>
            <button className="manage-servers-btn" onClick={handleManageHooks}>
              {t('agent.hooks.goToManage')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentHooksTab;
