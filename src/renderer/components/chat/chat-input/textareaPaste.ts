import type { ClipboardEvent } from 'react';
import { validateImageFile } from '@shared/types/chatTypes';

interface HandleTextareaPasteOptions {
  event: ClipboardEvent<HTMLTextAreaElement>;
  message: string;
  supportsImages: boolean;
  textarea: HTMLTextAreaElement | null;
  setDraftMessage: (text: string) => void;
  handleImageSelect: (file: File) => Promise<void>;
  getUnsupportedImageMessage?: (type: string) => string;
}

export async function handleTextareaPaste(options: HandleTextareaPasteOptions): Promise<void> {
  const {
    event,
    message,
    supportsImages,
    textarea,
    setDraftMessage,
    handleImageSelect,
    getUnsupportedImageMessage,
  } = options;
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return;
  }

  const hasTextContent = clipboardData.types.includes('text/plain');
  const textContent = clipboardData.getData('text/plain');
  if (hasTextContent && textContent.trim().length > 0) {
    event.preventDefault();
    const trimmedText = textContent.trim();

    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newMessage = message.slice(0, start) + trimmedText + message.slice(end);
      setDraftMessage(newMessage);

      const newCursorPos = start + trimmedText.length;
      requestAnimationFrame(() => {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.scrollTop = textarea.scrollHeight;
      });
    } else {
      setDraftMessage(message + trimmedText);
    }
    return;
  }

  if (!supportsImages) {
    return;
  }

  const items = Array.from(clipboardData.items);
  const imageItems = items.filter((item) => item.type.startsWith('image/'));
  if (imageItems.length === 0) {
    return;
  }

  event.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    if (!validateImageFile(file)) {
      alert(getUnsupportedImageMessage
        ? getUnsupportedImageMessage(file.type)
        : `Unsupported image format: ${file.type}. Please paste a PNG, JPEG, GIF, WEBP, or BMP image.`);
      continue;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = file.type.split('/')[1] || 'png';
    const fileName = `screenshot-${timestamp}.${extension}`;
    const renamedFile = new File([file], fileName, { type: file.type });
    await handleImageSelect(renamedFile);
  }
}
