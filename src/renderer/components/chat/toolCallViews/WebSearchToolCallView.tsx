// src/renderer/components/chat/toolCallViews/WebSearchToolCallView.tsx
// Web Search tool call custom view component

import React from 'react';
import { ToolCallViewProps, WebSearchToolResult, WebSearchToolArgs, WebSearchResultItem } from './types';
import { MessageHelper } from '../../../types/chatTypes';

/**
 * Parse tool call arguments
 */
const parseToolArgs = (argsStr?: string): WebSearchToolArgs | null => {
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
const parseToolResult = (content: string): WebSearchToolResult | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Group search results by query
 */
const groupResultsByQuery = (
  results: WebSearchResultItem[],
  queries: string[]
): Map<string, WebSearchResultItem[]> => {
  const grouped = new Map<string, WebSearchResultItem[]>();

  // Initialize empty arrays for all queries
  queries.forEach(q => grouped.set(q, []));

  // Assign results to their corresponding queries
  results.forEach(result => {
    const query = result.query || queries[0] || 'Search';
    if (!grouped.has(query)) {
      grouped.set(query, []);
    }
    grouped.get(query)!.push(result);
  });

  return grouped;
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
 * Search result row component - single line layout: favicon + title | URL
 */
const SearchResultRow: React.FC<{ result: WebSearchResultItem }> = ({ result }) => {
  const handleClick = () => {
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const faviconUrl = getFaviconUrl(result.url);

  return (
    <div className="web-search-result-row" onClick={handleClick}>
      <div className="web-search-result-left">
        {faviconUrl && (
          <img
            src={faviconUrl}
            alt=""
            className="web-search-result-favicon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <span className="web-search-result-title">{result.title}</span>
      </div>
      <span className="web-search-result-site">{result.site}</span>
    </div>
  );
};

/**
 * Web Search Tool Call custom view
 * Displays search queries and results
 */
export const WebSearchToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  toolResult,
}) => {
  const args = parseToolArgs(toolCall.function.arguments);
  // Use MessageHelper.getText to extract text from UnifiedContentPart[]
  const resultText = toolResult ? MessageHelper.getText(toolResult) : '';
  const result = resultText ? parseToolResult(resultText) : null;

  // If no arguments, don't render
  if (!args || !args.queries || args.queries.length === 0) {
    return null;
  }

  const queries = args.queries;
  const isExecuting = !toolResult;

  // Group results by query
  const groupedResults = result?.results
    ? groupResultsByQuery(result.results, queries)
    : new Map<string, WebSearchResultItem[]>();

  return (
    <div className="web-search-view">
      {queries.map((query, queryIndex) => {
        const queryResults = groupedResults.get(query) || [];

        return (
          <div key={queryIndex} className="web-search-query-group">
            <div className="web-search-query-header">
              <span className="web-search-query-text">{query}</span>
              {isExecuting && queryIndex === 0 ? (
                <span className="web-search-loading">Searching...</span>
              ) : (
                queryResults.length > 0 && (
                  <span className="web-search-result-count">{queryResults.length} results</span>
                )
              )}
            </div>

            {queryResults.length > 0 && (
              <div className="web-search-results-list">
                {queryResults.map((item, itemIndex) => (
                  <SearchResultRow key={itemIndex} result={item} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {result?.errors && result.errors.length > 0 && (
        <div className="web-search-errors">
          {result.errors.map((error, i) => (
            <div key={i} className="web-search-error-item">{error}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WebSearchToolCallView;
