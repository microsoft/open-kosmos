/**
 * ChatZeroStates Component
 * Initial chat experience component - displays a greeting and quick-start cards
 */

import React from 'react';
import { ZeroStates, QuickStartItem } from '../../lib/userData/types';
import '../../styles/ChatZeroStates.css';

interface ChatZeroStatesProps {
  /** Zero States configuration */
  zeroStates: ZeroStates;
  /** Callback when a quick-start card is clicked */
  onQuickStartClick: (prompt: string) => void;
}

const QuickStartCard: React.FC<{
  item: QuickStartItem;
  onClick: () => void;
}> = ({ item, onClick }) => {
  return (
    <div
      className="quick-start-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="quick-start-card-title">{item.title}</div>
      <div className="quick-start-card-description">{item.description}</div>
    </div>
  );
};

/**
 * ChatZeroStates main component.
 * Displayed in the chat content area, above ChatInput.
 */
const ChatZeroStates: React.FC<ChatZeroStatesProps> = ({
  zeroStates,
  onQuickStartClick
}) => {
  const { greeting, quick_starts } = zeroStates;

  // If both greeting and quick_starts are empty, don't render
  const hasGreeting = greeting && greeting.trim().length > 0;
  const hasQuickStarts = quick_starts && quick_starts.length > 0;

  if (!hasGreeting && !hasQuickStarts) {
    return null;
  }

  return (
    <div className="chat-zero-states">
      {/* Greeting */}
      {hasGreeting && (
        <div className="chat-zero-states-greeting">
          {greeting}
        </div>
      )}

      {/* Quick Start List - horizontally scrollable list of cards */}
      {hasQuickStarts && (
        <div className="quick-start-list">
          {quick_starts!.map((item, index) => (
            <QuickStartCard
              key={`quick-start-${index}`}
              item={item}
              onClick={() => {
                onQuickStartClick(item.prompt);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatZeroStates;
