import React, { useLayoutEffect } from 'react';
import { Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import type { HookDefinition } from '@shared/ipc/agentHooks';
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/DropdownMenu.css';

interface HookDropdownMenuProps {
  hookMenuRef: React.RefObject<HTMLDivElement>;
  hook: HookDefinition;
  position: AnchoredDropdownPosition;
  onToggleEnable: (hook: HookDefinition) => void;
  onEdit: (hook: HookDefinition) => void;
  onDelete: (hook: HookDefinition) => void;
  onClose: () => void;
}

const HookDropdownMenu: React.FC<HookDropdownMenuProps> = ({
  hookMenuRef,
  hook,
  position,
  onToggleEnable,
  onEdit,
  onDelete,
  onClose,
}) => {
  const { t } = useI18n();
  useLayoutEffect(() => {
    adjustAnchoredDropdownToViewport(hookMenuRef.current!, position);
  }, [position]);

  const run = (handler: (hook: HookDefinition) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    handler(hook);
    onClose();
  };

  return (
    <div
      ref={hookMenuRef}
      className="dropdown-menu hook-dropdown-menu"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      role="menu"
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        className="dropdown-menu-item"
        onClick={run(onToggleEnable)}
        role="menuitem"
        aria-label={hook.enabled ? t('agent.hooks.disableHookAria', { name: hook.name }) : t('agent.hooks.enableHookAria', { name: hook.name })}
      >
        <span className="dropdown-menu-item-icon">
          {hook.enabled ? <PowerOff size={16} strokeWidth={1.5} /> : <Power size={16} strokeWidth={1.5} />}
        </span>
        <span className="dropdown-menu-item-text">{hook.enabled ? t('agent.hooks.disableHook') : t('agent.hooks.enableHookAction')}</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={run(onEdit)}
        role="menuitem"
        aria-label={t('agent.hooks.editHookAria', { name: hook.name })}
      >
        <span className="dropdown-menu-item-icon"><Pencil size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{t('common.edit')}</span>
      </button>
      <button
        className="dropdown-menu-item danger"
        onClick={run(onDelete)}
        role="menuitem"
        aria-label={t('agent.hooks.deleteHookAria', { name: hook.name })}
      >
        <span className="dropdown-menu-item-icon"><Trash2 size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{t('common.delete')}</span>
      </button>
    </div>
  );
};

export default HookDropdownMenu;
