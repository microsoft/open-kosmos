import React, { useEffect, useRef } from 'react';
import { workspaceMentionRegex, knowledgeBaseMentionRegex, chatSessionMentionRegex, skillMentionRegex } from '../../lib/chat/contextMentions';

interface MentionHighlightProps {
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

export const MentionHighlight: React.FC<MentionHighlightProps> = ({ text, textareaRef }) => {
  const highlightRef = useRef<HTMLDivElement>(null);

  // Sync scroll position and height
  useEffect(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    
    if (!textarea || !highlight) return;

    // 🔧 FIX: Sync scroll position (vertical and horizontal)
    const syncScroll = () => {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    };

    // 🔧 FIX: Sync height changes (when textarea auto-resizes)
    const syncHeight = () => {
      const textareaHeight = textarea.style.height;
      if (textareaHeight) {
        highlight.style.height = textareaHeight;
      }
    };

    // Initial sync
    syncHeight();
    syncScroll();

    // Listen for scroll events
    textarea.addEventListener('scroll', syncScroll);
    
    // Listen for height changes (using MutationObserver)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          syncHeight();
        }
      });
    });

    observer.observe(textarea, {
      attributes: true,
      attributeFilter: ['style']
    });

    return () => {
      textarea.removeEventListener('scroll', syncScroll);
      observer.disconnect();
    };
  }, [textareaRef]);

  // Escape HTML special characters
  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Highlight [@workspace:...] and [#skill:...] mentions
  const highlightMentions = (text: string): string => {
    if (!text) return '';

    // Escape the entire text first
    let result = escapeHtml(text);

    // 🔧 FIX: Replace [@workspace:...] mentions with highlight marks (supports spaces in paths, backward compatible)
    // Match complete [...] bracket content
    result = result.replace(
      /\[@workspace:([^\]]+)\]/g,
      (match) => `<mark class="mention-highlight workspace-mention">${match}</mark>`
    );

    // 🆕 Replace [@knowledge-base:...] mentions with highlight marks
    result = result.replace(
      /\[@knowledge-base:([^\]]+)\]/g,
      (match) => `<mark class="mention-highlight workspace-mention">${match}</mark>`
    );

    // 🆕 Replace [@chat-session:...] mentions with highlight marks
    result = result.replace(
      /\[@chat-session:([^\]]+)\]/g,
      (match) => `<mark class="mention-highlight workspace-mention">${match}</mark>`
    );

    // 🔧 FIX: Replace [#skill:...] mentions with highlight marks (supports spaces in names)
    result = result.replace(
      /\[#skill:([^\]]+)\]/g,
      (match) => `<mark class="mention-highlight skill-mention">${match}</mark>`
    );

    // Preserve line breaks
    return result.replace(/\n/g, '<br>');
  };

  return (
    <div
      ref={highlightRef}
      className="mention-highlight-layer"
      dangerouslySetInnerHTML={{ __html: highlightMentions(text) }}
    />
  );
};