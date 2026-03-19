/**
 * Kosmos Streaming v2 progressive rendering component
 * Based on VSCode-style streaming experience
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MermaidDiagram from '../chat/MermaidDiagram';
import { Message } from '../../types/chatTypes';
import { streamingConfigManager } from '../../lib/streaming/streamingConfig';
import { streamingOptimizer } from '../../lib/streaming/streamingOptimizer';
import { streamingCompatibility } from '../../lib/streaming/compatibilityLayer';
import '../../styles/StreamingV2Message.css';
import '../../styles/markdown-render.css';

/**
 * Preprocess markdown text, encode spaces in link URLs as %20
 * Fix issue where [text](path/with spaces/file) cannot be parsed by ReactMarkdown
 */
function encodeMarkdownLinkSpaces(text: string): string {
  // Match markdown links: [text](url)
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    if (url.includes(' ')) {
      const encodedUrl = url.replace(/ /g, '%20');
      return `[${linkText}](${encodedUrl})`;
    }
    return match;
  });
}

// StreamingMetrics type definition
export interface StreamingMetrics {
  wordsPerSecond: number;
  timeToFirstContent?: number;
  totalTime: number;
  totalFragments: number;
  fragmentsPerSecond: number;
  contentLength: number;
  wordCount: number;
  latencyMetrics?: {
    average: number;
    peak: number;
  };
  fragmentsByType?: { [key: string]: number };
}

export interface StreamingV2MessageProps {
  message: Message;
  isStreaming: boolean;
  streamingMetrics?: StreamingMetrics;
  enableMetricsDisplay?: boolean;
  onStreamingComplete?: () => void;
  onHeightChange?: (newHeight: number) => void;
}

