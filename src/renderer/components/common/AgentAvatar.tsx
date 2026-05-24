import React, { useState, useMemo } from 'react';

interface AgentAvatarProps {
  /** Agent emoji */
  emoji?: string;
  /** Agent avatar URL */
  avatar?: string;
  /** Agent source type */
  source?: 'ON-DEVICE' | 'EXTERNAL';
  /** Agent name (used to generate initials as fallback) */
  name?: string;
  /** Avatar size */
  size?: 'sm' | 'md' | 'lg';
  /** Extra CSS class name */
  className?: string;
  /** Agent version (used for cache busting, ensures latest image is fetched on version update) */
  version?: string;
}

/**
 * Generic component for rendering Agent avatars
 *
 * Rendering rules:
 * - ON-DEVICE agent: render emoji only
 * - EXTERNAL agent: prefer avatar (image), fall back to emoji if empty or failed to load
 */
export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  emoji = '🤖',
  avatar,
  source,
  name,
  size = 'md',
  className = '',
  version
}) => {
  const [imageError, setImageError] = useState(false);

  /**
   * Generate avatar URL with version parameter (for cache busting)
   * When agent version updates, the URL parameter changes so the browser fetches the latest image
   */
  const avatarUrlWithVersion = useMemo(() => {
    if (!avatar) return avatar;
    if (!version) return avatar;

    const separator = avatar.includes('?') ? '&' : '?';
    return `${avatar}${separator}_v=${encodeURIComponent(version)}`;
  }, [avatar, version]);

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
   * Return image/container pixel size based on size prop
   */
  const getPixelSize = (): number => {
    switch (size) {
      case 'sm':
        return 20;  // Match emoji text size
      case 'lg':
        return 32;
      case 'md':
      default:
        return 24;
    }
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

  // Determine whether to render the avatar image
  // Only render image when avatar exists and image hasn't errored
  const shouldRenderAvatar = avatar && !imageError;

  const pixelSize = getPixelSize();

  if (shouldRenderAvatar) {
    return (
      <img
        src={avatarUrlWithVersion}
        alt={name || 'Agent Avatar'}
        style={{ width: pixelSize, height: pixelSize }}
        className={`agent-avatar-img object-contain shrink-0 ${className}`}
        onError={() => setImageError(true)}
      />
    );
  }

  // ON-DEVICE or when avatar is empty/failed to load, render emoji
  return (
    <span className={`inline-flex items-center justify-center shrink-0 ${getEmojiSizeStyles()} ${className}`}>
      {emoji || getInitials(name || 'AG')}
    </span>
  );
};

export default AgentAvatar;
