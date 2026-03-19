import React, { useRef, useCallback, useEffect } from 'react';
import MemoryCard from './MemoryCard';

import '../../styles/Memory.css';
import '../../styles/ContentView.css';

interface Memory {
  id: string;
  memory: string;
  user_id?: string;
  agent_id?: string;
  createdAt?: string;  // Use mem0 standard camelCase field
  updatedAt?: string;
  metadata?: {
    [key: string]: any;
  };
}

interface MemoryContentViewProps {
  memories: Memory[];
  isLoading: boolean;
  onDeleteMemory: (memoryId: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

const MemoryContentView: React.FC<MemoryContentViewProps> = ({
  memories,
  isLoading,
  onDeleteMemory,
  onLoadMore,
  hasMore = false
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Handle scroll event for scroll-based loading
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !onLoadMore || !hasMore || loadingRef.current) {
      return;
    }

    const container = scrollContainerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // Trigger loading when scrolled to within 100px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadingRef.current = true;
      onLoadMore();
      // Delay resetting loading state to prevent duplicate triggers
      setTimeout(() => {
        loadingRef.current = false;
      }, 1000);
    }
  }, [onLoadMore, hasMore]);

  // Add scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  if (isLoading && memories.length === 0) {
    return (
      <div className="sidepane-content" ref={scrollContainerRef}>
        <div className="memory-loading">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading memories...</p>
        </div>
      </div>
    );
  }

  if (!isLoading && memories.length === 0) {
    return (
      <div className="sidepane-content" ref={scrollContainerRef}>
        <div className="memory-empty">
          <div className="empty-icon">🧠</div>
          <p className="empty-title">No memories yet</p>
          <p className="empty-hint">Start a conversation to create your first memory</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sidepane-content" ref={scrollContainerRef}>
      <div className="server-cards">
        {memories.slice().reverse().map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onDelete={onDeleteMemory}
          />
        ))}
        
        {/* Scroll to load more indicator */}
        {hasMore && (
          <div className="load-more-indicator">
            <div className="loading-spinner-small"></div>
            <p className="loading-more-text">Loading more memories...</p>
          </div>
        )}
        
        {/* Bottom all-loaded indicator */}
        {!hasMore && memories.length > 0 && (
          <div className="all-loaded-indicator">
            <p className="all-loaded-text">All memories loaded</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemoryContentView;