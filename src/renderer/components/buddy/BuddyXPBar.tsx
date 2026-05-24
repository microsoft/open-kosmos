import React, { useState, useEffect } from 'react';
import type { BuddyXPData, Milestone } from '../../../main/lib/buddy/types';
import { MILESTONES, RARITY_COLORS } from '../../../main/lib/buddy/types';

interface Props {
  xpData: BuddyXPData;
  rarityColor?: string;
}

export const BuddyXPBar: React.FC<Props> = ({ xpData, rarityColor }) => {
  const [showDelta, setShowDelta] = useState(false);
  const [lastGain, setLastGain] = useState(0);

  useEffect(() => {
    if (xpData.lastXPGain > 0 && xpData.lastXPGain !== lastGain) {
      setLastGain(xpData.lastXPGain);
      setShowDelta(true);
      const timer = setTimeout(() => setShowDelta(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [xpData.lastXPGain, lastGain]);

  const currentMilestone = getCurrentMilestone(xpData.totalXP);
  const nextMilestone = getNextMilestone(xpData.totalXP);
  const prevThreshold = currentMilestone?.threshold ?? 0;
  const nextThreshold = nextMilestone?.threshold ?? MILESTONES[MILESTONES.length - 1].threshold;

  const progress = nextThreshold > prevThreshold
    ? ((xpData.totalXP - prevThreshold) / (nextThreshold - prevThreshold)) * 100
    : 100;

  const fillColor = rarityColor ?? RARITY_COLORS.common;
  const milestoneLabel = currentMilestone?.name ?? 'Hatchling';

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8' }}>
        <span>{milestoneLabel}</span>
        <span>+{xpData.sessionXP.toLocaleString()} this session</span>
      </div>
      <div className="buddy-xp-bar">
        <div
          className="buddy-xp-bar-fill"
          style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: fillColor }}
        />
      </div>
      {showDelta && (
        <div className="buddy-xp-float">+{xpData.lastXPGain.toLocaleString()} XP</div>
      )}
    </div>
  );
};

function getCurrentMilestone(xp: number): Milestone | null {
  let current: Milestone | null = null;
  for (const m of MILESTONES) {
    if (xp >= m.threshold) current = m;
    else break;
  }
  return current;
}

function getNextMilestone(xp: number): Milestone | null {
  for (const m of MILESTONES) {
    if (xp < m.threshold) return m;
  }
  return null;
}
