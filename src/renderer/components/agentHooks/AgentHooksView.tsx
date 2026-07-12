import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { HookDefinition } from '@shared/ipc/agentHooks';
import { agentHooksApi } from '../../ipc/agentHooks';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import {
  ANCHORED_DROPDOWN_SIZE_PRESETS,
  AnchoredDropdownPosition,
  getAnchoredDropdownPosition,
} from '../../lib/utilities/dropdownPosition';
import HookListPanel from './HookListPanel';
import HookDetailPanel from './HookDetailPanel';
import HookDropdownMenu from './HookDropdownMenu';
import HooksIcon from './HooksIcon';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/Header.css';
import '../../styles/DropdownMenu.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/AgentHooks.css';

const AgentHooksView: React.FC = () => {
  const { t } = useI18n();
  const tRef = useRef(t);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Capture the requested hook id once at mount; an Agent editor "Manage Hook"
  // action navigates here with ?selectHook=<id> so we can select it on open.
  const requestedHookIdRef = useRef<string | null>(searchParams.get('selectHook'));

  const [hooks, setHooks] = useState<HookDefinition[]>([]);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingEnable, setPendingEnable] = useState(false);

  const [selectedHookId, setSelectedHookId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    hookId: string | null;
    position: AnchoredDropdownPosition | null;
  }>({ hookId: null, position: null });
  const hookMenuRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [enableReviewTarget, setEnableReviewTarget] = useState<HookDefinition | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const refreshHooks = useCallback(async () => {
    const res = await agentHooksApi.listHooks();
    if (res.success && res.data) {
      setHooks(res.data);
    } else {
      setError(res.error ?? t('agent.hooks.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [hooksRes, switchRes] = await Promise.all([
          agentHooksApi.listHooks(),
          agentHooksApi.getMasterSwitch(),
        ]);
        if (cancelled) return;
        if (hooksRes.success && hooksRes.data) {
          setHooks(hooksRes.data);
          // Prefer a hook requested via ?selectHook (from the Agent editor), else
          // default-select the first hook so the detail pane is populated on open.
          const requested = requestedHookIdRef.current;
          if (requested && hooksRes.data.some(hook => hook.id === requested)) {
            setSelectedHookId(requested);
          } else if (hooksRes.data.length > 0) {
            setSelectedHookId(hooksRes.data[0].id);
          }
        } else setError(hooksRes.error ?? tRef.current('agent.hooks.loadFailed'));
        if (switchRes.success) setMasterEnabled(switchRes.enabled);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : tRef.current('agent.hooks.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the row menu when a mousedown lands outside it. The menu and the row
  // trigger both stopPropagation on mousedown, so this native listener only fires
  // for genuine outside targets.
  useEffect(() => {
    if (!menuState.hookId) return;
    const handleClickOutside = () => {
      setMenuState({ hookId: null, position: null });
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuState.hookId]);

  const applyMasterSwitch = async (enabled: boolean) => {
    const res = await agentHooksApi.setMasterSwitch(enabled);
    if (res.success) {
      setMasterEnabled(enabled);
      void mcpClientCacheManager.refresh();
      window.dispatchEvent(new CustomEvent('agent-hooks-master-switch-changed', { detail: { enabled } }));
    } else {
      setError(res.error ?? t('agent.hooks.updateSettingFailed'));
    }
  };

  const handleMasterToggle = async (next: boolean) => {
    if (next && !masterEnabled) {
      setPendingEnable(true);
      return;
    }
    await applyMasterSwitch(next);
  };

  const confirmEnable = async () => {
    setPendingEnable(false);
    await applyMasterSwitch(true);
  };

  const startCreate = () => {
    navigate('/settings/agent-hooks/new');
  };

  const startEdit = (hook: HookDefinition) => {
    navigate(`/settings/agent-hooks/edit/${encodeURIComponent(hook.id)}`);
  };

  const handleToggle = async (hook: HookDefinition) => {
    if (!hook.enabled) {
      setSelectedHookId(hook.id);
      setEnableReviewTarget(hook);
      return;
    }
    const res = await agentHooksApi.updateHook(hook.id, { enabled: false });
    if (res.success) {
      await refreshHooks();
    } else {
      setError(res.error ?? t('agent.hooks.updateHookFailed'));
    }
  };

  const handleMenuToggle = (hookId: string, buttonElement: HTMLElement) => {
    if (menuState.hookId === hookId) {
      setMenuState({ hookId: null, position: null });
      return;
    }
    const position = getAnchoredDropdownPosition(buttonElement, ANCHORED_DROPDOWN_SIZE_PRESETS.hookMenu);
    setSelectedHookId(hookId);
    setMenuState({ hookId, position });
  };

  const closeMenu = () => setMenuState({ hookId: null, position: null });

  const requestDelete = (hook: HookDefinition) => {
    setDeleteTarget({ id: hook.id, name: hook.name });
  };

  const confirmHookEnable = async (hook: HookDefinition) => {
    setEnableReviewTarget(null);
    const res = await agentHooksApi.updateHook(hook.id, { enabled: true });
    if (res.success) {
      await refreshHooks();
    } else {
      setError(res.error ?? t('agent.hooks.updateHookFailed'));
    }
  };

  const confirmDelete = async (target: { id: string; name: string }) => {
    setDeleteTarget(null);
    const res = await agentHooksApi.deleteHook(target.id);
    if (res.success) {
      setSelectedHookId(null);
      await refreshHooks();
    } else {
      setError(res.error ?? t('agent.hooks.deleteHookFailed'));
    }
  };

  if (loading) {
    return <div className="agent-hooks-loading">{t('agent.hooks.loadingHooks')}</div>;
  }

  const enabledCount = hooks.filter(hook => hook.enabled).length;
  const selectedHook = hooks.find(hook => hook.id === selectedHookId) ?? null;
  const menuHook = hooks.find(hook => hook.id === menuState.hookId) ?? null;

  return (
    <div className="agent-hooks-view">
      <div className="unified-header">
        <div className="header-title">
          <HooksIcon className="header-icon" />
          <span className="header-name">{t('agent.hooks.title')}</span>
          <div className="agent-hooks-status-badges">
            <Badge variant="normal" className="text-xs">
              {t('agent.hooks.count', { count: hooks.length })}
            </Badge>
            <Badge variant="normal" className="text-xs">
              {t('agent.hooks.enabledCount', { count: enabledCount })}
            </Badge>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn-action"
            disabled={!masterEnabled}
            onMouseDown={e => e.stopPropagation()}
            onClick={startCreate}
            title={t('agent.hooks.addHook')}
            aria-label={t('agent.hooks.addHookAria')}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="var(--color-warm-900)"/>
            </svg>
          </button>
          <div className="agent-hooks-master">
            <span>{t('agent.hooks.enableHooks')}</span>
            <label className="toolbar-toggle-wrapper">
              <input
                type="checkbox"
                checked={masterEnabled}
                onChange={e => handleMasterToggle(e.target.checked)}
                aria-label={t('agent.hooks.enableHooks')}
              />
              <div className="toolbar-toggle-track"></div>
            </label>
          </div>
        </div>
      </div>

      <div className="agent-hooks-content">
        {error ? <p className="agent-hooks-error">{error}</p> : null}

        {masterEnabled ? (
          <div className="hook-two-col">
            <div className="hook-list-panel">
              <HookListPanel
                hooks={hooks}
                selectedHookId={selectedHookId}
                onSelect={hook => {
                  setSelectedHookId(hook.id);
                }}
                onMenuToggle={handleMenuToggle}
              />
            </div>
            <HookDetailPanel hook={selectedHook} />
          </div>
        ) : (
          <div className="agent-hooks-disabled-body" data-testid="agent-hooks-disabled-state">
            <div className="agent-hooks-empty-state">
              <div className="agent-hooks-empty-icon">⚙</div>
              <h3>{t('agent.hooks.disabledTitle')}</h3>
              <p>{t('agent.hooks.disabledDescription')}</p>
              <p className="agent-hooks-empty-hint">
                {t('agent.hooks.disabledHint')}
              </p>
              <div className="agent-hooks-disabled-actions">
                <button
                  type="button"
                  className="agent-hooks-disabled-primary"
                  onClick={() => handleMasterToggle(true)}
                  aria-label={t('agent.hooks.enableHooksEmptyAria')}
                >
                  {t('agent.hooks.enableHooksAction')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {menuState.hookId && menuState.position && menuHook ? (
        <HookDropdownMenu
          hookMenuRef={hookMenuRef}
          hook={menuHook}
          position={menuState.position}
          onToggleEnable={handleToggle}
          onEdit={startEdit}
          onDelete={requestDelete}
          onClose={closeMenu}
        />
      ) : null}

      <Dialog open={pendingEnable} onOpenChange={setPendingEnable}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">{t('agent.hooks.enableTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('agent.hooks.enableDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() => setPendingEnable(false)}
              aria-label={t('agent.hooks.cancelEnableHooksAria')}
            >
              {t('common.cancel')}
            </button>
            <button
              className="agent-hooks-disabled-primary"
              onClick={confirmEnable}
              aria-label={t('agent.hooks.confirmEnableHooksAria')}
            >
              {t('agent.hooks.enableHookAction')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={enableReviewTarget !== null} onOpenChange={open => {
        if (!open) setEnableReviewTarget(null);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-left">{t('agent.hooks.enableHookTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('agent.hooks.enableHookDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="hook-enable-review">
            <HookDetailPanel hook={enableReviewTarget} />
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() => setEnableReviewTarget(null)}
              aria-label={t('agent.hooks.cancelEnableHookAria')}
            >
              {t('common.cancel')}
            </button>
            <button
              className="agent-hooks-disabled-primary"
              onClick={() => void confirmHookEnable(enableReviewTarget!)}
              aria-label={t('agent.hooks.confirmEnableHookAria')}
            >
              {t('agent.hooks.enableHookTitle')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">{t('agent.hooks.deleteTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('agent.hooks.deleteConfirm', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-danger-600">
              {t('agent.hooks.deleteWarning')}
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() => setDeleteTarget(null)}
              aria-label={t('agent.hooks.cancelDeleteHookAria')}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-danger"
              onClick={() => confirmDelete(deleteTarget!)}
              aria-label={t('agent.hooks.confirmDeleteHookAria')}
            >
              {t('common.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentHooksView;
