/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../styles/ContentView.css', () => ({}))
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}))
vi.mock('../../../styles/RuntimeSettings.css', () => ({}))
vi.mock('lucide-react', () => ({
  ExternalLink: () => <span>external</span>,
  Trash2: () => <span>trash</span>,
}))

import RuntimeSystemDependencyRows from '../RuntimeSystemDependencyRows'
import type { GitVersion, RuntimeCheckingState } from '../RuntimeSettingsContentView'

function makeChecking(overrides: Partial<RuntimeCheckingState> = {}): RuntimeCheckingState {
  return { core: false, git: false, ...overrides }
}

function renderRows(props: any = {}) {
  const defaults = {
    checking: makeChecking(),
    gitVersion: null as GitVersion | null,
    showGitVersion: false,
    ...props,
  }
  return { ...render(<RuntimeSystemDependencyRows {...defaults} />), props: defaults }
}

describe('RuntimeSystemDependencyRows', () => {
  it('does not render the Git row when showGitVersion is false', () => {
    renderRows({ showGitVersion: false })
    expect(screen.queryByText('Git')).toBeNull()
  })

  it('renders Git path with title when installed with a path', () => {
    renderRows({
      showGitVersion: true,
      gitVersion: { installed: true, path: '/usr/bin/git', version: '2.40.0' },
    })
    const el = screen.getByText('/usr/bin/git')
    expect(el).toBeTruthy()
    expect(el.getAttribute('title')).toBe('/usr/bin/git (v2.40.0)')
  })

  it('renders Git version text when installed without a path', () => {
    renderRows({
      showGitVersion: true,
      gitVersion: { installed: true, path: '', version: '2.40.0' },
    })
    expect(screen.getByText('v2.40.0')).toBeTruthy()
  })

  it('shows Git checking state while the git probe is in flight', () => {
    renderRows({
      showGitVersion: true,
      gitVersion: { installed: false, path: '', version: '' },
      checking: makeChecking({ git: true }),
    })
    expect(screen.getByText('Checking…')).toBeTruthy()
  })

  it('shows the Git install hint when Git is missing', () => {
    renderRows({
      showGitVersion: true,
      gitVersion: { installed: false, path: '', version: '' },
    })
    expect(screen.getByText('Git is required for version control features.', { exact: false })).toBeTruthy()
    const links = screen.getAllByText('Install').map((node) => node.closest('a'))
    expect(links.some((link) => link?.getAttribute('href')?.includes('git-scm.com'))).toBe(true)
  })
})
