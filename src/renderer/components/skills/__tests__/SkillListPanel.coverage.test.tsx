/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import SkillListPanel from '../SkillListPanel';
import type { SkillConfig } from '../../../lib/userData/types';

vi.mock('../../../../shared/constants/builtinSkills', () => ({
  isBuiltinSkill: (name: string) => name === 'builtin-skill',
}));

vi.mock('../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <input
      data-testid="search-box"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

// ── helpers ────────────────────────────────────────────────────────────────
const makeSkill = (name: string, extra: Partial<SkillConfig> = {}): SkillConfig => ({
  name,
  version: '1.0.0',
  source: 'ON-DEVICE' as const,
  ...extra,
} as SkillConfig);

const builtinSkill = makeSkill('builtin-skill');
const customSkill = makeSkill('my-custom-skill');

describe('SkillListPanel – loading state', () => {
  it('shows loading spinner when isLoading is true', () => {
    render(
      <SkillListPanel
        skills={[]}
        selectedSkill={null}
        isLoading={true}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('Loading skills...')).toBeInTheDocument();
  });
});

describe('SkillListPanel – empty state', () => {
  it('shows empty message when no skills', () => {
    render(
      <SkillListPanel
        skills={[]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('No skills available')).toBeInTheDocument();
    expect(screen.getByText('Add a skill to get started')).toBeInTheDocument();
  });
});

describe('SkillListPanel – skill list', () => {
  it('renders skill names', () => {
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('my-custom-skill')).toBeInTheDocument();
  });

  it('shows Built-in badge for builtin skills', () => {
    render(
      <SkillListPanel
        skills={[builtinSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('Built-in')).toBeInTheDocument();
  });

  it('renders menu button for non-plugin skills', () => {
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(document.querySelectorAll('.skill-menu-btn').length).toBe(1);
  });

  it('calls onSelectSkill when a skill card is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={onSelect}
      />
    );
    // First call is from the auto-select effect; click triggers another
    const card = screen.getByText('my-custom-skill').closest('.skill-card-wrapper')!;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(customSkill);
  });

  it('calls onSkillMenuToggle with skill name when menu button clicked', () => {
    const onMenuToggle = vi.fn();
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={vi.fn()}
        onSkillMenuToggle={onMenuToggle}
      />
    );
    const btn = document.querySelector('.skill-menu-btn') as HTMLElement;
    fireEvent.click(btn);
    expect(onMenuToggle).toHaveBeenCalledWith('my-custom-skill', btn);
  });

  it('marks selected skill card with selected class', () => {
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const wrapper = screen.getByText('my-custom-skill').closest('.skill-card-wrapper')!;
    expect(wrapper.classList).toContain('selected');
  });

  it('shows builtin skills before custom skills', () => {
    render(
      <SkillListPanel
        skills={[customSkill, builtinSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const cards = Array.from(document.querySelectorAll('.skill-card-name')).map(el => el.textContent);
    expect(cards[0]).toBe('builtin-skill');
    expect(cards[1]).toBe('my-custom-skill');
  });
});

describe('SkillListPanel – search', () => {
  it('filters skills by search query', () => {
    render(
      <SkillListPanel
        skills={[customSkill, builtinSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const searchBox = screen.getByTestId('search-box');
    fireEvent.change(searchBox, { target: { value: 'builtin' } });
    expect(screen.getByText('builtin-skill')).toBeInTheDocument();
    expect(screen.queryByText('my-custom-skill')).not.toBeInTheDocument();
  });

  it('shows all skills when search is cleared', () => {
    render(
      <SkillListPanel
        skills={[customSkill, builtinSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const searchBox = screen.getByTestId('search-box');
    fireEvent.change(searchBox, { target: { value: 'builtin' } });
    fireEvent.change(searchBox, { target: { value: '' } });
    expect(screen.getByText('my-custom-skill')).toBeInTheDocument();
  });
});

describe('SkillListPanel – version and source display', () => {
  it('shows version string', () => {
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  it('shows source string', () => {
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('ON-DEVICE')).toBeInTheDocument();
  });

  it('omits version and source spans when a skill has neither', () => {
    const bare = makeSkill('bare-skill', { version: undefined, source: undefined });
    render(
      <SkillListPanel
        skills={[bare]}
        selectedSkill={bare}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('bare-skill')).toBeInTheDocument();
    expect(document.querySelectorAll('.skill-card-version').length).toBe(0);
  });
});

describe('SkillListPanel – sort ordering branches', () => {
  it('keeps a builtin-first array ordered with builtin on top', () => {
    render(
      <SkillListPanel
        skills={[builtinSkill, customSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const names = Array.from(document.querySelectorAll('.skill-card-name')).map(el => el.textContent);
    expect(names[0]).toBe('builtin-skill');
    expect(names[1]).toBe('my-custom-skill');
  });

  it('preserves order for two non-builtin skills (comparator returns 0)', () => {
    const a = makeSkill('custom-a');
    const b = makeSkill('custom-b');
    render(
      <SkillListPanel
        skills={[a, b]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const names = Array.from(document.querySelectorAll('.skill-card-name')).map(el => el.textContent);
    expect(names).toEqual(['custom-a', 'custom-b']);
  });
});

describe('SkillListPanel – selection sync', () => {
  it('preserves search query when user typing filters out all skills', async () => {
    const onSelect = vi.fn();
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={onSelect}
      />
    );
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'zzz-no-match' } });
    await act(async () => {});
    expect(screen.getByTestId('search-box')).toHaveValue('zzz-no-match');
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });

  it('does not clear selection on empty results when nothing is selected', async () => {
    const onSelect = vi.fn();
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={onSelect}
      />
    );
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'zzz-no-match' } });
    await act(async () => {});
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });

  it('selects first filtered skill when user typing excludes current selection', async () => {
    const onSelect = vi.fn();
    render(
      <SkillListPanel
        skills={[customSkill, builtinSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={onSelect}
      />
    );
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'builtin' } });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(builtinSkill);
    });
  });

  it('selects the first filtered skill when the selected one is no longer present', () => {
    const onSelect = vi.fn();
    const ghost = makeSkill('ghost-skill');
    render(
      <SkillListPanel
        skills={[customSkill, builtinSkill]}
        selectedSkill={ghost}
        isLoading={false}
        onSelectSkill={onSelect}
      />
    );
    // sorted order puts builtin-skill first
    expect(onSelect).toHaveBeenCalledWith(builtinSkill);
  });

  it('does not throw when the menu button is clicked without an onSkillMenuToggle handler', () => {
    render(
      <SkillListPanel
        skills={[customSkill]}
        selectedSkill={customSkill}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    const btn = document.querySelector('.skill-menu-btn') as HTMLElement;
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});
