// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import SkillFolderExplorer from '../SkillFolderExplorer'
import { SkillConfig } from '../../../lib/userData/types'

// ---- mocks ----

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <svg data-testid="chevron-left" />,
  ChevronRight: () => <svg data-testid="chevron-right" />,
  Folder: () => <svg data-testid="icon-folder" />,
  FolderOpen: () => <svg data-testid="icon-folder-open" />,
  FileText: () => <svg data-testid="icon-file-text" />,
  FileCode: () => <svg data-testid="icon-file-code" />,
  FileJson: () => <svg data-testid="icon-file-json" />,
  FileType: () => <svg data-testid="icon-file-type" />,
  Palette: () => <svg data-testid="icon-palette" />,
  Globe: () => <svg data-testid="icon-globe" />,
  Image: () => <svg data-testid="icon-image" />,
}))

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../SkillViewPanel', () => ({}))

// ---- helpers ----

const makeSkill = (overrides: Partial<SkillConfig> = {}): SkillConfig =>
  ({ name: 'my-skill', ...overrides } as SkillConfig)

function makeDir(items: any[] = []) {
  return {
    success: true,
    data: {
      currentPath: '',
      parentPath: null,
      items,
    },
  }
}

function makeItem(overrides: any = {}) {
  return {
    name: 'test-file.ts',
    path: 'test-file.ts',
    isDirectory: false,
    isFile: true,
    size: 1024,
    modifiedTime: '2024-01-01',
    extension: 'ts',
    ...overrides,
  }
}

function setupElectronApi(overrides: any = {}) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      skills: {
        getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir()),
        getSkillFileContent: vi.fn().mockResolvedValue({ success: true, data: { path: 'test-file.ts', content: 'hello' } }),
        ...overrides,
      },
    },
  })
}

// ---- tests ----

describe('SkillFolderExplorer - loading state', () => {
  it('shows loading indicator during initial load', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    expect(screen.getByText('Loading directory...')).toBeInTheDocument()
  })
})

describe('SkillFolderExplorer - error state', () => {
  it('shows error when getSkillDirectoryContents returns failure', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue({ success: false, error: 'Permission denied' }),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/Permission denied/)).toBeInTheDocument()
    })
  })

  it('shows error when getSkillDirectoryContents throws', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockRejectedValue(new Error('IPC error')),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/IPC error/)).toBeInTheDocument()
    })
  })
})

describe('SkillFolderExplorer - empty directory', () => {
  it('shows empty directory message when no items', async () => {
    setupElectronApi()
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('This directory is empty')).toBeInTheDocument()
    })
  })
})

describe('SkillFolderExplorer - file listing', () => {
  it('renders files in the directory', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem()])),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('test-file.ts')).toBeInTheDocument()
    })
  })

  it('renders directory items', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(
        makeDir([makeItem({ name: 'src', path: 'src', isDirectory: true, isFile: false, extension: null })])
      ),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })
  })

  it('shows file size for files', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem({ size: 2048 })])),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('2 KB')).toBeInTheDocument()
    })
  })

  it('formats 0 byte files correctly', async () => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem({ size: 0 })])),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('0 B')).toBeInTheDocument()
    })
  })
})

describe('SkillFolderExplorer - file icons', () => {
  const iconCases = [
    ['ts', 'icon-file-code'],
    ['tsx', 'icon-file-code'],
    ['js', 'icon-file-code'],
    ['jsx', 'icon-file-code'],
    ['json', 'icon-file-json'],
    ['md', 'icon-file-type'],
    ['css', 'icon-palette'],
    ['scss', 'icon-palette'],
    ['html', 'icon-globe'],
    ['png', 'icon-image'],
    ['jpg', 'icon-image'],
    ['txt', 'icon-file-text'],
    [null, 'icon-file-text'],
  ]

  iconCases.forEach(([ext, iconTestId]) => {
    it(`renders correct icon for extension: ${ext}`, async () => {
      setupElectronApi({
        getSkillDirectoryContents: vi.fn().mockResolvedValue(
          makeDir([makeItem({ name: `file.${ext}`, path: `file.${ext}`, extension: ext })])
        ),
      })
      render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByTestId(iconTestId)).toBeInTheDocument()
      })
    })
  })
})

