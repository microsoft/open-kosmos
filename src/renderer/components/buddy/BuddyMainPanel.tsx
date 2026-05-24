import React, { useState, useCallback, useRef } from 'react';
import { BuddyAtom } from './buddy.atom';
import type { BuddyEntry } from '../../../main/lib/buddy/types';
import { RARITY_COLORS, RARITY_STARS, MAX_ROSTER_SIZE, MILESTONES, RARITY_MAX_LEVEL } from '../../../main/lib/buddy/types';
import { validateMerge } from '../../../main/lib/buddy/merging';
import { roll } from '../../../main/lib/buddy/companion';
import { xpToLevel } from '../../../main/lib/buddy/leveling';
import { BuddySpriteDisplay } from './BuddySpriteDisplay';
import { BuddyPetEffect } from './BuddyPetEffect';
import { BuddyXPBar } from './BuddyXPBar';
import { BuddyCard } from './BuddyCard';
import { BuddyStatsModal } from './BuddyStatsModal';
import './BuddyMainPanel.css';

interface BuddyMainPanelProps {
  onHatchNew: () => void;
  onClose: () => void;
}

export const BuddyMainPanel: React.FC<BuddyMainPanelProps> = ({
  onHatchNew,
  onClose,
}) => {
  const [buddy, actions] = BuddyAtom.use();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statsBuddyId, setStatsBuddyId] = useState<string | null>(null);
  const [isPetting, setIsPetting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const petTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const activeBuddy = buddy.roster.find((b) => b.id === buddy.activeBuddyId) ?? null;
  const rarityColor = buddy.companion ? RARITY_COLORS[buddy.companion.rarity] : '#9ca3af';

  // --- Backpack interactions (migrated from BuddyCollectionPanel) ---
  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }, []);

  const handleActivate = useCallback(
    (id: string) => {
      if (id !== buddy.activeBuddyId) actions.setActiveBuddy(id);
    },
    [buddy],
  );

  const handleShowStats = useCallback((id: string) => {
    setStatsBuddyId(id);
  }, []);

  // Merge validation
  let mergeValid = false;
  let mergeError = '';
  if (selectedIds.length === 2) {
    const a = buddy.roster.find((b) => b.id === selectedIds[0]);
    const b2 = buddy.roster.find((b) => b.id === selectedIds[1]);
    if (a && b2) {
      const fwd = validateMerge(a, b2);
      const rev = validateMerge(b2, a);
      mergeValid = fwd.valid || rev.valid;
      if (!mergeValid) mergeError = fwd.error ?? rev.error ?? '';
    }
  }

  const handleMergeClick = useCallback(() => {
    if (selectedIds.length !== 2) return;
    const a = buddy.roster.find((b) => b.id === selectedIds[0]);
    const b2 = buddy.roster.find((b) => b.id === selectedIds[1]);
    if (!a || !b2) return;

    const aKeep = validateMerge(a, b2).valid;
    const bKeep = validateMerge(b2, a).valid;

    let keepId: string, deleteId: string, keepName: string, deleteName: string;
    if (aKeep) {
      keepId = a.id; deleteId = b2.id; keepName = a.soul.name; deleteName = b2.soul.name;
    } else if (bKeep) {
      keepId = b2.id; deleteId = a.id; keepName = b2.soul.name; deleteName = a.soul.name;
    } else return;

    if (window.confirm(`Merge ${deleteName} into ${keepName}?\n${deleteName} will be deleted forever.\n${keepName} will upgrade rarity.`)) {
      actions.mergeBuddies(keepId, deleteId);
      setSelectedIds([]);
    }
  }, [selectedIds, buddy]);

  const handleRelease = useCallback(
    (id: string) => {
      const entry = buddy.roster.find((b) => b.id === id);
      if (!entry) return;
      if (id === buddy.activeBuddyId) {
        window.alert('Cannot release the active buddy!');
        return;
      }
      if (window.confirm(`Release ${entry.soul.name}? This cannot be undone.`)) {
        actions.releaseBuddy(id);
        setSelectedIds((prev) => prev.filter((x) => x !== id));
      }
    },
    [buddy],
  );

  const handlePet = useCallback(() => {
    setIsPetting(true);
    actions.pet();
    if (petTimerRef.current) clearTimeout(petTimerRef.current);
    petTimerRef.current = setTimeout(() => setIsPetting(false), 2500);
  }, [buddy]);

  const handleRename = useCallback(() => {
    setRenameValue(buddy.companion?.name ?? '');
    setIsRenaming(true);
  }, [buddy]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed.length <= 14) {
      actions.rename(trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, buddy]);

  // Milestone helpers
  const getCurrentMilestone = (xp: number) => {
    for (let i = MILESTONES.length - 1; i >= 0; i--) {
      if (xp >= MILESTONES[i].threshold) return MILESTONES[i];
    }
    return null;
  };

  const getNextMilestone = (xp: number) => {
    for (const m of MILESTONES) {
      if (xp < m.threshold) return m;
    }
    return null;
  };

  const currentMilestone = getCurrentMilestone(buddy.userTotalTokens);
  const nextMilestone = getNextMilestone(buddy.userTotalTokens);
  const milestoneProgress = nextMilestone
    ? ((buddy.userTotalTokens - (currentMilestone?.threshold ?? 0)) /
       (nextMilestone.threshold - (currentMilestone?.threshold ?? 0))) * 100
    : 100;

  return (
    <div className="buddy-main-overlay" onClick={onClose}>
      <div className="buddy-main-panel" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="buddy-main-header">
          <h2>🎒 Backpack</h2>
          <button className="buddy-main-close" onClick={onClose}>✕</button>
        </div>

        {/* Section 1: Player Info */}
        {buddy.companion && activeBuddy && (
          <div className="buddy-main-player">
            <div className="buddy-main-player-sprite" style={{ position: 'relative' }}>
              <BuddySpriteDisplay
                bones={buddy.companion}
                minimized={false}
                isPetting={isPetting}
                rarityColor={rarityColor}
              />
              {isPetting && <BuddyPetEffect />}
            </div>
            <div className="buddy-main-player-info">
              <div className="buddy-main-player-name-row">
                {isRenaming ? (
                  <input
                    className="buddy-main-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit();
                      if (e.key === 'Escape') setIsRenaming(false);
                    }}
                    onBlur={handleRenameSubmit}
                    maxLength={14}
                    autoFocus
                  />
                ) : (
                  <span className="buddy-main-player-name">{buddy.companion.name}</span>
                )}
                <span
                  className="buddy-main-player-rarity"
                  style={{ color: rarityColor, border: `1px solid ${rarityColor}` }}
                >
                  {RARITY_STARS[buddy.companion.rarity]}
                </span>
              </div>
              <div className="buddy-main-player-level">
                Lv. {xpToLevel(activeBuddy.xp)} · {buddy.companion.species}
              </div>
              {buddy.xpData && (
                <div className="buddy-main-player-xp">
                  <BuddyXPBar xpData={buddy.xpData} rarityColor={rarityColor} />
                </div>
              )}
              <div className="buddy-main-player-personality">
                &ldquo;{buddy.companion.personality}&rdquo;
              </div>
              <div className="buddy-main-player-actions">
                <button className="buddy-main-action-btn" onClick={handlePet}>❤️ Pet</button>
                <button className="buddy-main-action-btn" onClick={handleRename}>✏️ Rename</button>
                <button className="buddy-main-action-btn" onClick={() => setStatsBuddyId(buddy.activeBuddyId)}>📊 Stats</button>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Backpack Grid */}
        <div className="buddy-main-backpack">
          <div className="buddy-main-backpack-header">
            <span className="buddy-main-backpack-title">Collection</span>
            <span className="buddy-main-backpack-count">{buddy.roster.length}/{MAX_ROSTER_SIZE}</span>
          </div>
          <div className="buddy-card-grid">
            {buddy.roster.map((entry) => (
              <BuddyCard
                key={entry.id}
                entry={entry}
                isActive={entry.id === buddy.activeBuddyId}
                isSelected={selectedIds.includes(entry.id)}
                onActivate={handleActivate}
                onSelect={handleSelect}
                onShowStats={handleShowStats}
              />
            ))}
          </div>
          <div className="buddy-main-backpack-actions">
            <button className="buddy-main-backpack-btn" onClick={onHatchNew}>🥚 Hatch New</button>
            <button
              className="buddy-main-backpack-btn"
              disabled={!mergeValid}
              onClick={handleMergeClick}
              title={mergeError || 'Select 2 same-species same-rarity buddies'}
            >
              🔮 Merge
            </button>
            {selectedIds.length === 1 && selectedIds[0] !== buddy.activeBuddyId && (
              <button
                className="buddy-main-backpack-btn buddy-main-backpack-btn-danger"
                onClick={() => handleRelease(selectedIds[0])}
              >
                Release
              </button>
            )}
          </div>
          <div className="buddy-main-backpack-tip">
            {selectedIds.length === 0 && 'Click to activate · Shift-click to select for merge'}
            {selectedIds.length === 1 && 'Shift-click one more buddy to merge'}
            {selectedIds.length === 2 && !mergeValid && mergeError}
            {selectedIds.length === 2 && mergeValid && 'Ready to merge!'}
          </div>
        </div>

        {/* Section 3: Stats */}
        <div className="buddy-main-stats">
          <div className="buddy-main-stats-row">
            <span className="buddy-main-stats-label">Total Tokens Used</span>
            <span className="buddy-main-stats-value">{buddy.userTotalTokens.toLocaleString()}</span>
          </div>
          <div className="buddy-main-stats-row">
            <span className="buddy-main-stats-label">Milestone</span>
            <span className="buddy-main-stats-label">
              {currentMilestone?.name ?? 'Newcomer'} → {nextMilestone?.name ?? 'Max'}
            </span>
          </div>
          <div className="buddy-main-milestone-bar">
            <div
              className="buddy-main-milestone-fill"
              style={{ width: `${Math.min(milestoneProgress, 100)}%`, backgroundColor: rarityColor }}
            />
          </div>
          <div className="buddy-main-milestone-labels">
            <span>{currentMilestone?.name ?? 'Start'}</span>
            <span>{nextMilestone ? `${nextMilestone.threshold.toLocaleString()} tokens` : 'Complete!'}</span>
          </div>
          <div className="buddy-main-coming-soon">
            📊 Usage Analytics — Coming Soon
          </div>
        </div>
      </div>

      {/* Stats modal for selected buddy */}
      {statsBuddyId &&
        (() => {
          const entry = buddy.roster.find((b) => b.id === statsBuddyId);
          if (!entry) return null;
          const rolled = roll(entry.seed);
          const companion = {
            ...rolled.bones,
            rarity: entry.rarity,
            stats: { ...rolled.bones.stats },
            name: entry.soul.name,
            personality: entry.soul.personality,
            hatchedAt: entry.soul.hatchedAt,
          };
          return <BuddyStatsModal companion={companion} activeBuddy={entry} onClose={() => setStatsBuddyId(null)} />;
        })()}
    </div>
  );
};
