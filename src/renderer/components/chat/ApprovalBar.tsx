import React, { useState, useEffect } from 'react';
import '../../styles/ApprovalBar.css';

/**
 * Single approval request item - one request per tool
 */
export interface ApprovalRequestItem {
  requestId: string;
  toolCallId: string;
  toolName: string;
  paths: Array<{
    path: string;
    normalizedPath?: string;
  }>;
  message: string;
}

interface ApprovalBarProps {
  requests: ApprovalRequestItem[];
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onTimeoutAutoReject?: (requestIds: string[]) => void; // 🔥 Modified: batch auto-reject unanswered requests on timeout
}

/**
 * ApprovalBar - Batch approval request prompt bar component
 *
 * Supports displaying multiple approval requests, each with independent approve/reject buttons
 * Directly embedded above the input-area of the ChatInput component
 * 🔥 New: 60-second countdown display
 */
const ApprovalBar: React.FC<ApprovalBarProps> = ({ requests, onApprove, onReject, onTimeoutAutoReject }) => {
  // 🔥 New: countdown state (60 seconds)
  const [countdown, setCountdown] = useState(60);
  // 🔥 New: track initial request list (used to determine which are unanswered)
  const initialRequestIdsRef = React.useRef<Set<string>>(new Set());
  
  // 🔥 Initialize and update request list reference
  useEffect(() => {
    initialRequestIdsRef.current = new Set(requests.map(r => r.requestId));
  }, [requests.length]); // Only update when request count changes
  
  // 🔥 New: countdown effect
  useEffect(() => {
    // Reset countdown (when request count changes - new batch arrives)
    setCountdown(60);
    
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          
          // 🔥 Countdown ended: get list of currently unanswered request IDs
          const currentRequestIds = requests.map(r => r.requestId);
          
          // Call timeout callback, batch send reject responses to backend
          if (onTimeoutAutoReject && currentRequestIds.length > 0) {
            onTimeoutAutoReject(currentRequestIds);
          }
          
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [requests.length, onTimeoutAutoReject]); // 🔥 Modified: only depend on request count and callback function
  // 🔥 Debug: print request data

  return (
    <div className="approval-bar">
      <div className="approval-bar-header">
        <div className="approval-bar-icon">🔐</div>
        <div className="approval-bar-title">
          {requests.length} tool{requests.length > 1 ? 's' : ''} require{requests.length === 1 ? 's' : ''} approval for paths outside workspace
        </div>
        <div className="approval-bar-countdown" style={{
          marginLeft: 'auto',
          fontSize: '0.875rem',
          color: countdown <= 10 ? '#ef4444' : '#6b7280',
          fontWeight: countdown <= 10 ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem'
        }}>
          <span>⏱️</span>
          <span>{countdown}s</span>
        </div>
      </div>
      <div className="approval-bar-requests">
        {requests.map((request) => {
          // 🔥 Modified: handle display for multiple paths
          const pathsDisplay = request.paths.length === 1
            ? request.paths[0].normalizedPath || request.paths[0].path
            : `${request.paths.length} paths`;
          
          return (
            <div key={request.requestId} className="approval-request-item">
              <div className="approval-request-message">
                <strong>{request.toolName}</strong> tool requests access to <strong>{pathsDisplay}</strong> outside the workspace.
                {request.paths.length > 1 && (
                  <details style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                    <summary style={{ cursor: 'pointer', color: '#6b7280' }}>
                      Show all paths ({request.paths.length})
                    </summary>
                    <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', color: '#374151' }}>
                      {request.paths.map((pathInfo, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>
                          <code>{pathInfo.normalizedPath || pathInfo.path}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="approval-request-actions">
                <button
                  className="approval-bar-btn approve"
                  onClick={() => onApprove(request.requestId)}
                  title={`Allow ${request.toolName} to access ${pathsDisplay}`}
                  aria-label={`Approve ${request.toolName} access to ${pathsDisplay}`}
                >
                  Approve
                </button>
                <button
                  className="approval-bar-btn reject"
                  onClick={() => onReject(request.requestId)}
                  title={`Deny ${request.toolName} access to ${pathsDisplay}`}
                  aria-label={`Reject ${request.toolName} access to ${pathsDisplay}`}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ApprovalBar;