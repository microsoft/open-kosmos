import React from 'react';
import type { Companion, BuddyEntry } from '../../../main/lib/buddy/types';
import { ALL_STATS, RARITY_COLORS, RARITY_STARS, RARITY_MAX_LEVEL } from '../../../main/lib/buddy/types';
import { xpToLevel, levelToXP } from '../../../main/lib/buddy/leveling';
import { roll } from '../../../main/lib/buddy/companion';

interface Props {
  companion: Companion;
  activeBuddy?: BuddyEntry | null;
  onClose: () => void;
}

export const BuddyStatsModal: React.FC<Props> = ({ companion, activeBuddy, onClose }) => {
  const color = RARITY_COLORS[companion.rarity];
  const stars = RARITY_STARS[companion.rarity];

  // Level calculation
  const rarity = activeBuddy?.rarity ?? companion.rarity;
  const maxLevel = RARITY_MAX_LEVEL[rarity];
  const totalXP = activeBuddy?.xp ?? 0;
  const rawLevel = xpToLevel(totalXP);
  const level = Math.min(rawLevel, maxLevel);
  const isMaxLevel = level >= maxLevel;

  // XP progress toward next level
  const currentLevelXP = levelToXP(level);
  const nextLevelXP = level < 100 ? levelToXP(level + 1) : currentLevelXP;
  const xpIntoLevel = totalXP - currentLevelXP;
  const xpNeeded = nextLevelXP - currentLevelXP;
  const xpProgress = isMaxLevel ? 100 : xpNeeded > 0 ? (xpIntoLevel / xpNeeded) * 100 : 0;

  // Stat calculation: base + bonus
  const baseStats = activeBuddy ? roll(activeBuddy.seed).bones.stats : companion.stats;
  const statBonuses = activeBuddy?.statBonuses ?? ({} as Record<string, number>);

  return (
    <div className="buddy-stats-overlay" onClick={onClose}>
      <div className="buddy-stats-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header: name + rarity */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{ color: '#1e293b', fontSize: '16px', fontWeight: 'bold' }}>{companion.name}</div>
          <div style={{ color, fontSize: '13px', marginTop: '4px', fontWeight: 600 }}>
            {stars} {rarity.toUpperCase()} {companion.species}
          </div>
          <div style={{ color: '#64748b', fontSize: '11px', fontStyle: 'italic', marginTop: '2px' }}>
            {companion.personality}
          </div>
        </div>

        {/* Level display */}
        <div style={{ marginBottom: '16px', padding: '0 0 12px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600 }}>
            <span style={{ color: '#1e293b' }}>
              Lv.{level} / {maxLevel} {isMaxLevel ? '(MAX)' : ''}
            </span>
            <span style={{ color: '#64748b', fontSize: '11px' }}>
              {isMaxLevel
                ? `${totalXP.toLocaleString()} XP`
                : `${totalXP.toLocaleString()} / ${nextLevelXP.toLocaleString()} XP`}
            </span>
          </div>
          <div className="buddy-xp-bar" style={{ marginTop: '6px', height: '8px' }}>
            <div
              className="buddy-xp-bar-fill"
              style={{ width: `${Math.min(xpProgress, 100)}%`, backgroundColor: color }}
            />
          </div>
        </div>

        {/* Stat bars: base + bonus */}
        {ALL_STATS.map((stat) => {
          const base = baseStats[stat] ?? 0;
          const bonus = statBonuses[stat] ?? 0;
          const total = Math.min(100, base + bonus);
          return (
            <div key={stat} className="buddy-stat-row">
              <span className="buddy-stat-name">{stat}</span>
              <div className="buddy-stat-bar">
                <div className="buddy-stat-bar-fill" style={{ width: `${total}%`, backgroundColor: color }} />
              </div>
              <span className="buddy-stat-value">
                {total}
                {bonus > 0 ? ` (+${bonus})` : ''}
              </span>
            </div>
          );
        })}

        {/* Merge hint at max level */}
        {isMaxLevel && rarity !== 'legendary' && (
          <div
            style={{
              marginTop: '12px',
              padding: '8px 12px',
              backgroundColor: `${color}18`,
              border: `1px solid ${color}40`,
              borderRadius: '8px',
              fontSize: '11px',
              color: '#475569',
              textAlign: 'center',
            }}
          >
            ✨ Merge with a same-species {rarity} to evolve!
          </div>
        )}

        {/* Close button */}
        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button
            onClick={onClose}
            style={{
              background: '#334155',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 24px',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
