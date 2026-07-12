/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CardSummary } from '@shared/types/memexTypes';

vi.mock('../../styles/MemexMemory.css', () => ({}));
vi.mock('../../styles/DropdownMenu.css', () => ({}));
vi.mock('../../styles/ListSearchBox.css', () => ({}));
vi.mock('../../styles/ContentView.css', () => ({}));
vi.mock('../../styles/Header.css', () => ({}));
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}));
vi.mock('../../styles/SkillsContentView.css', () => ({}));

import ProfileMemoryListPanel from '../ProfileMemoryListPanel';
import ProfileMemoryDetailPanel from '../ProfileMemoryDetailPanel';
import ProfileMemoryDropdownMenu from '../ProfileMemoryDropdownMenu';

const card: CardSummary = {
  slug: 'shared-card',
  title: 'Shared Card',
  excerpt: 'Shared context',
  category: 'team',
  modified: '2026-07-04',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfileMemoryListPanel', () => {
  it('renders profile memory cards and forwards list interactions', () => {
    const onQueryChange = vi.fn();
    const onSelect = vi.fn();
    const onMenuToggle = vi.fn();
    render(
      <ProfileMemoryListPanel
        cards={[card]}
        loading={false}
        query=""
        selectedSlug="shared-card"
        onQueryChange={onQueryChange}
        onSelect={onSelect}
        onMenuToggle={onMenuToggle}
      />,
    );

    expect(screen.getByText('Shared Card')).toBeTruthy();
    expect(screen.getByText('shared-card')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search profile memory...'), { target: { value: 'shared' } });
    expect(onQueryChange).toHaveBeenCalledWith('shared');
    fireEvent.click(screen.getByLabelText('Select Shared Card'));
    expect(onSelect).toHaveBeenCalledWith(card);
    fireEvent.click(screen.getByLabelText('Profile memory options for Shared Card'));
    expect(onMenuToggle).toHaveBeenCalledWith('shared-card', expect.any(HTMLElement));
  });

  it('renders the empty search state', () => {
    render(
      <ProfileMemoryListPanel
        cards={[]}
        loading={false}
        query="missing"
        selectedSlug={null}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        onMenuToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('No profile memory cards match your search.')).toBeTruthy();
  });

  it('renders loading, empty, and slug fallback states', () => {
    const onSelect = vi.fn();
    const onMenuToggle = vi.fn();
    const { rerender } = render(
      <ProfileMemoryListPanel
        cards={[]}
        loading={true}
        query=""
        selectedSlug={null}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        onMenuToggle={onMenuToggle}
      />,
    );
    expect(screen.getByText('Loading profile memory...')).toBeTruthy();

    rerender(
      <ProfileMemoryListPanel
        cards={[]}
        loading={false}
        query=""
        selectedSlug={null}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        onMenuToggle={onMenuToggle}
      />,
    );
    expect(screen.getByText('No profile memory cards yet. Agents can create profile memory with the memex_memory tool.')).toBeTruthy();

    const slugOnly = { slug: 'slug-only', title: '', excerpt: '' };
    rerender(
      <ProfileMemoryListPanel
        cards={[slugOnly]}
        loading={false}
        query=""
        selectedSlug={null}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        onMenuToggle={onMenuToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select slug-only'));
    expect(onSelect).toHaveBeenCalledWith(slugOnly);
    fireEvent.mouseDown(screen.getByLabelText('Profile memory options for slug-only'));
    fireEvent.click(screen.getByLabelText('Profile memory options for slug-only'));
    expect(onMenuToggle).toHaveBeenCalledWith('slug-only', expect.any(HTMLElement));

    const createdOnly = { slug: 'created-only', title: '', excerpt: '', created: '2026-07-04' };
    rerender(
      <ProfileMemoryListPanel
        cards={[createdOnly]}
        loading={false}
        query=""
        selectedSlug={null}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        onMenuToggle={onMenuToggle}
      />,
    );
    expect(screen.getByText('2026-07-04')).toBeTruthy();
  });
});

describe('ProfileMemoryDetailPanel', () => {
  it('renders profile memory detail as a raw Markdown file viewer', () => {
    const onNavigate = vi.fn();
    render(
      <ProfileMemoryDetailPanel
        card={{
          slug: 'shared-card',
          title: 'Shared Card',
          category: 'team',
          created: '2026-07-04',
          source: 'OpenKosmos',
          tags: ['shared'],
          content: '# Memory Heading\n\n- shared item',
          rawContent: [
            '---',
            'title: Shared Card',
            'category: team',
            'created: 2026-07-04',
            'source: OpenKosmos',
            '---',
            '# Memory Heading',
            '',
            'See [[next-card|Next Card]].',
            '',
            '- shared item',
          ].join('\n'),
          outbound: ['next-card'],
          resolvedWikilinks: { 'next-card': 'next-card' },
          inbound: ['previous-card'],
        }}
        loading={false}
        error={null}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getAllByText('Shared Card').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('source')).toBeTruthy();
    expect(screen.getByText('OpenKosmos')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Memory Heading' })).toBeTruthy();
    expect(screen.getByText('shared item')).toBeTruthy();
    expect(screen.queryByText('# Memory Heading\n\n- shared item')).toBeNull();
    expect(screen.queryByText('Content')).toBeNull();
    expect(screen.queryByText('Links')).toBeNull();
    expect(screen.queryByText('Metadata')).toBeNull();
    expect(screen.queryByText('Created')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Next Card' }));
    expect(onNavigate).toHaveBeenCalledWith('next-card');
  });

  it('renders loading and error states', () => {
    const { rerender } = render(
      <ProfileMemoryDetailPanel card={null} loading={true} error={null} />,
    );
    expect(screen.getByText('Loading profile memory card...')).toBeTruthy();
    rerender(<ProfileMemoryDetailPanel card={null} loading={false} error="boom" />);
    expect(screen.getByText('boom')).toBeTruthy();
    rerender(<ProfileMemoryDetailPanel card={null} loading={false} error={null} />);
    expect(screen.getByText('Select a profile memory card to view its content.')).toBeTruthy();
  });

  it('renders optional detail fallbacks', () => {
    render(
      <ProfileMemoryDetailPanel
        card={{
          slug: 'slug-title',
          title: '',
          status: 'draft',
          modified: '2026-07-05',
          content: '',
          outbound: [],
          inbound: [],
        }}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getAllByText('slug-title')).toHaveLength(1);
    expect(screen.queryByText('draft')).toBeNull();
    expect(screen.getByText('No content available')).toBeTruthy();
    expect(screen.queryByText('Links')).toBeNull();
  });

  it('leaves unresolved wikilinks as text when no resolved map is present', () => {
    const onNavigate = vi.fn();
    render(
      <ProfileMemoryDetailPanel
        card={{
          slug: 'source-card',
          title: 'Source Card',
          content: 'See [[missing-card]].',
          outbound: [],
          inbound: [],
        }}
        loading={false}
        error={null}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('See [[missing-card]].')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'missing-card' })).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('ProfileMemoryDropdownMenu', () => {
  it('runs archive and delete actions', () => {
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();
    const menuRef = { current: document.createElement('div') };
    render(
      <ProfileMemoryDropdownMenu
        menuRef={menuRef}
        card={card}
        position={{ top: 0, left: 0, triggerTop: 0, triggerRight: 0 }}
        onArchive={onArchive}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Archive Shared Card'));
    expect(onArchive).toHaveBeenCalledWith(card);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Delete Shared Card'));
    expect(onDelete).toHaveBeenCalledWith(card);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('uses slug labels and stops mousedown propagation', () => {
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();
    const menuRef = { current: document.createElement('div') };
    render(
      <ProfileMemoryDropdownMenu
        menuRef={menuRef}
        card={{ slug: 'slug-only', title: '', excerpt: '' }}
        position={{ top: 0, left: 0, triggerTop: 0, triggerRight: 0 }}
        onArchive={onArchive}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('menu'));
    fireEvent.click(screen.getByLabelText('Archive slug-only'));
    fireEvent.click(screen.getByLabelText('Delete slug-only'));
    expect(onArchive).toHaveBeenCalledWith({ slug: 'slug-only', title: '', excerpt: '' });
    expect(onDelete).toHaveBeenCalledWith({ slug: 'slug-only', title: '', excerpt: '' });
  });
});
