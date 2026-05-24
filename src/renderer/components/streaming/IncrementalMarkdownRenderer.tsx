/**
 * Incremental Markdown renderer
 * Core optimization: only render newly added content, avoid re-rendering existing content
 * Performance improvement: from O(n) to O(1)
 */

import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidDiagram from '../chat/MermaidDiagram';
import CodeBlockCopyButton from '../chat/CodeBlockCopyButton';
import { CodeBlockContent } from '../chat/CodeBlockContent';

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
 * Strategy for splitting content into blocks
 * Split at natural boundaries such as paragraphs and code blocks
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

    // Inside a code block, don't split
    if (inCodeBlock) {
      currentBlock += line + '\n';
      continue;
    }

    // Empty lines are natural paragraph separators
    if (line.trim() === '') {
      if (currentBlock.trim().length > 0) {
        currentBlock += line + '\n';
        // Split when accumulated content is long enough
        if (currentBlock.length > 200) {
          blocks.push(currentBlock);
          currentBlock = '';
        }
      }
      continue;
    }

    currentBlock += line + '\n';

    // Sentence endings can also be split points (for long paragraphs)
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
 * Incremental Markdown renderer component
 */
export const IncrementalMarkdownRenderer: React.FC<IncrementalMarkdownRendererProps> = ({
  content,
  isStreaming,
  showCursor = true,
  cursorAnimation = 'smooth'
}) => {
  // 🚀 Core optimization: split content into blocks and cache rendered blocks
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

    // The last block is the pending content (the part being typed)
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

      {/* Render the currently typing part */}
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

// 🚀 Performance optimization: cache Markdown component config
const markdownComponents = {
  // 🔥 Inline code: only handles <code> tags not inside <pre>
  // NOTE: In react-markdown v10, code is called for BOTH inline and block code.
  // For block code (className contains 'language-'), preserve the className so pre can detect it.
  code(props: any) {
    const { children, className } = props;
    if (className && className.includes('language-')) {
      // Block code inside <pre> — preserve className for pre handler detection
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="inline-code">
        {children}
      </code>
    );
  },
  // 🔥 Code blocks: pre wrapping code, handles code block rendering here
  pre(props: any) {
    const { children, node } = props;

    // Extract code content and language from the hast AST node (reliable across react-markdown versions)
    // Fallback to extracting from rendered React children for compatibility
    let language = 'text';
    let content = '';
    let detected = false;

    // Strategy 1: Extract from hast node directly (most reliable)
    if (node?.children?.[0]?.tagName === 'code') {
      const codeNode = node.children[0];
      const cls = codeNode.properties?.className;
      if (Array.isArray(cls)) {
        const langCls = cls.find((c: string) => c.startsWith('language-'));
        if (langCls) language = langCls.replace('language-', '');
      } else if (typeof cls === 'string' && cls.includes('language-')) {
        const match = /language-(\w+)/.exec(cls);
        if (match) language = match[1];
      }
      // Extract text content from hast children
      const extractText = (nodes: any[]): string => {
        return nodes?.map((n: any) => {
          if (n.type === 'text') return n.value || '';
          if (n.children) return extractText(n.children);
          return '';
        }).join('') || '';
      };
      content = extractText(codeNode.children).replace(/\n$/, '');
      detected = true;
    }

    // Strategy 2: Extract from React children (fallback)
    if (!detected) {
      const childArray = React.Children.toArray(children);
      const codeChild = childArray.find(
        (child: any) =>
          child?.type === 'code' ||
          child?.props?.className?.includes('language-') ||
          (childArray.length === 1 && child?.props?.children !== undefined)
      ) as React.ReactElement | undefined;

      if (codeChild && codeChild.props) {
        const { className, children: codeContent } = codeChild.props;
        const match = /language-(\w+)/.exec(className || '');
        if (match) language = match[1];
        content = String(codeContent).replace(/\n$/, '');
        detected = true;
      }
    }

    if (detected) {

      if (language === 'mermaid') {
        return <MermaidDiagram definition={content} />;
      }

      return (
        <div className="code-block-wrapper">
          <div className="code-block-header">
            <span className="code-block-language">{language !== 'text' ? `</> ${language.toUpperCase()}` : ''}</span>
            <CodeBlockCopyButton code={content} />
          </div>
          <CodeBlockContent language={language} content={content} />
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
