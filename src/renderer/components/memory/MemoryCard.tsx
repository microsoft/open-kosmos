import React from 'react';

import '../../styles/Memory.css';

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

interface MemoryCardProps {
  memory: Memory;
  onDelete: (memoryId: string) => void;
}

const MemoryCard: React.FC<MemoryCardProps> = ({ memory, onDelete }) => {
  // Format time
  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    
    // Validate date
    if (isNaN(date.getTime())) {
      return '';
    }
    
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / 60000);
    const diffInHours = Math.floor(diffInMs / 3600000);
    const diffInDays = Math.floor(diffInMs / 86400000);
    
    // Relative time display
    if (diffInMinutes < 1) return 'just now';
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    
    // Absolute time display
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Use the standard createdAt field
  const timestamp = memory.createdAt;

  return (
    <div className="memory-card">
      <div className="memory-info">
        <div>
          <p className="memory-text">{memory.memory}</p>
          {timestamp && (
            <p className="memory-time">{formatTime(timestamp)}</p>
          )}
        </div>
      </div>
      <div className="memory-actions">
        <button
          className="action-btn delete-btn"
          onClick={() => onDelete(memory.id)}
          title="Delete memory"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="mask0_342_2337" style={{maskType:'alpha'}} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
              <path d="M10 5H14C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5ZM8.5 5C8.5 3.067 10.067 1.5 12 1.5C13.933 1.5 15.5 3.067 15.5 5H21.25C21.6642 5 22 5.33579 22 5.75C22 6.16421 21.6642 6.5 21.25 6.5H19.9309L18.7589 18.6112C18.5729 20.5334 16.9575 22 15.0263 22H8.97369C7.04254 22 5.42715 20.5334 5.24113 18.6112L4.06908 6.5H2.75C2.33579 6.5 2 6.16421 2 5.75C2 5.33579 2.33579 5 2.75 5H8.5ZM10.5 9.75C10.5 9.33579 10.1642 9 9.75 9C9.33579 9 9 9.33579 9 9.75V17.25C9 17.6642 9.33579 18 9.75 18C10.1642 18 10.5 17.6642 10.5 17.25V9.75ZM14.25 9C14.6642 9 15 9.33579 15 9.75V17.25C15 17.6642 14.6642 18 14.25 18C13.8358 18 13.5 17.6642 13.5 17.25V9.75C13.5 9.33579 13.8358 9 14.25 9ZM6.73416 18.4667C6.84577 19.62 7.815 20.5 8.97369 20.5H15.0263C16.185 20.5 17.1542 19.62 17.2658 18.4667L18.4239 6.5H5.57608L6.73416 18.4667Z" fill="#242424"/>
            </mask>
            <g mask="url(#mask0_342_2337)">
              <rect width="24" height="24" fill="#272320"/>
            </g>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default MemoryCard;
