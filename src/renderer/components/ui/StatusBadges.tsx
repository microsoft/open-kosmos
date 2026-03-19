import React, { useState, useEffect } from 'react';
import { Badge } from '../ui/badge';
import { useMCPServers } from '../userData/userDataProvider';
import { ChatAgent } from '../../lib/userData/types';
import ContextBadge from './ContextBadge';
import { profileDataManager } from '../../lib/userData';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';

// Tool conflict detection result interface
interface ToolConflict {
  toolName: string;
  servers: string[];
}

interface ToolConflictResult {
  hasConflict: boolean;
  conflicts: ToolConflict[];
  message: string;
}

interface StatusBadgesProps {
  currentAgent?: ChatAgent | null;
  agentChat?: any | null; // Generic type since AgentChat is now in main process
  onOpenMcpTools?: () => void;
  onOpenSkills?: () => void;
}

interface AvailableToolsBadgeProps {
  onOpenMcpTools?: () => void;
}

const AvailableToolsBadge: React.FC<AvailableToolsBadgeProps> = ({
  onOpenMcpTools
}) => {
  const { servers } = useMCPServers();
  
  // 🔥 New architecture: Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );
  const [toolsCount, setToolsCount] = useState(0);
  
  // Subscribe to currentChatId changes
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);
  
  // 🆕 Refactor: Use mcpClientCacheManager to get available tools
  const getAvailableToolsCount = (chatId: string): number => {
    const chat = profileDataManager.getChatConfigs().find(c => c.chat_id === chatId);
    if (!chat || !chat.agent) {
      return 0;
    }
    const agentMcpServers = chat.agent.mcp_servers || [];
    const tools = mcpClientCacheManager.getAgentSpecificTools(agentMcpServers);
    return tools.length;
  };

  // 🔥 Core logic: Listen for currentChatId and servers changes, use mcpClientCacheManager to calculate tool count
  useEffect(() => {
    if (!currentChatId) {
      setToolsCount(0);
      return;
    }
    
    const count = getAvailableToolsCount(currentChatId);
    setToolsCount(count);
  }, [currentChatId, servers]); // Also recalculate when servers change
  
  // 🔥 Listen for ProfileDataManager data changes (including agent.mcp_servers config changes)
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((newData) => {
      if (!currentChatId) {
        return;
      }
      
      // Recalculate tool count
      const count = getAvailableToolsCount(currentChatId);
      setToolsCount(count);
    });
    
    return unsubscribe;
  }, [currentChatId]);
  
  return (
    <Badge
      variant="normal"
      className={`text-xs ${onOpenMcpTools ? 'cursor-pointer' : 'cursor-help'}`}
      title={`Current Agent has ${toolsCount} available tools${onOpenMcpTools ? ' (Click to manage tools)' : ''}`}
      onClick={onOpenMcpTools}
    >
      tools: {toolsCount}
    </Badge>
  );
};

interface AvailableSkillsBadgeProps {
  onOpenSkills?: () => void;
}

const AvailableSkillsBadge: React.FC<AvailableSkillsBadgeProps> = ({
  onOpenSkills
}) => {
  // 🔥 Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );
  const [skillsCount, setSkillsCount] = useState(0);
  
  // Subscribe to currentChatId changes
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);
  
  // 🆕 Refactor: Get actual available skills count (similar to mcpClientCacheManager.getAgentSpecificTools logic)
  // Only count skills that actually exist in the global skills list
  const getAvailableSkillsCount = (chatId: string): number => {
    const chat = profileDataManager.getChatConfigs().find(c => c.chat_id === chatId);
    if (!chat || !chat.agent) {
      return 0;
    }
    const agentSkillNames = chat.agent.skills || [];
    const globalSkills = profileDataManager.getSkills();
    
    // 🔥 Critical fix: Filter out actually existing skills (consistent with getCurrentAgentSkills logic)
    const availableSkills = agentSkillNames.filter(skillName =>
      globalSkills.some(s => s.name === skillName)
    );
    return availableSkills.length;
  };
  
  // 🔥 Core logic: Listen for currentChatId changes, get current Agent's skills
  useEffect(() => {
    if (!currentChatId) {
      setSkillsCount(0);
      return;
    }
    
    // Get actual available skills count
    const count = getAvailableSkillsCount(currentChatId);
    setSkillsCount(count);
  }, [currentChatId]);
  
  // 🔥 Listen for ProfileDataManager data changes (including agent.skills config changes and global skills list changes)
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((newData) => {
      if (!currentChatId) return;
      
      // Recalculate actual available skills count
      const count = getAvailableSkillsCount(currentChatId);
      setSkillsCount(count);
    });
    
    return unsubscribe;
  }, [currentChatId]);
  
  return (
    <Badge
      variant="normal"
      className={`text-xs ${onOpenSkills ? 'cursor-pointer' : 'cursor-help'}`}
      title={`Current Agent has ${skillsCount} available skills${onOpenSkills ? ' (Click to manage skills)' : ''}`}
      onClick={onOpenSkills}
    >
      skills: {skillsCount}
    </Badge>
  );
};

export const StatusBadges: React.FC<StatusBadgesProps> = ({
  currentAgent,
  agentChat,
  onOpenMcpTools,
  onOpenSkills
}) => {
  return (
    <div className="status-badges">
      <AvailableSkillsBadge
        onOpenSkills={onOpenSkills}
      />
      <AvailableToolsBadge
        onOpenMcpTools={onOpenMcpTools}
      />
      <ContextBadge agentChat={agentChat} />
    </div>
  );
};

export default StatusBadges;