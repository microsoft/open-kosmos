export interface ChatInputEnterActionOptions {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export type ChatInputEnterAction = 'send' | 'newline' | 'ignore';

export function getChatInputEnterAction({
  key,
  altKey,
  shiftKey,
  isComposing,
}: ChatInputEnterActionOptions): ChatInputEnterAction {
  if (key !== 'Enter' || isComposing) {
    return 'ignore';
  }

  if (altKey || shiftKey) {
    return 'newline';
  }

  return 'send';
}

export function getChatInputShortcutHint(platform?: string): string {
  if (!platform) {
    return 'Send: Enter. New line: Shift+Enter or Option/Alt+Enter.';
  }

  const isApplePlatform = /mac|iphone|ipad|ipod/i.test(platform);
  const explicitNewlineShortcut = isApplePlatform ? 'Option+Enter' : 'Alt+Enter';

  return `Send: Enter. New line: Shift+Enter or ${explicitNewlineShortcut}.`;
}