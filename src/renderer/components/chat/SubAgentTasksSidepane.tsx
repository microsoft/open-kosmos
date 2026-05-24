import React, { useEffect, useState, useCallback } from 'react';
import { Bot, X, ArrowLeft } from 'lucide-react';
import '../../styles/Sidepane.css';
import { SubAgentTasksSidepaneAtom } from './chat-side.atom';
import { useCurrentChatSessionId } from '../../lib/chat/agentChatSessionCacheManager';
import SubAgentTaskDetailView from './SubAgentTaskDetailView';

interface TaskSummary {
  taskId: string;
  subAgentName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  turnCount: number;
  model: string;
  title?: string;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (startTime: number, endTime?: number): string => {
  const elapsed = (endTime || Date.now()) - startTime;
  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s`;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

// Status icons matching SchedulesSidepane
const ExecutingIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      animation: 'spin 1s linear infinite',
      display: 'block',
    }}
  >
    <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2" />
    <path
      d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19"
      stroke="#272320"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const CompletedIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <path
      d="M0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10Z"
      fill="#272320"
    />
    <mask
      id="subagent-completed-icon-mask"
      style={{ maskType: 'alpha' }}
      maskUnits="userSpaceOnUse"
      x="4"
      y="4"
      width="12"
      height="12"
    >
      <path
        d="M13.765 7.20474C14.0661 7.48915 14.0797 7.96383 13.7953 8.26497L9.54526 12.765C9.40613 12.9123 9.21332 12.997 9.01071 12.9999C8.8081 13.0028 8.61295 12.9236 8.46967 12.7803L6.21967 10.5303C5.92678 10.2374 5.92678 9.76257 6.21967 9.46967C6.51256 9.17678 6.98744 9.17678 7.28033 9.46967L8.98463 11.174L12.7047 7.23503C12.9891 6.9339 13.4638 6.92033 13.765 7.20474Z"
        fill="#242424"
      />
    </mask>
    <g mask="url(#subagent-completed-icon-mask)">
      <rect width="12" height="12" transform="translate(4 4)" fill="#E2DDD9" />
    </g>
  </svg>
);

const FailedIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <circle cx="10" cy="10" r="9" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2" />
    <path
      d="M10 5.75V10.25"
      stroke="#B91C1C"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <circle cx="10" cy="13.5" r="1" fill="#B91C1C" />
  </svg>
);

const CancelledIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <circle cx="10" cy="10" r="9" fill="#F3F4F6" stroke="#6B7280" strokeWidth="2" />
    <path
      d="M7 7L13 13"
      stroke="#4B5563"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M13 7L7 13"
      stroke="#4B5563"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

const TaskStatusIcon: React.FC<{ status: TaskSummary['status'] }> = ({ status }) => {
  if (status === 'running') return <ExecutingIcon />;
  if (status === 'failed') return <FailedIcon />;
  if (status === 'cancelled') return <CancelledIcon />;
  return <CompletedIcon />;
};

const TaskCard: React.FC<{ task: TaskSummary; onClick: () => void }> = ({ task, onClick }) => {
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';
  const isRunning = task.status === 'running';

  return (
    <button
      onClick={onClick}
      className="chat-session-item"
      style={{
        width: '100%',
        border: 'none',
        borderRadius: '12px',
        padding: '12px',
        background: '#FFFFFF',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '6px',
        boxSizing: 'border-box',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div
          style={{
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <TaskStatusIcon status={task.status} />
        </div>
        <span
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: '14px',
            fontWeight: 500,
            color: isFailed ? '#B91C1C' : isCancelled ? '#6B7280' : '#374151',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.title || task.subAgentName}
        </span>
      </div>
      <span
        style={{
          fontSize: '12px',
          color: isFailed ? '#B91C1C' : '#6B7280',
          paddingLeft: '28px',
        }}
      >
        {isRunning
          ? `Running · ${formatDuration(task.startTime)} · ${task.turnCount} turns`
          : isFailed
            ? `Failed · ${formatDuration(task.startTime, task.endTime)}`
            : isCancelled
              ? `Cancelled · ${formatDuration(task.startTime, task.endTime)} · ${task.turnCount} turns`
              : `${formatTime(task.startTime)} · ${formatDuration(task.startTime, task.endTime)} · ${task.turnCount} turns`}
      </span>
    </button>
  );
};

const SubAgentTasksSidepane: React.FC = () => {
  const [state, actions] = SubAgentTasksSidepaneAtom.use();
  const currentSessionId = useCurrentChatSessionId();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!currentSessionId) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.subAgentTask.listForSession(currentSessionId);
      if (result.success && result.data) {
        const sorted = [...result.data].sort((a: TaskSummary, b: TaskSummary) => b.startTime - a.startTime);
        setTasks(sorted);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (state.visible && !state.selectedTaskId) {
      loadTasks();
    }
  }, [state.visible, state.selectedTaskId, loadTasks]);

  // Subscribe to push events for real-time updates
  useEffect(() => {
    if (!state.visible || state.selectedTaskId) return;
    if (!currentSessionId) return;

    const unsubCreated = window.electronAPI.subAgentTask.onTaskCreated((data) => {
      if (data.parentSessionId !== currentSessionId) return;
      setTasks(prev => {
        // Avoid duplicates
        if (prev.some(t => t.taskId === data.taskId)) return prev;
        const newTask: TaskSummary = {
          taskId: data.taskId,
          subAgentName: data.subAgentName,
          status: data.status,
          startTime: data.startTime,
          turnCount: data.turnCount,
          model: data.model,
          title: data.title,
        };
        return [newTask, ...prev];
      });
    });

    const unsubUpdated = window.electronAPI.subAgentTask.onTaskUpdated((data) => {
      if (data.parentSessionId !== currentSessionId) return;
      setTasks(prev => prev.map(t =>
        t.taskId === data.taskId
          ? { ...t, status: data.status, endTime: data.endTime, turnCount: data.turnCount, title: data.title || t.title }
          : t
      ));
    });

    return () => {
      unsubCreated();
      unsubUpdated();
    };
  }, [state.visible, state.selectedTaskId, currentSessionId]);

  if (!state.visible) return null;

  // Detail view mode
  if (state.selectedTaskId) {
    const selectedTask = tasks.find(t => t.taskId === state.selectedTaskId);
    return (
      <div className="chat-sidepane" style={{ flex: 1 }}>
        <div className="file-explorer-section">
          <div className="sidepane-section-header" style={{ cursor: 'default' }}>
            <button
              onClick={actions.backToList}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-secondary, #888)',
                padding: '2px 4px',
              }}
            >
              <ArrowLeft size={14} />
              Back
            </button>
            {selectedTask && (
              <div className="sidepane-section-header-title" style={{ flex: 1, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="sidepane-section-title-text">{selectedTask.title || selectedTask.subAgentName}</span>
              </div>
            )}
            <div className="sidepane-section-header-actions">
              <button
                className="sidepane-close-btn"
                onClick={actions.hide}
                title="Close"
                aria-label="Close"
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          <SubAgentTaskDetailView taskId={state.selectedTaskId} />
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="chat-sidepane">
      <div className="file-explorer-section">
        <div className="sidepane-section-header" style={{ cursor: 'default' }}>
          <div className="sidepane-section-header-title">
            <Bot size={16} color="#374151" />
            <span className="sidepane-section-title-text">Current Session Sub-Agent Tasks</span>
          </div>
          <div className="sidepane-section-header-actions">
            <button
              className="sidepane-close-btn"
              onClick={actions.hide}
              title="Close sub-agent tasks"
              aria-label="Close sub-agent tasks"
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        </div>
        <div className="sidepane-body">
          {loading && tasks.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, #888)', textAlign: 'center' }}>
              Loading...
            </div>
          )}
          {!loading && tasks.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, #888)', textAlign: 'center' }}>
              No sub-agent tasks in this session
            </div>
          )}
          {tasks.map(task => (
            <TaskCard
              key={task.taskId}
              task={task}
              onClick={() => actions.selectTask(task.taskId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SubAgentTasksSidepane;
