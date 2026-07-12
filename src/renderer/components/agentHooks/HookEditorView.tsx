import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { agentHooksApi } from '../../ipc/agentHooks';
import HookEditor from './HookEditor';
import ApplyHookToAgentsDialog from './ApplyHookToAgentsDialog';
import {
  emptyFormState,
  formStateToCreateInput,
  formStateToUpdatePatch,
  hookToFormState,
  type HookFormState,
} from './hookFormModel';
import '../../styles/ContentView.css';
import '../../styles/Header.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/AgentHooks.css';
import { useI18n } from '../../lib/i18n/useI18n';

const LIST_PATH = '/settings/agent-hooks';

/**
 * HookEditorView - full-page Create / Edit Hook view.
 *
 * Mirrors the New/Edit MCP server view (`AddNewMcpServerView`): it is a
 * route-level page (`agent-hooks/new`, `agent-hooks/edit/:editHookId`) rather
 * than an editor embedded in the Hooks list detail pane. The unified header owns
 * the title + back button; the body renders the shared `HookEditor` form.
 *
 * Save behavior matches the MCP/Skill flow:
 *  - Create: persist, auto-enable, then open the Apply-to-Agents dialog before
 *    returning to the list with the new hook selected.
 *  - Update: persist (auto-enabled) and return to the list with the hook
 *    selected, without the apply dialog.
 */
const HookEditorView: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const tRef = useRef(t);
  const { editHookId } = useParams<{ editHookId?: string }>();
  const isNew = !editHookId;

  const [editing, setEditing] = useState<HookFormState | null>(isNew ? emptyFormState() : null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyHookTarget, setApplyHookTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Load the hook being edited; create mode starts from an empty form.
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await agentHooksApi.listHooks();
        if (cancelled) return;
        if (res.success && res.data) {
          const hook = res.data.find(h => h.id === editHookId);
          if (hook) {
            setEditing(hookToFormState(hook));
          } else {
            setLoadError(tRef.current('agent.hooks.editor.notFound'));
          }
        } else {
          setLoadError(res.error ?? tRef.current('agent.hooks.editor.loadFailed'));
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : tRef.current('agent.hooks.editor.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isNew, editHookId]);

  // Return to the Hooks list. When a hook id is provided it travels as
  // ?selectHook so the list re-selects it on mount (mirrors MCP ?selectServer).
  const backToList = useCallback(
    (hookId?: string) => {
      const suffix = hookId ? `?selectHook=${encodeURIComponent(hookId)}` : '';
      navigate(`${LIST_PATH}${suffix}`);
    },
    [navigate],
  );

  const handleCancel = useCallback(() => {
    navigate(LIST_PATH);
  }, [navigate]);

  const handleSave = useCallback(
    async (state: HookFormState) => {
      setBusy(true);
      setSaveError(null);
      try {
        if (editHookId) {
          const res = await agentHooksApi.updateHook(editHookId, formStateToUpdatePatch(state));
          if (res.success) {
            backToList(editHookId);
          } else {
            setSaveError(res.error ?? t('agent.hooks.editor.saveFailed'));
          }
        } else {
          const res = await agentHooksApi.createHook(formStateToCreateInput(state));
          if (res.success) {
            const created = res.hook;
            if (created) {
              // Auto-enable the freshly created hook so it is active immediately,
              // then open the apply-to-agents dialog (mirrors MCP/Skill flow).
              if (!created.enabled) {
                const enableResult = await agentHooksApi.updateHook(created.id, { enabled: true });
                if (!enableResult.success) {
                  setSaveError(enableResult.error ?? t('agent.hooks.editor.enableAfterCreateFailed'));
                  return;
                }
              }
              setApplyHookTarget({ id: created.id, name: created.name });
            } else {
              backToList();
            }
          } else {
            setSaveError(res.error ?? t('agent.hooks.editor.saveFailed'));
          }
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : t('agent.hooks.editor.saveFailed'));
      } finally {
        setBusy(false);
      }
    },
    [editHookId, backToList, t],
  );

  const title = isNew ? t('agent.hooks.editor.newTitle') : t('agent.hooks.editor.editTitle');

  return (
    <div className="agent-hooks-view">
      <div className="unified-header">
        <div className="header-title">
          <button
            className="btn-action"
            onClick={handleCancel}
            title={t('common.back')}
            aria-label={t('agent.hooks.editor.backToHooks')}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="var(--color-warm-900)" />
            </svg>
          </button>
          <span className="header-name">{title}</span>
        </div>
        <div className="header-actions" />
      </div>

      <div className="agent-hooks-content">
        <div className="content-view-container hook-editor-view-body">
          <div className="toolbar-settings-content">
            <div className="toolbar-settings-form">
              <div className="toolbar-settings-form-inner">
          {loading ? (
            <p className="agent-hooks-loading">{t('agent.hooks.editor.loadingHook')}</p>
          ) : loadError ? (
            <p className="agent-hooks-error">{loadError}</p>
          ) : editing ? (
            <HookEditor
              initial={editing}
              saveError={saveError}
              busy={busy}
              isNew={isNew}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {applyHookTarget ? (
        <ApplyHookToAgentsDialog
          hookId={applyHookTarget.id}
          hookName={applyHookTarget.name}
          onClose={() => {
            const createdId = applyHookTarget.id;
            setApplyHookTarget(null);
            backToList(createdId);
          }}
        />
      ) : null}
    </div>
  );
};

export default HookEditorView;