export const StreamingV2Message: React.FC<StreamingV2MessageProps> = ({
  message,
  isStreaming,
  streamingMetrics,
  enableMetricsDisplay = false,
  onStreamingComplete,
  onHeightChange
}) => {
  const [showMetrics, setShowMetrics] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const [lastHeight, setLastHeight] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [shouldSkipAnimation, setShouldSkipAnimation] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const metricsTimeoutRef = useRef<NodeJS.Timeout>();
  const rafIdRef = useRef<number>();
  const lastProcessedLengthRef = useRef(0);
  const clickTimeoutRef = useRef<NodeJS.Timeout>();
  const lastFrameTimeRef = useRef<number>(0);

  // Get UI configuration
  const uiConfig = streamingConfigManager.getUIConfig();

  // 🚀 Optimized typewriter effect - using RAF and batch updates
  const animateTypewriter = useCallback((targetText: string, startIndex: number = 0) => {
    // Cancel previous animation frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // If target text is already reached, set directly
    if (startIndex >= targetText.length) {
      setDisplayedText(targetText);
      setIsTyping(false);
      lastFrameTimeRef.current = 0;
      return;
    }

    setIsTyping(true);
    
    // Get optimized configuration
    const compatConfig = streamingCompatibility.getCompatibleConfig(targetText);
    const optimizedConfig = compatConfig.optimizedConfig || streamingOptimizer.getConfigForText(targetText);
    
    // Use RAF for smooth animation
    let currentIndex = startIndex;
    let lastUpdateTime = performance.now();
    
    const animate = (currentTime: number) => {
      // If completed, exit
      if (currentIndex >= targetText.length) {
        setDisplayedText(targetText);
        setIsTyping(false);
        lastFrameTimeRef.current = 0;
        return;
      }
      
      // Calculate time elapsed since last update
      const deltaTime = currentTime - lastUpdateTime;
      
      // Calculate target delay based on configuration
      const targetDelay = optimizedConfig.baseDelay;
      
      // 🚀 Core optimization: batch update multiple characters based on time delta
      if (deltaTime >= targetDelay) {
        // Calculate number of characters to update (at least 1)
        const charsToUpdate = Math.max(1, Math.floor(deltaTime / targetDelay));
        
        // Smart batching: if batching is enabled, update more characters at once
        let actualCharsToUpdate = charsToUpdate;
        if (optimizedConfig.enableBatching) {
          // Check if consecutive alphanumeric or Chinese characters can be batch processed
          const remainingText = targetText.substring(currentIndex);
          const alphanumMatch = remainingText.match(/^[a-zA-Z0-9]+/);
          const chineseMatch = remainingText.match(/^[\u4e00-\u9fff]+/);
          
          if (alphanumMatch && alphanumMatch[0].length > 1) {
            actualCharsToUpdate = Math.min(
              alphanumMatch[0].length,
              optimizedConfig.maxBatchSize,
              charsToUpdate * 2
            );
          } else if (chineseMatch && chineseMatch[0].length > 1) {
            actualCharsToUpdate = Math.min(
              chineseMatch[0].length,
              Math.floor(optimizedConfig.maxBatchSize / 2),
              charsToUpdate
            );
          }
        }
        
        // Update index
        currentIndex = Math.min(currentIndex + actualCharsToUpdate, targetText.length);
        
        // 🚀 Key optimization: set state once after batch update to reduce re-renders
        setDisplayedText(targetText.substring(0, currentIndex));
        lastUpdateTime = currentTime;
      }
      
      // Continue animation
      if (currentIndex < targetText.length) {
        rafIdRef.current = requestAnimationFrame(animate);
      } else {
        setIsTyping(false);
        lastFrameTimeRef.current = 0;
      }
    };
    
    // Start animation
    rafIdRef.current = requestAnimationFrame(animate);
  }, []);

  // Handle fast display feature
  const handleFastDisplay = useCallback(() => {
    if (isTyping && rafIdRef.current) {
      // User clicked to skip animation
      cancelAnimationFrame(rafIdRef.current);
      
      const fullText = typeof message.content === 'string'
        ? message.content
        : message.content?.map(part =>
            typeof part === 'string' ? part : (part as any).text || ''
          ).join('') || '';
          
      setDisplayedText(fullText);
      setIsTyping(false);
      setShouldSkipAnimation(true);
      
      // Re-enable animation after 1 second
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      clickTimeoutRef.current = setTimeout(() => {
        setShouldSkipAnimation(false);
      }, 1000);
    }
  }, [isTyping, message.content]);

  // Handle text content update
  useEffect(() => {
    const text = typeof message.content === 'string'
      ? message.content
      : message.content?.map(part =>
          typeof part === 'string' ? part : (part as any).text || ''
        ).join('') || '';

    if (isStreaming) {
      // Smooth typewriter effect: only animate newly added content
      if (text !== displayedText && text.length > lastProcessedLengthRef.current) {
        const currentLength = displayedText.length;
        lastProcessedLengthRef.current = text.length;
        
        // Clear previous animation
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
        }
        
        // Check if animation should be skipped
        if (shouldSkipAnimation || !uiConfig.showCursor) {
          // Display directly without typewriter effect
          setDisplayedText(text);
          setIsTyping(false);
        } else {
          // Start typewriter animation (from current length)
          animateTypewriter(text, currentLength);
        }
      } else if (text.length < displayedText.length) {
        // If text got shorter (e.g., restarted), set directly
        setDisplayedText(text);
        lastProcessedLengthRef.current = text.length;
        setShouldSkipAnimation(false); // Reset skip state
      }
    } else {
      // Non-streaming state, set text directly
      setDisplayedText(text);
      setIsTyping(false);
      lastProcessedLengthRef.current = text.length;
      setShouldSkipAnimation(false); // Reset skip state
      
      if ((message as any).streamingComplete && onStreamingComplete) {
        onStreamingComplete();
      }
    }
  }, [message, isStreaming, displayedText, animateTypewriter, onStreamingComplete, shouldSkipAnimation, uiConfig.showCursor]);

  // Clean up timers and RAF
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      if (metricsTimeoutRef.current) {
        clearTimeout(metricsTimeoutRef.current);
      }
    };
  }, []);

  // Monitor height changes
  useEffect(() => {
    if (containerRef.current && onHeightChange) {
      const currentHeight = containerRef.current.scrollHeight;
      if (currentHeight !== lastHeight) {
        setLastHeight(currentHeight);
        onHeightChange(currentHeight);
      }
    }
  }, [displayedText, lastHeight, onHeightChange]);

  // Auto-hide performance metrics
  useEffect(() => {
    if (isStreaming && enableMetricsDisplay && streamingMetrics) {
      setShowMetrics(true);
      
      // Clear previous timer
      if (metricsTimeoutRef.current) {
        clearTimeout(metricsTimeoutRef.current);
      }
      
      // Set auto-hide timer
      metricsTimeoutRef.current = setTimeout(() => {
        setShowMetrics(false);
      }, 5000);
    } else if (!isStreaming) {
      setShowMetrics(false);
    }

    return () => {
      if (metricsTimeoutRef.current) {
        clearTimeout(metricsTimeoutRef.current);
      }
    };
  }, [isStreaming, enableMetricsDisplay, streamingMetrics]);

  // Handle performance metrics click
  const handleMetricsClick = useCallback(() => {
    setShowMetrics(!showMetrics);
  }, [showMetrics]);

  // 🚀 Performance optimization: cache Markdown component config to avoid recreating on every re-render
  const markdownComponents = useMemo(() => ({
    // 🔥 Inline code: only handle code tags not inside pre
    // react-markdown calls pre first, then code
    // We render code blocks directly in pre, so code here only handles inline code
    code(props: any) {
      const { children } = props;
      return (
        <code className="inline-code">
          {children}
        </code>
      );
    },
    // 🔥 Code blocks: pre wraps code, handle code block rendering here directly
    pre(props: any) {
      const { children } = props;
      
      // Extract code element info from children
      // When react-markdown renders code blocks, children is <code className="language-xxx">...</code>
      const codeChild = React.Children.toArray(children).find(
        (child: any) => child?.type === 'code' || child?.props?.node?.tagName === 'code'
      ) as React.ReactElement | undefined;
      
      if (codeChild && codeChild.props) {
        const { className, children: codeContent } = codeChild.props;
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : 'text';
        const content = String(codeContent).replace(/\n$/, '');

        if (language === 'mermaid') {
          return <MermaidDiagram definition={content} />;
        }

        return (
          <div className="code-block-wrapper">
            <SyntaxHighlighter
              PreTag="div"
              language={language}
              style={oneDark}
              customStyle={{
                margin: 0,
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                display: 'block',
                minWidth: 'fit-content',
              }}
              wrapLongLines={false}
              codeTagProps={{
                style: {
                  whiteSpace: 'pre',
                  wordWrap: 'normal',
                  overflowWrap: 'normal',
                },
              }}
            >
              {content}
            </SyntaxHighlighter>
          </div>
        );
      }
      
      // fallback: render children directly
      return <div className="pre-wrapper">{children}</div>;
    },
    h1(props: any) {
      return <h1 {...props} />;
    },
    h2(props: any) {
      return <h2 {...props} />;
    },
    h3(props: any) {
      return <h3 {...props} />;
    },
    p(props: any) {
      return <p {...props} />;
    },
    ul(props: any) {
      return <ul {...props} />;
    },
    ol(props: any) {
      return <ol {...props} />;
    },
    li(props: any) {
      return <li {...props} />;
    },
    blockquote(props: any) {
      return <blockquote {...props} />;
    },
    table(props: any) {
      return (
        <div className="table-wrapper">
          <table {...props} />
        </div>
      );
    },
    thead(props: any) {
      return <thead {...props} />;
    },
    tbody(props: any) {
      return <tbody {...props} />;
    },
    tr(props: any) {
      return <tr {...props} />;
    },
    th(props: any) {
      return <th {...props} />;
    },
    td(props: any) {
      return <td {...props} />;
    },
    a(props: any) {
      const { href, children, ...rest } = props;
      // Detect local file path (starts with / but not //, or starts with drive letter)
      const isLocalPath = href && (/^\/[^/]/.test(href) || /^[A-Za-z]:[\\/]/.test(href));
      if (isLocalPath) {
        return (
          <a
            {...rest}
            href="#"
            className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              const decodedPath = decodeURIComponent(href);
              window.electronAPI?.workspace?.openPath(decodedPath);
            }}
          >
            {children}
          </a>
        );
      }
      return <a {...props} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" />;
    },
    strong(props: any) {
      return <strong {...props} className="font-bold" />;
    },
    em(props: any) {
      return <em {...props} className="italic" />;
    }
  }), []); // Empty dependency array, create only once

  return (
    <div
      ref={containerRef}
      className={`streaming-v2-message ${isTyping ? 'typing' : ''}`}
      style={{
        contain: 'layout style paint',
        willChange: isStreaming || isTyping ? 'contents' : 'auto'
      }}
    >
      {/* Main content */}
      <div
        className={`message-content markdown-body ${
          (isStreaming || isTyping) && uiConfig.showCursor
            ? `with-inline-cursor cursor-${uiConfig.cursorAnimation}`
            : ''
        }`}
        onClick={handleFastDisplay}
        style={{
          cursor: isTyping ? 'pointer' : 'default',
          minHeight: displayedText.trim().length === 0 ? '0' : 'auto'
        }}
      >
        {displayedText.trim().length > 0 && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {encodeMarkdownLinkSpaces(displayedText)}
          </ReactMarkdown>
        )}
      </div>
      
      {/* Performance metrics display */}
      {enableMetricsDisplay && streamingMetrics && (showMetrics || isStreaming || isTyping) && (
        <div 
          className="streaming-metrics"
          onClick={handleMetricsClick}
          style={{
            fontSize: '0.75rem',
            color: '#666',
            marginTop: '0.5rem',
            padding: '0.25rem 0.5rem',
            backgroundColor: '#f5f5f5',
            borderRadius: '0.25rem',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div className="metrics-summary">
            ⚡ {streamingMetrics.wordsPerSecond.toFixed(1)} words/s
            {streamingMetrics.timeToFirstContent && (
              <span className="ml-2">
                • {streamingMetrics.timeToFirstContent}ms TTFC
              </span>
            )}
          </div>
          
          {showMetrics && (
            <div className="metrics-detail" style={{ marginTop: '0.25rem', fontSize: '0.7rem' }}>
              <div>Total time: {streamingMetrics.totalTime}ms</div>
              <div>Fragments: {streamingMetrics.totalFragments} ({streamingMetrics.fragmentsPerSecond.toFixed(2)}/s)</div>
              <div>Content: {streamingMetrics.contentLength} chars, {streamingMetrics.wordCount} words</div>
              {streamingMetrics.latencyMetrics && (
                <div>
                  Latency: avg {streamingMetrics.latencyMetrics.average.toFixed(1)}ms, 
                  peak {streamingMetrics.latencyMetrics.peak}ms
                </div>
              )}
              {streamingMetrics.fragmentsByType && (
                <div>
                  Types: {Object.entries(streamingMetrics.fragmentsByType)
                    .map(([type, count]) => `${type}:${count}`)
                    .join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Completion indicator removed - maintain visual consistency before and after streaming */}
    </div>
  );
};

// ========== Smart Scroll Manager ==========

export class StreamingScrollManager {
  private container: HTMLElement;
  private isUserScrolling = false;
  private autoScrollThreshold: number;
  private userScrollTimeout: NodeJS.Timeout | null = null;
  private observerCallbacks: Array<() => void> = [];

  constructor(container: HTMLElement, autoScrollThreshold = 150) {
    this.container = container;
    this.autoScrollThreshold = autoScrollThreshold;
    this.setupScrollListeners();
    this.setupResizeObserver();
  }

  private setupScrollListeners(): void {
    const handleScroll = () => {
      this.isUserScrolling = true;
      
      // Clear previous timer
      if (this.userScrollTimeout) {
        clearTimeout(this.userScrollTimeout);
      }
      
      // Set user scroll end detection
      this.userScrollTimeout = setTimeout(() => {
        this.isUserScrolling = false;
      }, 1000);
    };

    this.container.addEventListener('scroll', handleScroll, { passive: true });
    this.container.addEventListener('wheel', handleScroll, { passive: true });
    this.container.addEventListener('touchmove', handleScroll, { passive: true });
  }

  private setupResizeObserver(): void {
    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => {
        this.handleContentChange();
      });
      
      resizeObserver.observe(this.container);
    }
  }

  /**
   * Handle streaming content update
   */
  handleStreamingUpdate(): void {
    this.handleContentChange();
  }

  /**
   * Handle content change
   */
  private handleContentChange(): void {
    // VSCode-style smart scroll: only auto-scroll when user is not actively scrolling
    if (!this.isUserScrolling) {
      const { scrollTop, scrollHeight, clientHeight } = this.container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      
      if (distanceFromBottom <= this.autoScrollThreshold) {
        this.scrollToBottom();
      }
    }
    
    // Notify observers
    this.notifyObservers();
  }

  /**
   * Force scroll to bottom
   */
  scrollToBottom(smooth = true): void {
    this.container.scrollTo({
      top: this.container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  /**
   * Check if auto-scroll should be triggered
   */
  shouldAutoScroll(): boolean {
    if (this.isUserScrolling) return false;
    
    const { scrollTop, scrollHeight, clientHeight } = this.container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    return distanceFromBottom <= this.autoScrollThreshold;
  }

  /**
   * Add content change observer
   */
  addObserver(callback: () => void): () => void {
    this.observerCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.observerCallbacks.indexOf(callback);
      if (index > -1) {
        this.observerCallbacks.splice(index, 1);
      }
    };
  }

  private notifyObservers(): void {
    for (const callback of this.observerCallbacks) {
      try {
        callback();
      } catch (error) {
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: { autoScrollThreshold?: number }): void {
    if (config.autoScrollThreshold !== undefined) {
      this.autoScrollThreshold = config.autoScrollThreshold;
    }
  }

  /**
   * Destroy manager
   */
  destroy(): void {
    if (this.userScrollTimeout) {
      clearTimeout(this.userScrollTimeout);
    }
    this.observerCallbacks.length = 0;
  }
}

export default StreamingV2Message;
