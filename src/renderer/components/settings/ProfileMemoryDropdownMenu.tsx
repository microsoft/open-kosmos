import React, { useLayoutEffect } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import type { CardSummary } from '@shared/types/memexTypes';
import {
  adjustAnchoredDropdownToViewport,
  AnchoredDropdownPosition,
} from '../../lib/utilities/dropdownPosition';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/DropdownMenu.css';

interface ProfileMemoryDropdownMenuProps {
  menuRef: React.RefObject<HTMLDivElement>;
  card: CardSummary;
  position: AnchoredDropdownPosition;
  onArchive: (card: CardSummary) => void;
  onDelete: (card: CardSummary) => void;
  onClose: () => void;
}

const ProfileMemoryDropdownMenu: React.FC<ProfileMemoryDropdownMenuProps> = ({
  menuRef,
  card,
  position,
  onArchive,
  onDelete,
  onClose,
}) => {
  const { t } = useI18n();

  useLayoutEffect(() => {
    adjustAnchoredDropdownToViewport(menuRef.current!, position);
  }, [menuRef, position]);

  const run = (handler: (card: CardSummary) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    handler(card);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="dropdown-menu profile-memory-dropdown-menu"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      role="menu"
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        className="dropdown-menu-item"
        onClick={run(onArchive)}
        role="menuitem"
        aria-label={t('profileMemory.archiveAria', { name: card.title || card.slug })}
      >
        <span className="dropdown-menu-item-icon"><Archive size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{t('profileMemory.archive')}</span>
      </button>
      <button
        className="dropdown-menu-item danger"
        onClick={run(onDelete)}
        role="menuitem"
        aria-label={t('profileMemory.deleteAria', { name: card.title || card.slug })}
      >
        <span className="dropdown-menu-item-icon"><Trash2 size={16} strokeWidth={1.5} /></span>
        <span className="dropdown-menu-item-text">{t('profileMemory.delete')}</span>
      </button>
    </div>
  );
};

export default ProfileMemoryDropdownMenu;
