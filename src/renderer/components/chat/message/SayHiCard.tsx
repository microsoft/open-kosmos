/**
 * SayHiCard – generic single-card component for say-hi / onboarding UX.
 *
 * Renders one action card with an emoji icon, a bold title, and a muted
 * description line.  All interaction logic (what happens on click) is left
 * to the caller via the `onClick` prop, keeping this component fully reusable.
 *
 * Usage example:
 *   <SayHiCard
 *     emoji="💬"
 *     title="Summarize recent activity"
 *     description="Summarize the latest status and add as context."
 *     onClick={() => sendMessage('Summarize ...')}
 *   />
 */

import React from 'react';
import '../../../styles/SayHiCard.css';

export interface SayHiCardProps {
  /** Emoji displayed inside the icon box. */
  emoji: string;
  /** Bold card title. */
  title: string;
  /** Muted one-line description shown below the title. */
  description: string;
  /** Called when the card is clicked or activated via keyboard. */
  onClick: () => void;
}

const SayHiCard: React.FC<SayHiCardProps> = ({ emoji, title, description, onClick }) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className="say-hi-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="say-hi-card-icon">
        <span>{emoji}</span>
      </div>
      <div className="say-hi-card-content">
        <h4 className="say-hi-card-title">{title}</h4>
        <p className="say-hi-card-description">{description}</p>
      </div>
    </div>
  );
};

export default SayHiCard;
