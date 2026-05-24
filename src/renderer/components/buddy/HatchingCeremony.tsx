import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CompanionCard } from './CompanionCard';
import type { Companion } from '../../../main/lib/buddy/types';

type Phase = 'wobble' | 'crack' | 'reveal';

const TICK_MS = 160;
const WOBBLE_FRAMES = 12;
const CRACK_FRAMES = 7;

const EGG_WOBBLE: string[][] = [
  ['   ___   ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', '  |    | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', ' |     | ', ' |    |  ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', '  |    | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['  ___    ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['    ___  ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', '  |    | ', '  |   |  ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['   ___   ', '  /   \\  ', ' |  *  | ', ' |     | ', '  \\___/  '],
];

const EGG_CRACK: string[][] = [
  ['   ___   ', '  / * \\  ', ' |     | ', ' |     | ', '  \\___/  '],
  ['   _*_   ', '  / * \\  ', ' |  *  | ', ' |     | ', '  \\___/  '],
  ['   _*_   ', '  /* *\\  ', ' | * * | ', ' |     | ', '  \\___/  '],
  ['   _*_   ', '  /* *\\  ', ' |* * *| ', ' | *   | ', '  \\___/  '],
  ['  _***_  ', '  /*  *\\  ', ' |** **| ', ' |* * *| ', '  \\*_*/  '],
  ['  _***_  ', ' //* *\\\\ ', ' |** **| ', ' |* * *| ', '  \\*_*/  '],
  ['  *****  ', ' //* *\\\\ ', '  ** **  ', '  * * *  ', '   ***   '],
];

interface Props {
  companion: Companion;
  onComplete: () => void;
}

export const HatchingCeremony: React.FC<Props> = ({ companion, onComplete }) => {
  const [phase, setPhase] = useState<Phase>('wobble');
  const [frameIndex, setFrameIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFrameIndex((prev) => {
        const next = prev + 1;
        if (phase === 'wobble' && next >= WOBBLE_FRAMES) {
          setPhase('crack');
          return 0;
        }
        if (phase === 'crack' && next >= CRACK_FRAMES) {
          setPhase('reveal');
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return next;
      });
    }, TICK_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [phase]);

  const handleClick = useCallback(() => {
    if (phase === 'reveal') onComplete();
  }, [phase, onComplete]);

  return (
    <div className="buddy-stats-overlay" onClick={handleClick} style={{ cursor: phase === 'reveal' ? 'pointer' : 'default' }}>
      <div className="buddy-stats-modal" style={{ textAlign: 'center', minWidth: '320px' }} onClick={(e) => e.stopPropagation()}>
        {phase === 'wobble' && (
          <div className="buddy-egg-wobble">
            <pre className="buddy-sprite" style={{ fontSize: '18px' }}>
              {EGG_WOBBLE[frameIndex % EGG_WOBBLE.length].join('\n')}
            </pre>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '16px' }}>Something is stirring...</p>
          </div>
        )}
        {phase === 'crack' && (
          <div className="buddy-egg-crack">
            <pre className="buddy-sprite" style={{ fontSize: '18px' }}>
              {EGG_CRACK[frameIndex % EGG_CRACK.length].join('\n')}
            </pre>
            <p style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '16px' }}>It's hatching!</p>
          </div>
        )}
        {phase === 'reveal' && (
          <div className="buddy-reveal">
            <CompanionCard companion={companion} />
            <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: '16px', cursor: 'pointer' }} onClick={onComplete}>
              Click anywhere to continue
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
