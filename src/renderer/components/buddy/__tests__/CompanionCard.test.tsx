// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../../main/lib/buddy/types', () => ({
  ALL_STATS: ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'],
  RARITY_STARS: { common: '★', uncommon: '★★', rare: '★★★', epic: '★★★★', legendary: '★★★★★' },
  RARITY_COLORS: { common: '#888888', uncommon: '#00aa00', rare: '#0066cc', epic: '#aa00ff', legendary: '#ffaa00' },
}));

vi.mock('../../../../main/lib/buddy/sprites', () => ({
  renderSprite: vi.fn(() => [' /\\_/\\\\ ', '( o.o )', ' > ^ < ']),
}));

import { renderSprite } from '../../../../main/lib/buddy/sprites';
import { CompanionCard } from '../CompanionCard';

function companion(overrides = {}) {
  return {
    name: 'Orbit',
    species: 'fox',
    personality: 'curious',
    rarity: 'epic',
    shiny: false,
    hatchedAt: 123,
    stats: { DEBUGGING: 10, PATIENCE: 20, CHAOS: 30, WISDOM: 40, SNARK: 50 },
    ...overrides,
  };
}

describe('CompanionCard', () => {
  it('renders companion identity, sprite, stat bars, and tokenized neutral colors', () => {
    const { container } = render(<CompanionCard companion={companion()} />);

    expect(renderSprite).toHaveBeenCalledWith(expect.objectContaining({ name: 'Orbit' }), 0);
    expect(screen.getByText('★★★★ Epic ★★★★')).toBeTruthy();
    expect(screen.getByText('Orbit')).toBeTruthy();
    expect(screen.getByText('fox')).toBeTruthy();
    expect(screen.getByText('curious')).toBeTruthy();
    expect(screen.getByText('Hatchling — 0 XP')).toBeTruthy();

    const card = container.firstElementChild as HTMLElement;
    expect(card.style.background).toBe('var(--color-neutral-950)');
    expect((screen.getByText('Orbit') as HTMLElement).style.color).toBe('var(--color-neutral-200)');
    expect((screen.getByText('curious') as HTMLElement).style.color).toBe('var(--color-neutral-400)');
    expect((screen.getByText('Hatchling — 0 XP') as HTMLElement).style.color).toBe('var(--color-neutral-500)');

    const fills = Array.from(container.querySelectorAll('.buddy-stat-bar-fill')) as HTMLElement[];
    expect(fills).toHaveLength(5);
    expect(fills.map((fill) => fill.style.width)).toEqual(['10%', '20%', '30%', '40%', '50%']);
    expect(fills.every((fill) => fill.style.backgroundColor === '#aa00ff')).toBe(true);
  });

  it('adds the shiny sprite class only for shiny companions', () => {
    const normal = render(<CompanionCard companion={companion({ shiny: false })} />);
    expect(normal.container.querySelector('.buddy-sprite')?.className).toBe('buddy-sprite');
    normal.unmount();

    const shiny = render(<CompanionCard companion={companion({ shiny: true, rarity: 'legendary' })} />);
    expect(shiny.container.querySelector('.buddy-sprite')?.className).toBe('buddy-sprite shiny');
    expect(screen.getByText('★★★★★ Legendary ★★★★★')).toBeTruthy();
  });
});
