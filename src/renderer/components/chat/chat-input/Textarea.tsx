import React, { useRef, useEffect } from 'react';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import {
  getCurrentSearchQuery,
  insertMention,
  ContextOption,
  ContextMenuOptionType,
  ContextMenuTriggerType,
  MentionSourceType,
  getContextMenuTriggerType,
  getCurrentSkillSearchQuery,
  insertSkillMention,
} from '@/lib/chat/contextMentions';
import { MentionHighlight } from '../MentionHighlight';
import { getChatInputEnterAction } from '@/lib/chat/chatInputKeyboard';
import { ContextMenuAtom, zeroContextMenuState } from './context-menu.atom';
import { atom } from '@/atom';
import { handleTextareaPaste } from './textareaPaste';
import { useI18n } from '../../../lib/i18n/useI18n';

const NOOP = () => {};
function useContextMenu(enabled?: boolean) {
  const [contextMenuState, actions] = ContextMenuAtom.use();
  if (enabled) {
    return [contextMenuState, {
      onContextMenuTrigger: actions.triggerMenu,
      onContextMenuClose: actions.closeMenu,
      onContextMenuNavigate: actions.navigateMenu,
      onContextMenuHover: actions.hoverMenu,
      onContextMenuSelect: actions.selectMenu,
    }] as const;
  }
  return [zeroContextMenuState, {
    onContextMenuTrigger: NOOP,
    onContextMenuClose: NOOP,
    onContextMenuNavigate: NOOP,
    onContextMenuHover: NOOP,
    onContextMenuSelect: NOOP,
  }] as const;
}

interface TextAreaProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  readOnly: boolean;
  title: string;
  supportsImages: boolean;
  enableContextMenu?: boolean;
  handleSend: () => void;
  handleImageSelect: (file: File) => Promise<void>;
  textareaStateAtom: TextareaStateAtom;
  onDraftChange?: (text: string) => void;
  updatePromptHistoryDraft?: boolean;
}

export function createTextareaAtom() {
  return atom('', (get, set) => ({ get, set }));
}

export type TextareaStateAtom = ReturnType<typeof createTextareaAtom>;

