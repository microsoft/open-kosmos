import React from 'react';
import type { Companion, BuddyEntry } from '../../../main/lib/buddy/types';
import { RARITY_COLORS, RARITY_MAX_LEVEL } from '../../../main/lib/buddy/types';
import { xpToLevel } from '../../../main/lib/buddy/leveling';

interface Props {
  companion: Companion;
  activeBuddy?: BuddyEntry | null;
}

export const BuddyInfoPanel: React.FC<Props> = ({ companion, activeBuddy }) => {
  const color = RARITY_COLORS[companion.rarity];

  const level = activeBuddy ? Math.min(xpToLevel(activeBuddy.xp), RARITY_MAX_LEVEL[activeBuddy.rarity]) : 0;

  return (
    <div className="buddy-info">
      <div className="buddy-info-name" style={{ color }}>
        {companion.name}{activeBuddy ? ` Lv.${level}` : ''}
      </div>
    </div>
  );
};
