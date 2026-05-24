import { getChatInputEnterAction, getChatInputShortcutHint } from '../chatInputKeyboard';

describe('chatInputKeyboard', () => {
  describe('getChatInputEnterAction', () => {
    it('returns ignore while IME composition is active', () => {
      expect(
        getChatInputEnterAction({
          key: 'Enter',
          altKey: false,
          shiftKey: false,
          isComposing: true,
        }),
      ).toBe('ignore');
    });

    it('returns newline for Alt+Enter', () => {
      expect(
        getChatInputEnterAction({
          key: 'Enter',
          altKey: true,
          shiftKey: false,
          isComposing: false,
        }),
      ).toBe('newline');
    });

    it('returns newline for Shift+Enter', () => {
      expect(
        getChatInputEnterAction({
          key: 'Enter',
          altKey: false,
          shiftKey: true,
          isComposing: false,
        }),
      ).toBe('newline');
    });

    it('returns send for plain Enter', () => {
      expect(
        getChatInputEnterAction({
          key: 'Enter',
          altKey: false,
          shiftKey: false,
          isComposing: false,
        }),
      ).toBe('send');
    });

    it('returns ignore for non-Enter keys', () => {
      expect(
        getChatInputEnterAction({
          key: 'Tab',
          altKey: false,
          shiftKey: false,
          isComposing: false,
        }),
      ).toBe('ignore');
    });
  });

  describe('getChatInputShortcutHint', () => {
    it('uses the macOS shortcut label on Apple platforms', () => {
      expect(getChatInputShortcutHint('MacIntel')).toContain('Option+Enter');
    });

    it('uses the Windows shortcut label on non-Apple platforms', () => {
      expect(getChatInputShortcutHint('Win32')).toContain('Alt+Enter');
    });

    it('falls back to a cross-platform hint when platform is missing', () => {
      expect(getChatInputShortcutHint()).toContain('Option/Alt+Enter');
    });
  });
});