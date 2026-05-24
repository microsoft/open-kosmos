import React, { useEffect, useRef } from 'react';

interface Props {
  position: { x: number; y: number };
  muted: boolean;
  onPet: () => void;
  onStats: () => void;
  onOpenBackpack: () => void;
  onToggleMute: () => void;
  onHide: () => void;
  onClose: () => void;
}

/**
 * Calculate adjusted position so the menu doesn't overflow the viewport.
 * Uses the menu's known min-width and approximate height.
 */
function adjustMenuPosition(pos: { x: number; y: number }): { x: number; y: number } {
  const MENU_WIDTH = 160; // matches min-width in CSS
  const MENU_HEIGHT = 300; // approximate height for 8 items + separators
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;

  let x = pos.x;
  let y = pos.y;

  if (x + MENU_WIDTH > vw) x = Math.max(0, x - MENU_WIDTH);
  if (y + MENU_HEIGHT > vh) y = Math.max(0, y - MENU_HEIGHT);
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  return { x, y };
}

export const BuddyContextMenu: React.FC<Props> = ({
  position,
  muted,
  onPet,
  onStats,
  onOpenBackpack,
  onToggleMute,
  onHide,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const adjustedPos = adjustMenuPosition(position);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="buddy-context-menu" style={{ left: adjustedPos.x, top: adjustedPos.y }}>
      <div className="buddy-context-menu-item" onClick={onPet}>
        ❤️ Pet
      </div>
      <div className="buddy-context-menu-item" onClick={onStats}>
        📊 Stats
      </div>
      <div className="buddy-context-menu-separator" />
      <div className="buddy-context-menu-item" onClick={onOpenBackpack}>
        🎒 Open Backpack
      </div>
      <div className="buddy-context-menu-item" onClick={onToggleMute}>
        {muted ? '🔊 Unmute' : '🔇 Mute'}
      </div>
      <div className="buddy-context-menu-separator" />
      <div className="buddy-context-menu-item" onClick={onHide}>
        👁️ Hide
      </div>
    </div>
  );
};
