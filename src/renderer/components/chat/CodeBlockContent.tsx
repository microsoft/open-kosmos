/**
 * CodeBlockContent — renders fenced code block body.
 *
 * For most languages, uses SyntaxHighlighter (Prism) for syntax coloring.
 * For 'markdown', 'md', and 'text', renders as plain preformatted text — Prism's
 * markdown highlighter re-parses nested fences/tables and silently breaks rendering.
 */

import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const PLAIN_TEXT_LANGUAGES = new Set(['markdown', 'md', 'text']);

export const CodeBlockContent: React.FC<{ language: string; content: string }> = ({ language, content }) => {
  if (PLAIN_TEXT_LANGUAGES.has(language)) {
    return (
      <div style={{
        background: 'rgb(40,44,52)',
        borderRadius: '0 0 0.375rem 0.375rem',
        padding: '1em',
        overflow: 'auto',
        fontSize: '0.875rem',
      }}>
        <pre style={{ margin: 0, whiteSpace: 'pre', color: '#abb2bf', fontFamily: 'var(--font-mono)' }}>
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <SyntaxHighlighter
      PreTag="div"
      language={language}
      style={oneDark}
      customStyle={{
        margin: 0,
        borderRadius: '0 0 0.375rem 0.375rem',
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
  );
};

export default CodeBlockContent;
