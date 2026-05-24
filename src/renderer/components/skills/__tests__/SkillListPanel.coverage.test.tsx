/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
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
const pluginSkill = makeSkill('plugin--foo', { source: 'PLUGIN' as any });

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

  it('shows Plugin badge for plugin skills', () => {
    render(
      <SkillListPanel
        skills={[pluginSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    expect(screen.getByText('Plugin')).toBeInTheDocument();
  });

  it('does not render menu button for plugin skills', () => {
    render(
      <SkillListPanel
        skills={[pluginSkill]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />
    );
    // There should be no menu buttons for plugin skills
    expect(document.querySelectorAll('.skill-menu-btn').length).toBe(0);
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
});
