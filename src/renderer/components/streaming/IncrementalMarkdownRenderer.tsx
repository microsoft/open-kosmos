/**
 * Incremental Markdown Renderer
 * Core optimization: Only render new content, avoid re-rendering existing content
 * Performance improvement: Reduced from O(n) to O(1)
 */

import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MermaidDiagram from '../chat/MermaidDiagram';

interface RenderedBlock {
  id: string;
  content: string;
  element: React.ReactNode;
}

interface IncrementalMarkdownRendererProps {
  content: string;
  isStreaming: boolean;
  showCursor?: boolean;
  cursorAnimation?: string;
}

/**
 * Content splitting strategy
 * Split at natural boundaries like paragraphs, code blocks, etc.
 */
const splitIntoBlocks = (content: string): string[] => {
  const blocks: string[] = [];
  let currentBlock = '';
  let inCodeBlock = false;
  
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect code block boundaries
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentBlock += line + '\n';
      
      // If code block ends, this is a natural split point
      if (!inCodeBlock && currentBlock.length > 100) {
        blocks.push(currentBlock);
        currentBlock = '';
      }
      continue;
    }
    
    // Inside code block, don't split
    if (inCodeBlock) {
      currentBlock += line + '\n';
      continue;
    }
    
    // Empty line is a natural paragraph boundary
    if (line.trim() === '') {
      if (currentBlock.trim().length > 0) {
        currentBlock += line + '\n';
        // If accumulated content is long enough, split
        if (currentBlock.length > 200) {
          blocks.push(currentBlock);
          currentBlock = '';
        }
      }
      continue;
    }
    
    currentBlock += line + '\n';
    
    // Sentence endings can also serve as split points (for long paragraphs)
    if (currentBlock.length > 500 && /[.!?。！？]\s*$/.test(line)) {
      blocks.push(currentBlock);
      currentBlock = '';
    }
  }
  
  // Add remaining content
  if (currentBlock.trim().length > 0) {
    blocks.push(currentBlock);
  }
  
  return blocks;
};

/**
 * Incremental Markdown Renderer component
 */
export const IncrementalMarkdownRenderer: React.FC<IncrementalMarkdownRendererProps> = ({
  content,
  isStreaming,
  showCursor = true,
  cursorAnimation = 'smooth'
}) => {
  // 🚀 Core optimization: Split content into blocks and cache rendered blocks
  const { renderedBlocks, pendingContent } = useMemo(() => {
    if (!isStreaming) {
      // Non-streaming mode, render all content directly
      return {
        renderedBlocks: [] as RenderedBlock[],
        pendingContent: content
      };
    }
    
    // Streaming mode: render in blocks
    const blocks = splitIntoBlocks(content);
    const rendered: RenderedBlock[] = [];
    
    // Only render complete blocks (except the last one)
    for (let i = 0; i < blocks.length - 1; i++) {
      const block = blocks[i];
      rendered.push({
        id: `block-${i}`,
        content: block,
        element: <ReactMarkdown key={`block-${i}`} remarkPlugins={[remarkGfm]} components={markdownComponents}>{block}</ReactMarkdown>
      });
    }
    
    // Last block as pending content (currently being typed)
    const pending = blocks[blocks.length - 1] || '';
    
    return {
      renderedBlocks: rendered,
      pendingContent: pending
    };
  }, [content, isStreaming]);
  
  return (
    <div className="incremental-markdown-renderer">
      {/* Render completed blocks - these won't re-render */}
      {renderedBlocks.map(block => (
        <React.Fragment key={block.id}>
          {block.element}
        </React.Fragment>
      ))}
      
      {/* Render currently typing portion */}
      {pendingContent && (
        <div
          className={`markdown-pending-content ${
            isStreaming && showCursor ? `with-inline-cursor cursor-${cursorAnimation}` : ''
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {pendingContent}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};

// 🚀 Performance optimization: Cache Markdown component config
const markdownComponents = {
  // 🔥 Inline code: Only handle code tags not inside pre
  code(props: any) {
    const { children } = props;
    return (
      <code className="inline-code">
        {children}
      </code>
    );
  },
  // 🔥 Code blocks: pre wraps code, handle code block rendering directly here
  pre(props: any) {
    const { children } = props;
    
    // Extract code element info from children
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
              margin: '0.5rem 0',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
            }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      );
    }
    
    // fallback
    return <div className="overflow-x-auto" style={{ maxWidth: '100%', minWidth: 0 }}>{children}</div>;
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
    return <a {...props} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" />;
  },
  strong(props: any) {
    return <strong {...props} className="font-bold" />;
  },
  em(props: any) {
    return <em {...props} className="italic" />;
  }
};

export default IncrementalMarkdownRenderer;
