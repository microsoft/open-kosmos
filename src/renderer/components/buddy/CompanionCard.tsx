import React from 'react';
import { renderSprite } from '../../../main/lib/buddy/sprites';
import type { Companion } from '../../../main/lib/buddy/types';
import { RARITY_STARS, RARITY_COLORS, ALL_STATS } from '../../../main/lib/buddy/types';

interface Props {
  companion: Companion;
}

export const CompanionCard: React.FC<Props> = ({ companion }) => {
  const stars = RARITY_STARS[companion.rarity];
  const color = RARITY_COLORS[companion.rarity];
  const sprite = renderSprite(companion, 0);

  return (
    <div
      style={{
        background: '#0f172a',
        border: `2px solid ${color}`,
        borderRadius: '16px',
        padding: '20px',
        textAlign: 'center',
        minWidth: '240px',
      }}
    >
      <div style={{ color, fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', textTransform: 'uppercase' }}>
        {stars} {companion.rarity} {stars}
      </div>
      <pre className={`buddy-sprite${companion.shiny ? ' shiny' : ''}`} style={{ fontSize: '16px', color }}>
        {sprite.join('\n')}
      </pre>
      <div style={{ marginTop: '12px' }}>
        <div style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: 'bold' }}>{companion.name}</div>
        <div style={{ color, fontSize: '13px', fontWeight: 600, marginTop: '4px', textTransform: 'capitalize' }}>
          {companion.species}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '12px', fontStyle: 'italic', marginTop: '4px' }}>
          {companion.personality}
        </div>
      </div>
      <div style={{ marginTop: '16px', textAlign: 'left' }}>
        {ALL_STATS.map((stat) => (
          <div key={stat} className="buddy-stat-row">
            <span className="buddy-stat-name">{stat}</span>
            <div className="buddy-stat-bar">
              <div
                className="buddy-stat-bar-fill"
                style={{ width: `${companion.stats[stat]}%`, backgroundColor: color }}
              />
            </div>
            <span className="buddy-stat-value">{companion.stats[stat]}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '12px' }}>
        <div className="buddy-xp-bar">
          <div className="buddy-xp-bar-fill" style={{ width: '0%', backgroundColor: color }} />
        </div>
        <div style={{ color: '#64748b', fontSize: '10px', marginTop: '4px' }}>Hatchling — 0 XP</div>
      </div>
    </div>
  );
};
