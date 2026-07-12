/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { AgentAvatar } from '../AgentAvatar';

describe('AgentAvatar', () => {
  it('renders emoji span by default', () => {
    const { container } = render(<AgentAvatar emoji="🤖" />);
    expect(container.textContent).toContain('🤖');
  });

  it('does not load a persisted remote avatar for a legacy source', () => {
    const { container } = render(
      <AgentAvatar source="IN-LIBRARY" avatar="https://example.com/img.png" name="Test Agent" emoji="🤖" />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('🤖');
  });

  it('renders ON-DEVICE as emoji even with avatar', () => {
    const { container } = render(
      <AgentAvatar source="ON-DEVICE" avatar="https://example.com/img.png" emoji="🤖" />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('🤖');
  });

  it('renders sm size', () => {
    const { container } = render(<AgentAvatar emoji="🤖" size="sm" />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('renders lg size', () => {
    const { container } = render(<AgentAvatar emoji="🤖" size="lg" />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('renders md size (default)', () => {
    const { container } = render(<AgentAvatar emoji="🤖" size="md" />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('uses initials when no emoji and no avatar', () => {
    const { container } = render(<AgentAvatar emoji="" name="Test Agent" />);
    expect(container.textContent).toContain('TA');
  });

  it('applies extra className', () => {
    const { container } = render(<AgentAvatar emoji="🤖" className="extra-class" />);
    expect(container.querySelector('.extra-class')).toBeTruthy();
  });
});
