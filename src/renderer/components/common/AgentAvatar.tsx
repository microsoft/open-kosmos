import React from 'react';

interface AgentAvatarProps {
  /** Agent emoji */
  emoji?: string;
  /** Inert legacy avatar metadata retained for persisted-profile compatibility */
  avatar?: string;
  /** Agent source type */
  source?: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL';
  /** Agent name (used to generate initials as fallback) */
  name?: string;
  /** Avatar size */
  size?: 'sm' | 'md' | 'lg';
  /** Extra CSS class name */
  className?: string;
  /** Inert legacy version metadata retained for persisted-profile compatibility */
  version?: string;
}

/**
 * Generic component for rendering Agent avatars
 *
 * Persisted remote avatar metadata is intentionally ignored so rendering never
 * performs an implicit network request.
 */
export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  emoji = '🤖',
  name,
  size = 'md',
  className = ''
}) => {
  /**
   * Generate initials from name as fallback
   */
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * Return emoji text size style based on size prop
   */
  const getEmojiSizeStyles = (): string => {
    switch (size) {
      case 'sm':
        return 'text-xl';  // 20px
      case 'lg':
        return 'text-3xl'; // 30px
      case 'md':
      default:
        return 'text-2xl'; // 24px
    }
  };

  return (
    <span className={`inline-flex items-center justify-center shrink-0 ${getEmojiSizeStyles()} ${className}`}>
      {emoji || getInitials(name || 'AG')}
    </span>
  );
};

export default AgentAvatar;
