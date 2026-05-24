import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { BuddyState, BuddyActions } from './buddy.atom';
import { BuddySpriteDisplay } from './BuddySpriteDisplay';
import { BuddyInfoPanel } from './BuddyInfoPanel';
import { BuddySpeechBubble } from './BuddySpeechBubble';
import { BuddyPetEffect } from './BuddyPetEffect';
import { BuddyMilestoneEffect } from './BuddyMilestoneEffect';
import { BuddyContextMenu } from './BuddyContextMenu';
import { BuddyStatsModal } from './BuddyStatsModal';
import { RARITY_COLORS } from '../../../main/lib/buddy/types';
import './buddy.css';

const PET_ANIMATION_DURATION = 2500;
const LEVEL_UP_DISMISS_MS = 3000;
const EDGE_SNAP_DISTANCE = -2; // negative = must overflow past border by 2px to dock

type DockEdge = 'right' | 'left' | 'top' | 'bottom' | null;

export interface BuddyFloatingWidgetProps {
  buddy: BuddyState;
  actions: BuddyActions;
}

export const BuddyFloatingWidget: React.FC<BuddyFloatingWidgetProps> = ({ buddy, actions }) => {

  const [position, setPosition] = useState(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth - 140 : 100,
    y: typeof window !== 'undefined' ? window.innerHeight - 200 : 100,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Dock state
  const [dockEdge, setDockEdge] = useState<DockEdge>(null);
  const [isPeeking, setIsPeeking] = useState(false);

  // UI state
  const [isPetting, setIsPetting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showStats, setShowStats] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const petTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const isDocked = dockEdge !== null;

  // V2: Find active buddy from roster
  const activeBuddy = buddy.roster.find((b) => b.id === buddy.activeBuddyId) ?? null;
  const rarityColor = buddy.companion ? RARITY_COLORS[buddy.companion.rarity] : '#9ca3af';

  // V2: Level-up auto-dismiss after 3 seconds
  const { dismissLevelUp } = actions;
  useEffect(() => {
    if (!buddy.levelUp) return;
    const timer = setTimeout(() => {
      dismissLevelUp();
    }, LEVEL_UP_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [buddy.levelUp, dismissLevelUp]);

  // --- Drag handling ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // NOTE: Do NOT call e.preventDefault() here — it kills focus on other elements (textarea etc.)
      e.stopPropagation();
      const rect = widgetRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setIsDragging(true);
      // Un-dock when starting a drag
      if (isDocked) {
        setDockEdge(null);
        setIsPeeking(false);
      }
    },
    [isDocked],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);

      // Check if widget is near any edge → dock
      const el = widgetRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Check each edge — dock only when widget overflows past the border
      const distRight = vw - rect.right;
      const distLeft = rect.left;
      const distBottom = vh - rect.bottom;
      const distTop = rect.top;

      // EDGE_SNAP_DISTANCE is negative: dist must be < -2, meaning widget is 2px past the edge
      if (distRight <= EDGE_SNAP_DISTANCE) {
        setDockEdge('right');
        setIsPeeking(false);
        // Keep vertical position, snap horizontal to right edge
        setPosition((prev) => ({ x: vw - 6, y: Math.max(0, Math.min(prev.y, vh - 40)) }));
      } else if (distLeft <= EDGE_SNAP_DISTANCE) {
        setDockEdge('left');
        setIsPeeking(false);
        setPosition((prev) => ({ x: 0, y: Math.max(0, Math.min(prev.y, vh - 40)) }));
      } else if (distBottom <= EDGE_SNAP_DISTANCE) {
        setDockEdge('bottom');
        setIsPeeking(false);
        setPosition((prev) => ({ x: Math.max(0, Math.min(prev.x, vw - 40)), y: vh - 6 }));
      } else if (distTop <= EDGE_SNAP_DISTANCE) {
        setDockEdge('top');
        setIsPeeking(false);
        setPosition((prev) => ({ x: Math.max(0, Math.min(prev.x, vw - 40)), y: 0 }));
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // --- Docked hover behavior ---
  const handleMouseEnter = useCallback(() => {
    if (isDocked) setIsPeeking(true);
  }, [isDocked]);

  const handleMouseLeave = useCallback(() => {
    if (isDocked) setIsPeeking(false);
  }, [isDocked]);

  // --- Double-click to toggle minimize / un-dock ---
  const handleDoubleClick = useCallback(() => {
    if (isDocked) {
      setDockEdge(null);
      setIsPeeking(false);
      setPosition({
        x: window.innerWidth - 140,
        y: window.innerHeight - 200,
      });
      return;
    }
    actions.setMinimized(!buddy.minimized);
  }, [buddy, isDocked]);

  // --- Right-click context menu ---
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // --- Pet action ---
  const handlePet = useCallback(() => {
    setContextMenu(null);
    setIsPetting(true);
    actions.pet();
    if (petTimerRef.current) clearTimeout(petTimerRef.current);
    petTimerRef.current = setTimeout(() => setIsPetting(false), PET_ANIMATION_DURATION);
  }, [buddy]);

  useEffect(() => {
    return () => {
      if (petTimerRef.current) clearTimeout(petTimerRef.current);
    };
  }, []);

  // --- Context menu actions ---
  const handleStats = useCallback(() => {
    setContextMenu(null);
    setShowStats(true);
  }, []);

  const handleOpenBackpack = useCallback(() => {
    setContextMenu(null);
    actions.setShowMainPanel(true);
  }, [buddy]);

  const handleToggleMute = useCallback(() => {
    setContextMenu(null);
    actions.setMuted(!buddy.muted);
  }, [buddy]);

  const handleHide = useCallback(() => {
    setContextMenu(null);
    actions.setHidden(true);
  }, [buddy]);

  // Don't render if hidden or loading
  // Don't render if hidden, loading, or no companion (hatch via /buddy command)
  if (buddy.hidden || buddy.loading || !buddy.companion) return null;

  // Build CSS classes
  const widgetClasses = [
    'buddy-widget',
    isDragging ? 'dragging' : '',
    isDocked ? 'docked' : '',
    isDocked && isPeeking ? 'peeking' : '',
    dockEdge ? `dock-${dockEdge}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // --- Compute dock inline style (only sets the axis NOT controlled by CSS) ---
  const getDockStyle = (): React.CSSProperties => {
    if (dockEdge === 'right' || dockEdge === 'left') {
      // CSS handles horizontal (right:0 or left:0), we set vertical
      return { top: position.y, bottom: 'auto' };
    }
    if (dockEdge === 'top' || dockEdge === 'bottom') {
      // CSS handles vertical (top:0 or bottom:0), we set horizontal
      return { left: position.x, right: 'auto' };
    }
    return { left: position.x, top: position.y, bottom: 'auto', right: 'auto' };
  };

  // V2: Build speech bubble text (level-up takes priority over reaction)
  const speechText = buddy.levelUp
    ? `Level ${buddy.levelUp.level}! +1 ${buddy.levelUp.statGained}`
    : buddy.reaction?.text ?? null;

  // --- Render docked state: thick colored tab + hover zone ---
  if (isDocked && !isPeeking) {
    return (
      <div
        ref={widgetRef}
        className={widgetClasses}
        style={getDockStyle()}
        onMouseDown={handleMouseDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        <div className="buddy-dock-tab" style={{ backgroundColor: rarityColor }} />
        <div className="buddy-dock-zone" />

        {contextMenu && buddy.companion && (
          <BuddyContextMenu
            position={contextMenu}
            muted={buddy.muted}
            onPet={handlePet}

            onStats={handleStats}
            onOpenBackpack={handleOpenBackpack}
            onToggleMute={handleToggleMute}
            onHide={handleHide}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  }

  // --- Render peeking state (hovering near dock tab): show face ---
  if (isDocked && isPeeking) {
    return (
      <>
        <div
          ref={widgetRef}
          className={widgetClasses}
          style={getDockStyle()}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
        >
          {buddy.companion && (
            <BuddySpriteDisplay bones={buddy.companion} minimized={true} isPetting={false} rarityColor={rarityColor} />
          )}
        </div>

        {contextMenu && buddy.companion && (
          <BuddyContextMenu
            position={contextMenu}
            muted={buddy.muted}
            onPet={handlePet}

            onStats={handleStats}
            onOpenBackpack={handleOpenBackpack}
            onToggleMute={handleToggleMute}
            onHide={handleHide}
            onClose={() => setContextMenu(null)}
          />
        )}
      </>
    );
  }

  // --- Normal (undocked) render ---
  return (
    <>
      <div
        ref={widgetRef}
        className={widgetClasses}
        style={{ left: position.x, top: position.y, bottom: 'auto', right: 'auto' }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Speech bubble — level-up or reaction */}
        {speechText && !buddy.muted && (
          <BuddySpeechBubble
            text={speechText}
            onDismiss={buddy.levelUp ? actions.dismissLevelUp : actions.dismissReaction}
          />
        )}

        {/* Level-up toast */}
        {buddy.levelUp && (
          <div className="buddy-levelup-toast">
            Level {buddy.levelUp.level}!
          </div>
        )}

        {/* Pet hearts */}
        {isPetting && <BuddyPetEffect />}

        {/* Milestone sparkles */}
        {buddy.milestone && <BuddyMilestoneEffect onComplete={actions.dismissMilestone} />}

        {/* Main display */}
        <BuddySpriteDisplay
          bones={buddy.companion}
          minimized={buddy.minimized}
          isPetting={isPetting}
          rarityColor={rarityColor}
        />
        {!buddy.minimized && <BuddyInfoPanel companion={buddy.companion} activeBuddy={activeBuddy} />}
      </div>

      {/* Context menu */}
      {contextMenu && buddy.companion && (
        <BuddyContextMenu
          position={contextMenu}
          muted={buddy.muted}
          onPet={handlePet}
          onStats={handleStats}
          onOpenBackpack={handleOpenBackpack}
          onToggleMute={handleToggleMute}
          onHide={handleHide}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Stats modal */}
      {showStats && buddy.companion && (
        <BuddyStatsModal companion={buddy.companion} activeBuddy={activeBuddy} onClose={() => setShowStats(false)} />
      )}
    </>
  );
};
