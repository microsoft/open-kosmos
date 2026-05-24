/**
 * PmProjectSayHiCards Component
 *
 * Renders a vertical list of SayHiCard onboarding items for newly created
 * project agents. Clicking a card either dispatches the card's
 * prompt/description as a runs one of the
 * remaining KB-specific actions.
 *
 * Card format (each line after <!-- PM_SAY_HI_CARDS --> delimiter):
 *   emoji|Title text|Description text|Optional prompt sent on click|Optional kbAction
 */

import React, { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import SayHiCard from './SayHiCard';
import { useChats } from '../../userData/userDataProvider';
import { usePasteToWorkspace } from '../workspace/PasteToWorkspaceProvider';
import { useToast } from '../../ui/ToastProvider';
import { copyPathsToWorkspace, clearFileTreeCache } from '../../../lib/chat/workspaceOps';
import '../../../styles/PmProjectSayHiCards.css';
import { createLogger } from '../../../lib/utilities/logger';
import { WorkspaceExplorerAtom } from '../chat-side.atom';
import { sendUserPrompt } from '@/lib/chat/sendUserMessageOptimistically';
const logger = createLogger('[PmProjectSayHiCards]');

/** Delimiter that separates the markdown body from the PM-style card list. */
export const PM_SAY_HI_CARDS_DELIMITER = '<!-- PM_SAY_HI_CARDS -->';

/** A single onboarding card item. */
export interface PmSayHiCard {
  /** Emoji icon displayed on the left. */
  emoji: string;
  /** Bold title text. */
  title: string;
  /** Muted description shown on the card. */
  description: string;
  /** Optional prompt sent as a chat message when clicked. */
  prompt?: string;
  /**
   * Optional KB action type. When present, clicking navigates to the KB
   * configuration page and triggers the corresponding action instead of
   * sending a chat message.
   * Values: 'addFiles' | 'pasteText'
   */
  kbAction?: string;
}

/**
 * Parse a Say-Hi message body and extract PM-style card data.
 *
 * Returns `{ markdownBody, cards }` when the PM_SAY_HI_CARDS_DELIMITER is
 * present, or `null` when it is absent (so the caller can fall back to the
 * legacy chip renderer).
 */
export function parsePmSayHiCards(rawText: string): {
  markdownBody: string;
  cards: PmSayHiCard[];
} | null {
  const delimiterIndex = rawText.indexOf(PM_SAY_HI_CARDS_DELIMITER);
  if (delimiterIndex === -1) return null;

  const markdownBody = rawText.slice(0, delimiterIndex).trimEnd();
  const cardsSection = rawText.slice(delimiterIndex + PM_SAY_HI_CARDS_DELIMITER.length);

  const cards: PmSayHiCard[] = cardsSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split('|');
      const emoji = parts[0]?.trim() ?? '';
      const title = parts[1]?.trim() ?? '';
      // Last field may be an optional kbAction; remaining content is description + optional prompt
      const lastPart = parts[parts.length - 1]?.trim() ?? '';
      const knownActions = ['addFiles', 'pasteText'];
      const hasKbAction = parts.length >= 4 && knownActions.includes(lastPart);
      const kbAction = hasKbAction ? lastPart : undefined;
      const contentParts = hasKbAction ? parts.slice(2, -1) : parts.slice(2);
      const description = contentParts[0]?.trim() ?? '';
      const prompt = contentParts.length > 1
        ? contentParts.slice(1).join('|').trim()
        : undefined;
      return { emoji, title, description, prompt, kbAction };
    })
    .filter(card => card.title && card.description);

  return { markdownBody, cards };
}

interface PmProjectSayHiCardsProps {
  cards: PmSayHiCard[];
  /** chatId of the current agent chat — used to look up the KB workspace path. */
  chatId?: string;
}

