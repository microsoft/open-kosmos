import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../ui/ToastProvider';
import { useAuthContext } from '../auth/AuthProvider';
import MemoryHeaderView from './MemoryHeaderView';
import MemoryContentView from './MemoryContentView';

import '../../styles/Memory.css';

interface Memory {
  id: string;
  memory: string;
  user_id?: string;
  agent_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface MemoryStats {
  totalMemories: number;
}

interface MemoryViewProps {
  // Can add props as needed
}

const MemoryView: React.FC<MemoryViewProps> = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats>({
    totalMemories: 0
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { showError, showSuccess } = useToast();
  const { user } = useAuthContext();
  const userAlias = user?.login;

  // Load memories
  const loadMemories = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Use mem0 API to get all memories
      const result = await window.electronAPI.mem0.getAllMemories({ limit: 100 });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to load memories');
      }

      const memoryData = result.data || [];
      setMemories(memoryData);

      // Calculate statistics
      setStats({
        totalMemories: memoryData.length
      });

    } catch (error) {
      showError(`Failed to load memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  // Refresh memories
  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await loadMemories();
      showSuccess('Memories refreshed successfully');
    } catch (error) {
    } finally {
      setIsRefreshing(false);
    }
  }, [loadMemories, showSuccess]);

  // Clear all memories
  const handleClearAllMemories = useCallback(async () => {
    if (!confirm('Are you sure you want to delete ALL memories? This action cannot be undone.')) {
      return;
    }

    try {
      // Get all memory IDs
      const memoryIds = memories.map(m => m.id);
      
      if (memoryIds.length === 0) {
        showError('No memories to delete');
        return;
      }

      // Batch delete all memories
      let successCount = 0;
      let failCount = 0;

      for (const memoryId of memoryIds) {
        try {
          const result = await window.electronAPI.mem0.deleteMemory(memoryId);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          failCount++;
        }
      }

      if (failCount === 0) {
        showSuccess(`Successfully deleted all ${successCount} memories`);
      } else {
        showError(`Deleted ${successCount} memories, failed to delete ${failCount} memories`);
      }

      // Reload memories after deletion
      await loadMemories();
    } catch (error) {
      showError(`Failed to clear all memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [memories, loadMemories, showError, showSuccess]);

  // Delete memory
  const handleDeleteMemory = useCallback(async (memoryId: string) => {
    if (!confirm('Are you sure you want to delete this memory?')) {
      return;
    }

    try {
      const result = await window.electronAPI.mem0.deleteMemory(memoryId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete memory');
      }

      showSuccess('Memory deleted successfully');
      
      // Reload memories after deletion
      await loadMemories();
    } catch (error) {
      showError(`Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [loadMemories, showError, showSuccess]);

  // Load memories on mount
  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  return (
    <div className="memory-view">
      <div className="config-sidepane">
        <MemoryHeaderView
          stats={stats}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          userAlias={userAlias}
          onClearAll={handleClearAllMemories}
        />
        
        <MemoryContentView
          memories={memories}
          isLoading={isLoading}
          onDeleteMemory={handleDeleteMemory}
        />
      </div>

    </div>
  );
};

export default MemoryView;