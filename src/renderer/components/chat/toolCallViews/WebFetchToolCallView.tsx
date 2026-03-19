// src/renderer/components/chat/toolCallViews/WebFetchToolCallView.tsx
// Web Fetch tool call custom view component

import React from 'react';
import { ToolCallViewProps, WebFetchToolResult, WebFetchToolArgs, WebContentResult } from './types';
import { MessageHelper } from '../../../types/chatTypes';

/**
 * Parse tool call arguments
 */
const parseToolArgs = (argsStr?: string): WebFetchToolArgs | null => {
  if (!argsStr) return null;
  try {
    return JSON.parse(argsStr);
  } catch {
    return null;
  }
};

/**
 * Parse tool result content
 */
const parseToolResult = (content: string): WebFetchToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Get website favicon URL
 */
const getFaviconUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return '';
  }
};

/**
 * Get website domain
 */
const getSiteDomain = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
};

/**
 * External link icon component
 */
const ExternalLinkIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/**
 * Parse error message, extract URL and error description
 * Format: URL "https://example.com": HTTP 403: Forbidden
 */
const parseErrorMessage = (error: string): { url: string; message: string } => {
  // Try to match URL "xxx": error format
  const match = error.match(/^URL\s+"([^"]+)":\s*(.+)$/);
  if (match) {
    return { url: match[1], message: match[2] };
  }
  // If unable to parse, return original error
  return { url: '', message: error };
};

/**
 * Error row component - single line layout: error message | URL + external link icon
 */
const WebFetchErrorRow: React.FC<{ error: string }> = ({ error }) => {
  const { url, message } = parseErrorMessage(error);
  const siteDomain = url ? getSiteDomain(url) : '';

  const handleClick = () => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className={`web-fetch-error-row ${url ? 'clickable' : ''}`}
      onClick={url ? handleClick : undefined}
    >
      <div className="web-fetch-error-left">
        <span className="web-fetch-error-message">{message}</span>
      </div>
      {url && (
        <div className="web-fetch-error-right">
          <span className="web-fetch-error-site">{siteDomain}</span>
          <span className="web-fetch-error-link-icon">
            <ExternalLinkIcon />
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Web fetch result row component - single line layout: favicon + title | URL + external link icon
 */
const WebFetchResultRow: React.FC<{ result: WebContentResult }> = ({ result }) => {
  const handleClick = () => {
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const faviconUrl = getFaviconUrl(result.url);
  const siteDomain = getSiteDomain(result.url);
  const displayTitle = result.title || 'Untitled';

  return (
    <div className="web-fetch-result-row" onClick={handleClick}>
      <div className="web-fetch-result-left">
        {faviconUrl && (
          <img
            src={faviconUrl}
            alt=""
            className="web-fetch-result-favicon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <span className="web-fetch-result-title">{displayTitle}</span>
      </div>
      <div className="web-fetch-result-right">
        <span className="web-fetch-result-site">{siteDomain}</span>
        <span className="web-fetch-result-link-icon">
          <ExternalLinkIcon />
        </span>
      </div>
    </div>
  );
};

/**
 * Web Fetch Tool Call custom view
 * Displays fetched web pages list
 */
export const WebFetchToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
}) => {
  const args = parseToolArgs(toolCall.function.arguments);
  // Use MessageHelper.getText to extract text from UnifiedContentPart[]
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseToolResult(resultText) : null;

  // If no arguments, don't render
  if (!args || !args.urls || args.urls.length === 0) {
    return null;
  }

  const urls = args.urls;
  const isExecuting = !toolResult;

  return (
    <div className="web-fetch-view">
      {isExecuting ? (
        <div className="web-fetch-loading">
          <span>Fetching {urls.length} page{urls.length > 1 ? 's' : ''}...</span>
        </div>
      ) : result?.results && result.results.length > 0 ? (
        <div className="web-fetch-results-list">
          {result.results.map((item, index) => (
            <WebFetchResultRow key={index} result={item} />
          ))}
        </div>
      ) : (
        <div className="web-fetch-no-results">
          No content fetched
        </div>
      )}

      {result?.errors && result.errors.length > 0 && (
        <div className="web-fetch-errors-list">
          {result.errors.map((error, i) => (
            <WebFetchErrorRow key={i} error={error} />
          ))}
        </div>
      )}
    </div>
  );
};

export default WebFetchToolCallView;
