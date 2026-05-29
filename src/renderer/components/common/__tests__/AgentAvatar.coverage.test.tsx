/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { AgentAvatar } from '../AgentAvatar';

describe('AgentAvatar', () => {
  it('renders emoji span by default', () => {
    const { container } = render(<AgentAvatar emoji="🤖" />);
    expect(container.textContent).toContain('🤖');
  });

  it('renders image for IN-LIBRARY with avatar', () => {
    const { container } = render(
      <AgentAvatar source="IN-LIBRARY" avatar="https://example.com/img.png" name="Test Agent" />
    );
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.alt).toBe('Test Agent');
  });

  it('falls back to emoji when image errors', () => {
    const { container } = render(
      <AgentAvatar source="IN-LIBRARY" avatar="https://example.com/bad.png" emoji="🤖" />
    );
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(container.textContent).toContain('🤖');
  });

  it('appends version to avatar URL', () => {
    const { container } = render(
      <AgentAvatar source="IN-LIBRARY" avatar="https://example.com/img.png" version="1.2.3" />
    );
    const img = container.querySelector('img');
    expect(img?.src).toContain('_v=');
  });

  it('appends version with & when URL has query params', () => {
    const { container } = render(
      <AgentAvatar source="IN-LIBRARY" avatar="https://example.com/img.png?foo=bar" version="1.0" />
    );
    const img = container.querySelector('img');
    expect(img?.src).toContain('&_v=');
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
