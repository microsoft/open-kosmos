import React from 'react';

import { formatUnreadBadgeCount } from '../../lib/chat/useChatUnreadSummary';

interface UnreadCountBadgeProps {
  count: number;
  className?: string;
  ariaLabel?: string;
}

const UnreadCountBadge: React.FC<UnreadCountBadgeProps> = ({
  count,
  className = '',
  ariaLabel,
}) => {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className={`unread-count-badge ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {formatUnreadBadgeCount(count)}
    </span>
  );
};

export default UnreadCountBadge;