describe('SkillFolderExplorer - navigation', () => {
  it('shows skill name as breadcrumb root', async () => {
    setupElectronApi()
    render(<SkillFolderExplorer skill={makeSkill({ name: 'cool-skill' } as any)} onFileSelect={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('cool-skill')).toBeInTheDocument()
    })
  })

  it('navigates into subdirectory on directory click', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'subdir', path: 'subdir', isDirectory: true, isFile: false, extension: null })]))
      .mockResolvedValueOnce({
        success: true,
        data: { currentPath: 'subdir', parentPath: '', items: [makeItem({ name: 'inner.ts', path: 'subdir/inner.ts' })] },
      })
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => screen.getByText('subdir'))
    fireEvent.click(screen.getByText('subdir').closest('.skill-folder-item')!)
    await waitFor(() => {
      expect(getSkillDirectoryContents).toHaveBeenCalledWith('my-skill', 'subdir')
    })
  })

  it('shows back button after navigating into subdirectory', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'subdir', path: 'subdir', isDirectory: true, isFile: false, extension: null })]))
      .mockResolvedValueOnce({
        success: true,
        data: { currentPath: 'subdir', parentPath: '', items: [] },
      })
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => screen.getByText('subdir'))
    fireEvent.click(screen.getByText('subdir').closest('.skill-folder-item')!)
    await waitFor(() => {
      expect(screen.getByTitle('Go back')).toBeInTheDocument()
    })
  })

  it('navigates back when back button is clicked', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'subdir', path: 'subdir', isDirectory: true, isFile: false, extension: null })]))
      .mockResolvedValueOnce({ success: true, data: { currentPath: 'subdir', parentPath: '', items: [] } })
      .mockResolvedValueOnce(makeDir([]))
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => screen.getByText('subdir'))
    fireEvent.click(screen.getByText('subdir').closest('.skill-folder-item')!)
    await waitFor(() => screen.getByTitle('Go back'))
    fireEvent.click(screen.getByTitle('Go back'))
    await waitFor(() => {
      expect(getSkillDirectoryContents).toHaveBeenCalledTimes(3)
    })
  })

  it('calls onFileSelect when file is clicked', async () => {
    const onFileSelect = vi.fn()
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem()])),
      getSkillFileContent: vi.fn().mockResolvedValue({ success: true, data: { path: 'test-file.ts', content: 'code' } }),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={onFileSelect} />)
    await waitFor(() => screen.getByText('test-file.ts'))
    fireEvent.click(screen.getByText('test-file.ts').closest('.skill-folder-item')!)
    await waitFor(() => {
      expect(onFileSelect).toHaveBeenCalledWith({ path: 'test-file.ts', content: 'code' })
    })
  })

  it('does not call onFileSelect when file content load fails', async () => {
    const onFileSelect = vi.fn()
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem()])),
      getSkillFileContent: vi.fn().mockResolvedValue({ success: false, error: 'Not found' }),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={onFileSelect} />)
    await waitFor(() => screen.getByText('test-file.ts'))
    fireEvent.click(screen.getByText('test-file.ts').closest('.skill-folder-item')!)
    await waitFor(() => {
      expect(onFileSelect).not.toHaveBeenCalled()
    })
  })
})

describe('SkillFolderExplorer - breadcrumb navigation', () => {
  it('renders breadcrumb for nested path', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'a', path: 'a', isDirectory: true, isFile: false, extension: null })]))
      .mockResolvedValueOnce({
        success: true,
        data: { currentPath: 'a', parentPath: '', items: [] },
      })
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    await waitFor(() => screen.getByText('a'))
    fireEvent.click(screen.getByText('a').closest('.skill-folder-item')!)
    await waitFor(() => {
      const breadcrumbItems = document.querySelectorAll('.skill-folder-breadcrumb-item')
      expect(breadcrumbItems.length).toBeGreaterThan(1)
    })
  })

  it('clicking active breadcrumb does nothing', async () => {
    setupElectronApi()
    render(<SkillFolderExplorer skill={makeSkill({ name: 'skill-x' } as any)} onFileSelect={vi.fn()} />)
    await waitFor(() => screen.getByText('skill-x'))
    const activeBtn = document.querySelector('.skill-folder-breadcrumb-item.active') as HTMLElement
    fireEvent.click(activeBtn)
    // No error thrown, test passes
  })
})

describe('SkillFolderExplorer - refresh event', () => {
  it('reloads directory on skills:refreshFolderExplorer event for matching skill', async () => {
    const getSkillDirectoryContents = vi.fn().mockResolvedValue(makeDir([]))
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill({ name: 'refresh-skill' } as any)} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(1))
    act(() => {
      window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', { detail: { skillName: 'refresh-skill' } }))
    })
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(2))
  })

  it('does not reload for different skill name', async () => {
    const getSkillDirectoryContents = vi.fn().mockResolvedValue(makeDir([]))
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill({ name: 'skill-a' } as any)} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(1))
    act(() => {
      window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', { detail: { skillName: 'skill-b' } }))
    })
    // Still 1 call
    expect(getSkillDirectoryContents).toHaveBeenCalledTimes(1)
  })
})

describe('SkillFolderExplorer - skill name change', () => {
  it('reloads when skill.name changes', async () => {
    const getSkillDirectoryContents = vi.fn().mockResolvedValue(makeDir([]))
    setupElectronApi({ getSkillDirectoryContents })
    const { rerender } = render(
      <SkillFolderExplorer skill={makeSkill({ name: 'skill-1' } as any)} onFileSelect={vi.fn()} />
    )
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(1))
    rerender(<SkillFolderExplorer skill={makeSkill({ name: 'skill-2' } as any)} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(2))
  })
})
