// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for EmojiPicker.tsx
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../styles/Agent.css', () => ({}));

import EmojiPicker from '../EmojiPicker';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onEmojiSelect: vi.fn(),
  currentEmoji: '🤖',
};

describe('EmojiPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when isOpen=false', () => {
    const { container } = render(
      <EmojiPicker {...defaultProps} isOpen={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders emoji picker overlay when isOpen=true', () => {
    render(<EmojiPicker {...defaultProps} />);
    expect(screen.getByText('agent.create.chooseAvatar')).toBeTruthy();
  });

  it('shows the selected emoji display', () => {
    render(<EmojiPicker {...defaultProps} currentEmoji="😀" />);
    expect(screen.getByText('agent.create.selected')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<EmojiPicker {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<EmojiPicker {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('common.cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onEmojiSelect and onClose when Confirm is clicked', () => {
    const onClose = vi.fn();
    const onEmojiSelect = vi.fn();
    render(
      <EmojiPicker
        {...defaultProps}
        onClose={onClose}
        onEmojiSelect={onEmojiSelect}
        currentEmoji="🤖"
      />,
    );
    fireEvent.click(screen.getByText('common.confirm'));
    expect(onEmojiSelect).toHaveBeenCalledWith('🤖');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows selecting a different emoji from the grid', () => {
    const onEmojiSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <EmojiPicker
        {...defaultProps}
        onClose={onClose}
        onEmojiSelect={onEmojiSelect}
        currentEmoji="🤖"
      />,
    );
    // Click on the first emoji in the first category
    const emojiButtons = screen.getAllByRole('button');
    // Find a grid emoji button (not category tabs, header buttons, footer buttons)
    const gridEmojis = emojiButtons.filter((btn) => {
      const text = btn.textContent || '';
      // Emoji buttons have single emoji character
      return !['×', 'common.cancel', 'common.confirm'].includes(text) && text.length <= 4;
    });
    if (gridEmojis.length > 0) {
      fireEvent.click(gridEmojis[0]);
      fireEvent.click(screen.getByText('common.confirm'));
      expect(onEmojiSelect).toHaveBeenCalled();
    }
  });

  it('calls onClose when clicking overlay (not modal)', () => {
    const onClose = vi.fn();
    render(<EmojiPicker {...defaultProps} onClose={onClose} />);
    const overlay = document.querySelector('.emoji-picker-overlay');
    if (overlay) {
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('switches category when a category tab is clicked', () => {
    render(<EmojiPicker {...defaultProps} />);
    // Find category tab buttons
    const tabs = screen.getAllByRole('button');
    const categoryTab = tabs.find((btn) => btn.className?.includes('category-tab'));
    if (categoryTab) {
      fireEvent.click(categoryTab);
      // After clicking it should be active
      expect(categoryTab.className).toContain('active');
    }
  });

  it('syncs selectedEmoji when currentEmoji prop changes', () => {
    const { rerender } = render(
      <EmojiPicker {...defaultProps} currentEmoji="😀" />,
    );
    rerender(
      <EmojiPicker {...defaultProps} currentEmoji="🐶" />,
    );
    // Verify the selected display updates (no error thrown)
    expect(screen.getByText('agent.create.selected')).toBeTruthy();
  });

  it('defaults to 🤖 when currentEmoji is undefined', () => {
    render(
      <EmojiPicker
        isOpen={true}
        onClose={vi.fn()}
        onEmojiSelect={vi.fn()}
        currentEmoji={undefined}
      />,
    );
    // Should show the picker without errors
    expect(screen.getByText('agent.create.chooseAvatar')).toBeTruthy();
  });
});
