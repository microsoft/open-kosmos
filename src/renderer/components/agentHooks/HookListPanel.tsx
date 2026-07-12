import React, { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { HookDefinition } from '@shared/ipc/agentHooks';
import ListSearchBox from '../ui/ListSearchBox';
import { useAutoHideScrollbar } from '../../lib/hooks/useAutoHideScrollbar';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/AgentHooks.css';

interface HookListPanelProps {
  hooks: HookDefinition[];
  selectedHookId: string | null;
  onSelect: (hook: HookDefinition) => void;
  onMenuToggle: (hookId: string, buttonElement: HTMLElement) => void;
}

const HookListPanel: React.FC<HookListPanelProps> = ({
  hooks,
  selectedHookId,
  onSelect,
  onMenuToggle,
}) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useAutoHideScrollbar<HTMLDivElement>();

  const filteredHooks = searchQuery
    ? hooks.filter(hook => hook.name.includes(searchQuery))
    : hooks;

  // Stable identity for the filtered list so the selection-sync effect reacts to
  // content changes, not just length changes.
  const filteredIdentity = useMemo(
    () => filteredHooks.map(hook => hook.id).join('\0'),
    [filteredHooks],
  );

  // Keep the selection valid against the filtered results, aligned with the
  // MCP / Skills list panels: select the first visible hook when nothing is
  // selected or the current selection has been filtered out.
  useEffect(() => {
    if (filteredHooks.length === 0) return;
    if (!selectedHookId) {
      onSelect(filteredHooks[0]);
      return;
    }
    if (!filteredHooks.some(hook => hook.id === selectedHookId)) {
      onSelect(filteredHooks[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, filteredIdentity, selectedHookId]);

  return (
    <>
      {hooks.length > 0 && (
        <ListSearchBox
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('agent.hooks.searchPlaceholder')}
        />
      )}
      <div className="hook-list" ref={scrollRef}>
        {hooks.length === 0 ? (
          <p className="agent-hooks-empty">{t('agent.hooks.noHooks')}</p>
        ) : filteredHooks.length === 0 ? (
          <p className="agent-hooks-empty">{t('agent.hooks.noSearchResults')}</p>
        ) : (
          <ul className="hook-cards">
            {filteredHooks.map(hook => (
              <li
                key={hook.id}
                className={`hook-card${hook.id === selectedHookId ? ' is-selected' : ''}`}
                data-testid="hook-row"
              >
                <div className="hook-card-header">
                  <button
                    type="button"
                    className="hook-card-select"
                    onClick={() => onSelect(hook)}
                    aria-label={t('agent.hooks.selectHook', { name: hook.name })}
                  >
                    <div className="hook-name-group">
                      <div className="hook-title-row">
                        <span className="hook-card-name">{hook.name}</span>
                      </div>
                      <div className="hook-meta-group">
                        {hook.version ? <span className="hook-version-badge">v{hook.version}</span> : null}
                        {hook.source ? <span className="hook-source-badge">{hook.source}</span> : null}
                        <span className={`hook-status ${hook.enabled ? 'enabled' : 'disabled'}`}>
                          {hook.enabled ? t('agent.hooks.enabledStatus') : t('agent.hooks.disabledStatus')}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="hook-card-menu"
                    data-hook-menu-trigger="true"
                    aria-label={t('agent.hooks.optionsFor', { name: hook.name })}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      onMenuToggle(hook.id, e.currentTarget);
                    }}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
};

export default HookListPanel;