const PmProjectSayHiCards: React.FC<PmProjectSayHiCardsProps> = ({ cards, chatId: chatIdProp }) => {
  const { chatId: paramChatId } = useParams<{ chatId: string }>();
  // Prefer the explicit prop; fall back to the URL param so the component
  // works correctly even before ChatView's async `fetchChatStatus` resolves.
  const chatId = chatIdProp || paramChatId;
  const { chats } = useChats();
  const { openPasteDialog } = usePasteToWorkspace();
  const { showError, showToast } = useToast();
  const { effectiveReveal } = WorkspaceExplorerAtom.useChange();

  const getKbPath = useCallback((): string => {
    const chat = chats.find(c => c.chat_id === chatId);
    return chat?.agent?.knowledge?.knowledgeBase || chat?.agent?.knowledgeBase || '';
  }, [chats, chatId]);

  const showKnowledgeBaseToast = useCallback((message: string, kbPath: string) => {
    showToast(message, 'success', 5000, {
      actions: [
        {
          label: 'View Files',
          onClick: () =>  effectiveReveal(kbPath),
          variant: 'primary',
        },
      ],
    });
  }, [showToast]);

  const handleClick = useCallback(async (card: PmSayHiCard) => {
    logger.debug('[PmProjectSayHiCards] Card clicked:', { title: card.title, kbAction: card.kbAction, chatIdProp, paramChatId, resolvedChatId: chatId });

    if (!card.kbAction) {
      sendUserPrompt(card.prompt ?? card.description);
      return;
    }

    const kbPath = getKbPath();
    logger.debug('[PmProjectSayHiCards] Resolved kbPath:', { chatId, kbPath });

    if (!kbPath) {
      logger.error('[PmProjectSayHiCards] KB path is empty — chatId may be unresolved:', { chatIdProp, paramChatId, chatId, card });
      return;
    }

    if (card.kbAction === 'pasteText') {
      logger.debug('[PmProjectSayHiCards] Opening paste dialog, kbPath:', kbPath);
      openPasteDialog(kbPath, kbPath, () => {
        showKnowledgeBaseToast('Saved pasted text to Agent Knowledge Files.', kbPath);
      });
    } else if (card.kbAction === 'addFiles') {
      try {
        logger.debug('[PmProjectSayHiCards] Calling fs.selectFiles...');
        const result = await window.electronAPI?.fs?.selectFiles?.({
          title: 'Select Files or Folders to Add',
          allowMultiple: true,
        });
        logger.debug('[PmProjectSayHiCards] selectFiles result:', result);
        if (!result?.success || !result.filePaths || result.filePaths.length === 0) {
          logger.debug('[PmProjectSayHiCards] File selection canceled or no files selected');
          return;
        }

        const copyResult = await copyPathsToWorkspace(result.filePaths, kbPath, {
          conflictResolution: 'prompt',
        });

        if (!copyResult.success) {
          if (copyResult.canceled) {
            return;
          }
          showError(copyResult.error || 'Failed to load files into Agent Knowledge Files.');
          return;
        }

        const successCount = copyResult.data?.successCount ?? 0;
        const failureCount = copyResult.data?.failCount ?? 0;
        const skippedCount = copyResult.data?.skippedCount ?? 0;

        if (successCount === 0 && skippedCount > 0) {
          showToast(`Skipped ${skippedCount} conflicting item${skippedCount === 1 ? '' : 's'}.`, 'info', 5000, {
            actions: [
              {
                label: 'View Files',
                onClick: () => effectiveReveal(kbPath),
                variant: 'primary',
              },
            ],
          });
          return;
        }

        if (successCount === 0) {
          showError('Failed to load files into Agent Knowledge Files.');
          return;
        }

        logger.debug('[PmProjectSayHiCards] Clearing file tree cache for:', kbPath);
        await clearFileTreeCache(kbPath);

        const itemLabel = successCount === 1 ? 'item' : 'items';
        const skippedMessage = skippedCount > 0
          ? ` ${skippedCount} conflicting item${skippedCount === 1 ? '' : 's'} skipped.`
          : '';
        const failureMessage = failureCount > 0
          ? ` ${failureCount} failed to import.`
          : '';
        const message = `Loaded ${successCount} ${itemLabel} into Agent Knowledge Files.${skippedMessage}${failureMessage}`;

        if (failureCount > 0 || skippedCount > 0) {
          showToast(message, skippedCount > 0 && failureCount === 0 ? 'info' : 'warning', 5000, {
            actions: [
              {
                label: 'View Files',
                onClick: () => effectiveReveal(kbPath),
                variant: 'primary',
              },
            ],
          });
        } else {
          showKnowledgeBaseToast(message, kbPath);
        }
        logger.debug('[PmProjectSayHiCards] Done — files added to KB successfully');
      } catch (error) {
        logger.error('[PmProjectSayHiCards] Error adding files:', error);
        showError('Failed to load files into Agent Knowledge Files.');
      }
    }
  }, [chatIdProp, paramChatId, chatId, getKbPath, openPasteDialog, showError, showKnowledgeBaseToast, showToast]);

  if (!cards || cards.length === 0) return null;

  return (
    <div className="pm-say-hi-cards">
      {cards.map((card, idx) => (
        <SayHiCard
          key={idx}
          emoji={card.emoji}
          title={card.title}
          description={card.description}
          onClick={() => handleClick(card)}
        />
      ))}
    </div>
  );
};

export default PmProjectSayHiCards;
