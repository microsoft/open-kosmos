import React, { useEffect } from 'react';

interface Props {
  onComplete: () => void;
}

export const BuddyMilestoneEffect: React.FC<Props> = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {['✨', '⭐', '✨', '💫', '⭐'].map((sparkle, i) => (
        <span
          key={i}
          className="buddy-sparkle"
          style={{
            left: `${15 + i * 18}%`,
            top: `${10 + (i % 3) * 20}%`,
            animationDelay: `${i * 0.12}s`,
          }}
        >
          {sparkle}
        </span>
      ))}
    </div>
  );
};
