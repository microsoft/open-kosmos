import React from 'react';
import type { BuddyEntry } from '../../../main/lib/buddy/types';
import { RARITY_COLORS, RARITY_MAX_LEVEL } from '../../../main/lib/buddy/types';
import { roll } from '../../../main/lib/buddy/companion';
import { renderFace } from '../../../main/lib/buddy/sprites';
import { xpToLevel } from '../../../main/lib/buddy/leveling';

interface Props {
  entry: BuddyEntry;
  isActive: boolean;
  isSelected: boolean;
  onActivate: (id: string) => void;
  onSelect: (id: string) => void;
  onShowStats?: (id: string) => void;
}

export const BuddyCard: React.FC<Props> = ({ entry, isActive, isSelected, onActivate, onSelect, onShowStats }) => {
  const bones = roll(entry.seed).bones;
  const color = RARITY_COLORS[entry.rarity];
  const level = Math.min(xpToLevel(entry.xp), RARITY_MAX_LEVEL[entry.rarity]);
  const face = renderFace(bones);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onSelect(entry.id);
    } else {
      onActivate(entry.id);
    }
  };

  const handleDoubleClick = () => {
    onShowStats?.(entry.id);
  };

  return (
    <div
      className={`buddy-card ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
      style={{ borderColor: color }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <pre className="buddy-card-face" style={{ color }}>
        {face}
      </pre>
      <div className="buddy-card-name">{entry.soul.name}</div>
      <div className="buddy-card-level">Lv.{level}</div>
      <div className="buddy-card-species" style={{ color }}>
        {bones.species}
      </div>
      {isActive && <div className="buddy-card-active-badge">ACTIVE</div>}
    </div>
  );
};
