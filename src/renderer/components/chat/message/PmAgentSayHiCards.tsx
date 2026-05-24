/**
 * PmAgentSayHiCards Component
 *
 * Renders the hardcoded action cards that appear each time PM Agent opens a
 * new chat session.  Card data comes entirely from `pmAgentSayHiConfig.ts` so
 * that content changes only require editing that one file.
 *
 * Layout: a horizontal row of cards. The first card navigates to the
 * project-agent creation page on click. Cards may also open the feedback
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND_CONFIG } from '@shared/constants/branding';
import {
  PM_AGENT_SAY_HI_CARDS,
  PM_AGENT_SAY_HI_CARDS_DELIMITER,
  PmAgentSayHiCard,
} from '../../../config/pmAgentSayHiConfig';
import '../../../styles/PmAgentSayHiCards.css';
import { createLogger } from '../../../lib/utilities/logger';
import { sendUserPrompt } from '@/lib/chat/sendUserMessageOptimistically';
const logger = createLogger('[PmAgentSayHiCards]');

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Check whether `rawText` is a PM Agent say-hi message and, if so, return the
 * markdown greeting body (text before the delimiter).
 *
 * Returns `null` when the delimiter is not present.
 */
export function parsePmAgentSayHiMessage(rawText: string): {
  markdownBody: string;
} | null {
  const idx = rawText.indexOf(PM_AGENT_SAY_HI_CARDS_DELIMITER);
  if (idx === -1) return null;
  return { markdownBody: rawText.slice(0, idx).trimEnd() };
}

// ─── Component ───────────────────────────────────────────────────────────────

const PmAgentSayHiCards: React.FC = () => {
  const navigate = useNavigate();

  const handleClick = useCallback((card: PmAgentSayHiCard) => {
    if (card.action === 'createProjectAgent') {
      navigate('/agent/chat/creation/pm-project');
      return;
    }

    if (card.action === 'openFeedbackChannel') {
      const feedbackLink = BRAND_CONFIG.feedbackLink;
      if (feedbackLink) {
        window.open(feedbackLink, '_blank');
      } else {
        logger.warn('[PmAgentSayHiCards] No feedbackLink configured in BRAND_CONFIG');
      }
      return;
    }

    // Default: send prompt as chat message
    const prompt = card.prompt ?? card.description;
    sendUserPrompt(prompt);
  }, [navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, card: PmAgentSayHiCard) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick(card);
      }
    },
    [handleClick],
  );

  return (
    <div className="pm-agent-say-hi-cards">
      {PM_AGENT_SAY_HI_CARDS.map((card, idx) => (
        <div
          key={idx}
          className={`pm-agent-say-hi-card${idx === 0 ? ' pm-agent-say-hi-card--featured' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => handleClick(card)}
          onKeyDown={(e) => handleKeyDown(e, card)}
        >
          <div className="pm-agent-say-hi-card-header">
            <span className="pm-agent-say-hi-card-emoji">{card.emoji}</span>
            <h4 className="pm-agent-say-hi-card-title">{card.title}</h4>
          </div>
          <p className="pm-agent-say-hi-card-description">{card.description}</p>
        </div>
      ))}
    </div>
  );
};

export default PmAgentSayHiCards;
