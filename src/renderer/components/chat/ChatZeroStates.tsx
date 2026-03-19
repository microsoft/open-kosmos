/**
 * ChatZeroStates Component
 * Chat initial experience component - displays greeting and quick start cards
 */

import React, { useState, useEffect } from 'react';
import { ZeroStates, QuickStartItem } from '../../lib/userData/types';
import '../../styles/ChatZeroStates.css';

interface ChatZeroStatesProps {
  /** Zero States configuration */
  zeroStates: ZeroStates;
  /** Agent name, used for image caching */
  agentName: string;
  /** Callback when a quick start card is clicked */
  onQuickStartClick: (prompt: string) => void;
}

/** Default quick start card image (placeholder) */
const DEFAULT_QUICK_START_IMAGE = '';

/**
 * Quick start card component
 * Supports local image caching, preferring cache with fallback to remote URL
 */
const QuickStartCard: React.FC<{
  item: QuickStartItem;
  agentName: string;
  onClick: () => void;
}> = ({ item, agentName, onClick }) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  
  // If image is empty, use the default image
  const rawImageUrl = item.image && item.image.trim() ? item.image : DEFAULT_QUICK_START_IMAGE;

  useEffect(() => {
    let isMounted = true;
    
    const loadImage = async () => {
      setIsLoading(true);
      
      try {
        // Try to get cached local path (will auto-cache if not exists)
        const result = await window.electronAPI.quickStartImageCache?.getOrCache(
          agentName, 
          rawImageUrl
        );
        
        if (isMounted) {
          if (result?.success && result.cachedUrl) {
            // Use cached local file path
            setImageUrl(result.cachedUrl);
          } else {
            // Fall back to remote URL (add timestamp to avoid browser caching issues)
            const timestamp = Date.now();
            const separator = rawImageUrl.includes('?') ? '&' : '?';
            setImageUrl(`${rawImageUrl}${separator}t=${timestamp}`);
          }
        }
      } catch (error) {
        console.error('[QuickStartCard] Failed to load cached image:', error);
        if (isMounted) {
          // Fall back to remote URL on error
          const timestamp = Date.now();
          const separator = rawImageUrl.includes('?') ? '&' : '?';
          setImageUrl(`${rawImageUrl}${separator}t=${timestamp}`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [agentName, rawImageUrl]);

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
      <div 
        className={`quick-start-card-image ${isLoading ? 'loading' : ''}`}
        style={{ backgroundImage: imageUrl ? `url(${imageUrl})` : undefined }}
      />
      <div className="quick-start-card-title">{item.title}</div>
      <div className="quick-start-card-description">{item.description}</div>
    </div>
  );
};

/**
 * ChatZeroStates main component
 * Displayed in the chat content area, above ChatInput
 */
const ChatZeroStates: React.FC<ChatZeroStatesProps> = ({
  zeroStates,
  agentName,
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
      
      {/* Quick Start List - horizontally scrollable showing all cards */}
      {hasQuickStarts && (
        <div className="quick-start-list">
          {quick_starts!.map((item, index) => (
            <QuickStartCard
              key={`quick-start-${index}`}
              item={item}
              agentName={agentName}
              onClick={() => onQuickStartClick(item.prompt)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatZeroStates;
