import React, { useRef, useEffect } from 'react';
import { profileDataManager } from '@/lib/userData/profileDataManager';
import { validateImageFile } from '@shared/types/chatTypes';
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
}

export function createTextareaAtom() {
  return atom('', (get, set) => ({ get, set }));
}

export type TextareaStateAtom = ReturnType<typeof createTextareaAtom>;

export function TextArea(props: TextAreaProps) {
  const { textareaRef, title, readOnly, supportsImages, enableContextMenu, handleSend, handleImageSelect, textareaStateAtom } = props;
  // Used to prevent triggering edit monitoring when handling history
  const isNavigatingHistory = useRef(false);
  const [contextMenuState, {
    onContextMenuTrigger,
    onContextMenuClose,
    onContextMenuNavigate,
    onContextMenuHover,
    onContextMenuSelect,
  }] = useContextMenu(enableContextMenu);
  const [message, { set: setMessage }] = textareaStateAtom.use();


  // Get cursor position information
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

  // Set cursor position
  const setCursorPosition = (position: number) => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.setSelectionRange(position, position);
      textarea.focus();
    }
  };

  // Get the bounding rect of the ChatInput container
  const getInputContainerRect = (): DOMRect | null => {
    const container =
      (textareaRef.current?.closest('.textarea-layer-container') as HTMLElement | null) ||
      (textareaRef.current?.closest('.chat-input-container') as HTMLElement | null);
    return container?.getBoundingClientRect() || null;
  };

  // Handle mention selection
  const handleMentionSelect = (option: ContextOption, fromKeyboard: boolean = false) => {
    if (!textareaRef.current) return;

    // If this is the default option (no relativePath or value), close the menu
    // and let the existing ContextMenu onSelect flow handle it
    if (!option.relativePath && !option.value) {

      if (fromKeyboard) {
        // Keyboard selection: close the menu and restore focus
        onContextMenuClose();
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }, 0);
      }

      // Do nothing here; let ContextMenu's onSelect call ChatView's handler
      return;
    }

    // FIX: Read the current text from the DOM directly to avoid React state / DOM desync.
    // When the user types quickly, React state (message) may not yet reflect the DOM value.
    // Using the DOM value ensures cursorPos and text always agree.
    const currentText = textareaRef.current.value;
    const cursorPos = textareaRef.current.selectionStart;
    const pathToInsert = option.value || option.relativePath || '';

    // Determine sourceType from the option type
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

    setMessage(newText);
    onContextMenuClose?.();

    // Restore focus and set the cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // Listen for mention selection events from ChatView
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


  // Listen for skill mention selection events from ChatView
  useEffect(() => {
    const handleSkillMentionSelectEvent = (e: CustomEvent) => {
      const { skillName } = e.detail;
      if (!textareaRef.current || !skillName) return;

      // FIX: Read the current text from the DOM directly to avoid React state / DOM desync.
      // When the user types quickly, React state (message) may not yet reflect the DOM value.
      // Using the DOM value ensures cursorPos and text always agree.
      const currentText = textareaRef.current.value;
      const cursorPos = textareaRef.current.selectionStart;
      const { newText, newCursorPos } = insertSkillMention(
        currentText,
        cursorPos,
        skillName,
      );

      setMessage(newText);
      onContextMenuClose();

      // Restore focus and set the cursor position
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

  // Listen for fill-input-box events from AgentPage
  useEffect(() => {
    const handleFillInputEvent = (e: CustomEvent) => {
      const { text } = e.detail;

      if (text && typeof text === 'string') {
        setMessage(text);

        // Focus the input and move the cursor to the end
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
      setMessage('@');
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
          setMessage(previousPrompt);
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
          setMessage(nextPrompt);
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
          setMessage(newValue);

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

    setMessage(newValue);

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

    // If not navigating history, record as editing behavior
    if (!isNavigatingHistory.current) {
      profileDataManager.setCurrentEditingPrompt(newValue);
    }
  };

  // Handle clipboard paste events - supports screenshot paste and text trimming
  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return;
    }

    // FIX: Prefer plain text over images.
    // When copying a table from Excel/Word the clipboard contains both text and image formats;
    // text should take priority.
    const hasTextContent = clipboardData.types.includes('text/plain');
    const textContent = clipboardData.getData('text/plain');

    // If there is non-empty text content, handle the paste manually and trim surrounding whitespace
    if (hasTextContent && textContent.trim().length > 0) {
      e.preventDefault();
      const trimmedText = textContent.trim();

      // Get the current cursor position
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newMessage = message.slice(0, start) + trimmedText + message.slice(end);
        setMessage(newMessage);

        // Set the new cursor position and scroll to it
        const newCursorPos = start + trimmedText.length;
        requestAnimationFrame(() => {
          textarea.selectionStart = newCursorPos;
          textarea.selectionEnd = newCursorPos;
          // Scroll to the cursor position (bottom)
          textarea.scrollTop = textarea.scrollHeight;
        });
      } else {
        setMessage(message + trimmedText);
      }
      return;
    }

    // Check whether the current model supports images
    if (!supportsImages) {
      return;
    }

    // Check whether the clipboard contains image files (only process images when there is no text)
    const items = Array.from(clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));

    if (imageItems.length === 0) {
      return;
    }

    // Prevent default paste behaviour (only for pure image pastes)
    e.preventDefault();

    // Process each image item
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {

        // Validate image format
        if (!validateImageFile(file)) {
          alert(
            `Unsupported image format: ${file.type}. Please paste a PNG, JPEG, GIF, WEBP, or BMP image.`,
          );
          continue;
        }

        // Generate a file name for the pasted image
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = file.type.split('/')[1] || 'png';
        const fileName = `screenshot-${timestamp}.${extension}`;

        // Create a new File object with the generated file name
        const renamedFile = new File([file], fileName, { type: file.type });

        await handleImageSelect(renamedFile);
      }
    }
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
            ? 'Type a message, drag files/images, paste screenshot, @ to mention files, # for skills...'
            : 'Type a message, drag files, @ to mention files, # for skills...'
        }
        className="chat-textarea"
      />
    </div>
  );
}
