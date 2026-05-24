import React, { useState, useEffect, useRef } from 'react';
import { renderSprite, renderFace } from '../../../main/lib/buddy/sprites';
import type { CompanionBones } from '../../../main/lib/buddy/types';

const IDLE_SEQUENCE = [0, 0, 1, 0, 0, 2, 0, 0];
const TICK_MS = 500;
const BLINK_CHANCE = 0.08;

interface Props {
  bones: CompanionBones;
  minimized?: boolean;
  isPetting?: boolean;
  rarityColor?: string;
}

export const BuddySpriteDisplay: React.FC<Props> = ({ bones, minimized, isPetting, rarityColor }) => {
  const [seqIndex, setSeqIndex] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const tickRate = isPetting ? 150 : TICK_MS;
    intervalRef.current = setInterval(() => {
      setSeqIndex((prev) => (prev + 1) % IDLE_SEQUENCE.length);
      if (Math.random() < BLINK_CHANCE) {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 200);
      }
    }, tickRate);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPetting]);

  if (minimized) {
    return (
      <span className="buddy-sprite" style={{ fontSize: '16px', color: rarityColor }}>
        {renderFace(bones)}
      </span>
    );
  }

  const frame = isPetting ? seqIndex % 3 : IDLE_SEQUENCE[seqIndex];

  const lines = renderSprite(bones, frame);

  const displayLines = blinking ? lines.map((line) => line.replace(new RegExp(`\\${bones.eye}`, 'g'), '-')) : lines;

  return (
    <pre
      className={`buddy-sprite${bones.shiny ? ' shiny' : ''}`}
      style={rarityColor ? { color: rarityColor } : undefined}
    >
      {displayLines.join('\n')}
    </pre>
  );
};
