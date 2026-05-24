import React from 'react';

export const BuddyPetEffect: React.FC = () => {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="buddy-heart">❤️</span>
      ))}
    </div>
  );
};
