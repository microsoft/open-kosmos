/**
 * SayHiActionItems Component
 *
 * Renders clickable action-item chips extracted from a Say-Hi message.
 * Supports optional grouping via `## Group Title` headers inside the
 * action-items section.
 *
 */

import React from 'react';
import { MessageCircle } from 'lucide-react';
import '../../../styles/SayHiActionItems.css';
import { sendUserPrompt } from '@/lib/chat/sendUserMessageOptimistically';

/** Delimiter that separates the markdown body from the action items list. */
export const SAY_HI_ACTION_ITEMS_DELIMITER = '<!-- SAY_HI_ACTION_ITEMS -->';

/** A group of action items with an optional title. */
export interface ActionItemGroup {
  /** Group heading (e.g. "📂 Add context from local files"). Empty string for the default/ungrouped block. */
  title: string;
  /** Prompt strings displayed as clickable chips. */
  items: string[];
}

/**
 * Parse a Say-Hi message's raw text content and split it into the
 * displayable markdown body and an array of action-item groups.
 *
 * Lines starting with `## ` inside the action-items section are treated
 * as group headings. If no headings are present all items land in a
 * single group with an empty title.
 */
export function parseSayHiContent(rawText: string): {
  markdownBody: string;
  actionItems: string[];
  actionItemGroups: ActionItemGroup[];
} {
  const delimiterIndex = rawText.indexOf(SAY_HI_ACTION_ITEMS_DELIMITER);

  if (delimiterIndex === -1) {
    return { markdownBody: rawText, actionItems: [], actionItemGroups: [] };
  }

  const markdownBody = rawText.slice(0, delimiterIndex).trimEnd();
  const actionSection = rawText.slice(delimiterIndex + SAY_HI_ACTION_ITEMS_DELIMITER.length);

  const lines = actionSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Build groups
  const groups: ActionItemGroup[] = [];
  let currentGroup: ActionItemGroup = { title: '', items: [] };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Flush previous group if it has items
      if (currentGroup.items.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = { title: line.slice(3).trim(), items: [] };
    } else {
      currentGroup.items.push(line);
    }
  }
  // Flush last group
  if (currentGroup.items.length > 0) {
    groups.push(currentGroup);
  }

  // Flat list for backward compatibility
  const actionItems = groups.flatMap(g => g.items);

  return { markdownBody, actionItems, actionItemGroups: groups };
}

interface SayHiActionItemsProps {
  /** Grouped action-item prompts to display. */
  groups: ActionItemGroup[];
}

const SayHiActionItems: React.FC<SayHiActionItemsProps> = ({ groups }) => {
  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <div className="say-hi-action-items">
      {groups.map((group, gIdx) => (
        <div key={`group-${gIdx}`} className="say-hi-action-group">
          {group.title && (
            <div className="say-hi-action-group-title">{group.title}</div>
          )}
          <div className="say-hi-action-group-chips">
            {group.items.map((item, index) => (
              <button
                key={`action-${gIdx}-${index}`}
                className="say-hi-action-chip"
                onClick={() => sendUserPrompt(item)}
                title={item}
                type="button"
              >
                <MessageCircle size={14} className="say-hi-action-chip-icon" />
                <span className="say-hi-action-chip-text">{item}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SayHiActionItems;