export function TextArea(props: TextAreaProps) {
  const {
    textareaRef,
    title,
    readOnly,
    supportsImages,
    enableContextMenu,
    handleSend,
    handleImageSelect,
    textareaStateAtom,
    onDraftChange,
    updatePromptHistoryDraft = true,
  } = props;
  const { t } = useI18n();
  const isNavigatingHistory = useRef(false);
  const [contextMenuState, {
    onContextMenuTrigger,
    onContextMenuClose,
    onContextMenuNavigate,
    onContextMenuHover,
    onContextMenuSelect,
  }] = useContextMenu(enableContextMenu);
  const [message, { set: setMessage }] = textareaStateAtom.use();
  const onDraftChangeRef = useRef(onDraftChange);
  const updatePromptHistoryDraftRef = useRef(updatePromptHistoryDraft);

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    updatePromptHistoryDraftRef.current = updatePromptHistoryDraft;
  }, [updatePromptHistoryDraft]);

  const setDraftMessage = (text: string, options?: { updatePromptHistoryDraft?: boolean }) => {
    setMessage(text);
    onDraftChangeRef.current?.(text);
    if (updatePromptHistoryDraftRef.current && options?.updatePromptHistoryDraft !== false) {
      profileDataManager.setCurrentEditingPrompt(text);
    }
  };

  const getCursorPosition = (): {
    position: number;
    isAtStart: boolean;
    isAtEnd: boolean;
    isInMiddle: boolean;
  } => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return { position: 0, isAtStart: true, isAtEnd: true, isInMiddle: false };
    }

    const position = textarea.selectionStart;
    const textLength = message.length;
    const isAtStart = position === 0;
    const isAtEnd = position === textLength;
    const isInMiddle = !isAtStart && !isAtEnd && textLength > 0;

    return { position, isAtStart, isAtEnd, isInMiddle };
  };

  const setCursorPosition = (position: number) => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.setSelectionRange(position, position);
      textarea.focus();
    }
  };

  const getInputContainerRect = (): DOMRect | null => {
    const container =
      (textareaRef.current?.closest('.textarea-layer-container') as HTMLElement | null) ||
      (textareaRef.current?.closest('.chat-input-container') as HTMLElement | null);
    return container?.getBoundingClientRect() || null;
  };

  const handleMentionSelect = (option: ContextOption, fromKeyboard: boolean = false) => {
    if (!textareaRef.current) return;

    if (!option.relativePath && !option.value) {

      if (fromKeyboard) {
        onContextMenuClose();
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }, 0);
      }

      return;
    }

    const currentText = textareaRef.current.value;
    const cursorPos = textareaRef.current.selectionStart;
    const pathToInsert = option.value || option.relativePath || '';

    let sourceType: MentionSourceType | undefined;
    if (option.type === ContextMenuOptionType.KnowledgeBase) {
      sourceType = MentionSourceType.KnowledgeBase;
    } else if (option.type === ContextMenuOptionType.ChatSession) {
      sourceType = MentionSourceType.ChatSession;
    }

    const { newText, newCursorPos } = insertMention(
      currentText,
      cursorPos,
      pathToInsert,
      sourceType,
    );

    setDraftMessage(newText);
    onContextMenuClose?.();

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  useEffect(() => {
    const handleMentionSelectEvent = (e: CustomEvent) => {
      const { option } = e.detail;
      handleMentionSelect(option);
    };

    window.addEventListener(
      'context:mentionSelect',
      handleMentionSelectEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'context:mentionSelect',
        handleMentionSelectEvent as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const handleSkillMentionSelectEvent = (e: CustomEvent) => {
      const { skillName } = e.detail;
      if (!textareaRef.current || !skillName) return;

      const currentText = textareaRef.current.value;
      const cursorPos = textareaRef.current.selectionStart;
      const { newText, newCursorPos } = insertSkillMention(
        currentText,
        cursorPos,
        skillName,
      );

      setDraftMessage(newText);
      onContextMenuClose();

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    };

    window.addEventListener(
      'context:skillMentionSelect',
      handleSkillMentionSelectEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'context:skillMentionSelect',
        handleSkillMentionSelectEvent as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const handleFillInputEvent = (e: CustomEvent) => {
      const { text } = e.detail;

      if (text && typeof text === 'string') {
        setDraftMessage(text);

        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(text.length, text.length);
          }
        }, 0);
      }
    };

    window.addEventListener(
      'agent:fillInput',
      handleFillInputEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'agent:fillInput',
        handleFillInputEvent as EventListener,
      );
    };
  }, []);

  // Listen for triggerMention events — insert '@' and open context menu
  useEffect(() => {
    const handleTriggerMention = (e: Event) => {
      const focusIndex = (e as CustomEvent)?.detail?.focusIndex;
      setDraftMessage('@');
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(1, 1);
          const inputRect = getInputContainerRect();
          if (inputRect) {
            onContextMenuTrigger?.('', inputRect, ContextMenuTriggerType.Workspace);
            // If a focusIndex was requested, dispatch it after menu opens
            if (typeof focusIndex === 'number') {
              setTimeout(() => {
                onContextMenuHover(focusIndex);
              }, 50);
            }
          }
        }
      }, 50);
    };
    window.addEventListener('chatInput:triggerMention', handleTriggerMention);
    return () => {
      window.removeEventListener('chatInput:triggerMention', handleTriggerMention);
    };
  }, []);

  // Handle history navigation
  const handleHistoryNavigation = (direction: 'up' | 'down') => {
    const { isAtStart, isAtEnd, isInMiddle } = getCursorPosition();


    if (direction === 'up') {
      if (isAtStart) {
        // Cursor at start, switch to previous prompt
        const previousPrompt = profileDataManager.getPreviousPrompt();
        if (previousPrompt !== null) {
          isNavigatingHistory.current = true;
          setDraftMessage(previousPrompt, { updatePromptHistoryDraft: false });
          // After selecting up, cursor defaults to start
          setTimeout(() => {
            setCursorPosition(0);
            isNavigatingHistory.current = false;
          }, 0);
        }
      } else {
        // Cursor at middle or end, move to start
        setCursorPosition(0);
      }
    } else if (direction === 'down') {
      if (isAtEnd) {
        // Cursor at end, switch to next prompt
        const nextPrompt = profileDataManager.getNextPrompt();
        if (nextPrompt !== null) {
          isNavigatingHistory.current = true;
          setDraftMessage(nextPrompt, { updatePromptHistoryDraft: false });
          // After selecting down, cursor defaults to end
          setTimeout(() => {
            setCursorPosition(nextPrompt.length);
            isNavigatingHistory.current = false;
          }, 0);
        }
      } else {
        // Cursor at start or middle, move to end
        setCursorPosition(message.length);
      }
    }
  };


  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Context menu keyboard navigation (high priority)
    if (contextMenuState.show && contextMenuState.options.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onContextMenuNavigate('up');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onContextMenuNavigate('down');
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') {
        e.preventDefault();
        const selectedOption = contextMenuState.options[contextMenuState.selectedIndex];

        // Handle Skill-type options (triggered by #)
        if (selectedOption.type === ContextMenuOptionType.Skill && selectedOption.value) {
          // Fire the skill mention selection event
          window.dispatchEvent(new CustomEvent('context:skillMentionSelect', {
            detail: { skillName: selectedOption.value }
          }));
          return;
        }

        // For default options (no relativePath or value), delegate to ChatView
        if (!selectedOption.relativePath && !selectedOption.value) {
          // Handled via ChatView's ContextMenu onSelect
          onContextMenuSelect(selectedOption);
        } else {
          // For options with an actual path (@ triggered file options), use handleMentionSelect
          handleMentionSelect(selectedOption, true);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onContextMenuClose();
        return;
      }
    }

    if (e.key === 'Enter') {
      const enterAction = getChatInputEnterAction({
        key: e.key,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
      });

      if (enterAction === 'ignore') {
        return;
      }

      if (enterAction === 'newline' && e.altKey) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const currentValue = textarea.value;
          const newValue = currentValue.substring(0, start) + '\n' + currentValue.substring(end);
          setDraftMessage(newValue);

          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 1;
          }, 0);
        }
        return;
      }

      if (enterAction === 'send') {
        e.preventDefault();
        handleSend();
        return;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleHistoryNavigation('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleHistoryNavigation('down');
    }
  };

  // Handle input content changes, monitor editing behavior
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setDraftMessage(newValue);

    // Check the trigger type (@ or #) using the unified triggerType check
    const triggerType = getContextMenuTriggerType(newValue, cursorPos);

    if (triggerType === ContextMenuTriggerType.Skill) {
      // # trigger: show the Skills list
      const query = getCurrentSkillSearchQuery(newValue, cursorPos);
      const inputRect = getInputContainerRect();
      if (inputRect) {
        onContextMenuTrigger(query, inputRect, ContextMenuTriggerType.Skill);
      }
    } else if (triggerType === ContextMenuTriggerType.Workspace) {
      // @ trigger: show workspace files
      const query = getCurrentSearchQuery(newValue, cursorPos);
      const inputRect = getInputContainerRect();
      if (inputRect) {
        onContextMenuTrigger(query, inputRect, ContextMenuTriggerType.Workspace);
      }
    } else {
      onContextMenuClose();
    }

    // Prompt-history navigation updates visible text only. The saved draft is
    // overwritten when the user edits again.
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    await handleTextareaPaste({
      event: e,
      message,
      supportsImages,
      textarea: textareaRef.current,
      setDraftMessage,
      handleImageSelect,
      getUnsupportedImageMessage: (type) => t('chat.attachments.unsupportedPastedImage', { type }),
    });
  };


  return (
    <div className="textarea-layer-container">
      {/* Highlight layer (below the textarea) */}
      <MentionHighlight text={message} textareaRef={textareaRef} />

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={message}
        onChange={handleMessageChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        readOnly={readOnly}
        title={title}
        placeholder={
          supportsImages
            ? t('chat.input.placeholderWithImages')
            : t('chat.input.placeholderTextOnly')
        }
        className="chat-textarea"
      />
    </div>
  );
}
