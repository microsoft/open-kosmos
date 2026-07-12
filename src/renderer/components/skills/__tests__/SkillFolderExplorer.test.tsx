/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import SkillFolderExplorer from '../SkillFolderExplorer'

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

const makeSkill = (name = 'my-skill') => ({ name } as any)

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

function makeDir(items: any[] = [], currentPath = '', parentPath: string | null = null) {
  return { success: true, data: { currentPath, parentPath, items } }
}

function setupElectronApi(overrides: any = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      skills: {
        getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir()),
        getSkillFileContent: vi.fn().mockResolvedValue({ success: true, data: { path: 'test-file.ts', content: 'hello' } }),
        ...overrides,
      },
    },
  })
  return (window as any).electronAPI.skills
}

describe('SkillFolderExplorer', () => {
  it('renders loading spinner with managed SVG stroke colors', () => {
    setupElectronApi({ getSkillDirectoryContents: vi.fn().mockReturnValue(new Promise(() => {})) })
    const { container } = render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)

    expect(screen.getByText('Loading directory...')).toBeInTheDocument()
    expect(container.querySelector('circle')?.getAttribute('stroke')).toBe('var(--color-neutral-200)')
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('var(--color-warm-900)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it('shows load failures from failed and thrown directory requests', async () => {
    setupElectronApi({ getSkillDirectoryContents: vi.fn().mockResolvedValue({ success: false, error: 'Permission denied' }) })
    const { unmount } = render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument()
    unmount()

    setupElectronApi({ getSkillDirectoryContents: vi.fn().mockRejectedValue(new Error('IPC error')) })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    expect(await screen.findByText(/IPC error/)).toBeInTheDocument()
  })

  it('uses the fallback error message when a failed directory request has no error text', async () => {
    setupElectronApi({ getSkillDirectoryContents: vi.fn().mockResolvedValue({ success: false }) })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    expect(await screen.findByText(/Failed to load directory contents/)).toBeInTheDocument()
  })

  it('renders empty directories and file sizes', async () => {
    const api = setupElectronApi({ getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem({ size: 0 })])) })
    const { rerender } = render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    expect(await screen.findByText('test-file.ts')).toBeInTheDocument()
    expect(screen.getByText('0 B')).toBeInTheDocument()

    api.getSkillDirectoryContents.mockResolvedValue(makeDir([]))
    rerender(<SkillFolderExplorer skill={makeSkill('empty-skill')} onFileSelect={vi.fn()} />)
    expect(await screen.findByText('This directory is empty')).toBeInTheDocument()
  })

  it.each([
    ['ts', 'icon-file-code'], ['tsx', 'icon-file-code'], ['js', 'icon-file-code'], ['jsx', 'icon-file-code'],
    ['json', 'icon-file-json'], ['md', 'icon-file-type'], ['css', 'icon-palette'], ['scss', 'icon-palette'],
    ['html', 'icon-globe'], ['png', 'icon-image'], ['jpg', 'icon-image'], ['jpeg', 'icon-image'], ['gif', 'icon-image'], ['svg', 'icon-image'],
    ['txt', 'icon-file-text'], [null, 'icon-file-text'],
  ])('renders the icon for extension %s', async (extension, testId) => {
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem({ name: `file-${extension ?? 'none'}`, extension })])),
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)
    expect(await screen.findByTestId(testId)).toBeInTheDocument()
  })

  it('navigates into directories, back, and through breadcrumbs', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'src', path: 'src', isDirectory: true, isFile: false, extension: null })]))
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'nested', path: 'src/nested', isDirectory: true, isFile: false, extension: null })], 'src', ''))
      .mockResolvedValueOnce(makeDir([], '', null))
      .mockResolvedValueOnce(makeDir([], 'src', ''))
      .mockResolvedValueOnce(makeDir([], '', null))
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)

    fireEvent.click((await screen.findByText('src')).closest('.skill-folder-item')!)
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledWith('my-skill', 'src'))
    expect(screen.getByTitle('Go back')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Go back'))
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledWith('my-skill', ''))

    fireEvent.click(screen.getByText('my-skill'))
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(3))

    act(() => window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', { detail: { skillName: 'my-skill' } })))
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(4))
    act(() => window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', { detail: { skillName: 'other-skill' } })))
    expect(getSkillDirectoryContents).toHaveBeenCalledTimes(4)
  })

  it('navigates across nested breadcrumb paths', async () => {
    const getSkillDirectoryContents = vi.fn()
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'src', path: 'src', isDirectory: true, isFile: false, extension: null })]))
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'nested', path: 'src/nested', isDirectory: true, isFile: false, extension: null })], 'src', ''))
      .mockResolvedValueOnce(makeDir([makeItem({ name: 'deep', path: 'src/nested/deep', isDirectory: true, isFile: false, extension: null })], 'src/nested', 'src'))
      .mockResolvedValueOnce(makeDir([], 'src/nested/deep', 'src/nested'))
      .mockResolvedValueOnce(makeDir([], 'src/nested', 'src'))
      .mockResolvedValueOnce(makeDir([], 'src', ''))
      .mockResolvedValueOnce(makeDir([], '', null))
    setupElectronApi({ getSkillDirectoryContents })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={vi.fn()} />)

    fireEvent.click((await screen.findByText('src')).closest('.skill-folder-item')!)
    fireEvent.click((await screen.findByText('nested')).closest('.skill-folder-item')!)
    fireEvent.click((await screen.findByText('deep')).closest('.skill-folder-item')!)
    await waitFor(() => expect(screen.getByText('deep')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'nested' }))
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledWith('my-skill', 'src/nested'))

    fireEvent.click(screen.getByRole('button', { name: 'src' }))
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledWith('my-skill', 'src'))

    fireEvent.click(screen.getByRole('button', { name: 'my-skill' }))
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledWith('my-skill', ''))
  })

  it('selects files and ignores file-load failures', async () => {
    const onFileSelect = vi.fn()
    const getSkillFileContent = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { path: 'test-file.ts', content: 'code' } })
      .mockResolvedValueOnce({ success: false, error: 'Not found' })
      .mockRejectedValueOnce(new Error('read failed'))
    setupElectronApi({
      getSkillDirectoryContents: vi.fn().mockResolvedValue(makeDir([makeItem({ size: 2048 })])),
      getSkillFileContent,
    })
    render(<SkillFolderExplorer skill={makeSkill()} onFileSelect={onFileSelect} />)

    const file = (await screen.findByText('test-file.ts')).closest('.skill-folder-item')!
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    fireEvent.click(file)
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith({ path: 'test-file.ts', content: 'code' }))

    fireEvent.click(file)
    await waitFor(() => expect(getSkillFileContent).toHaveBeenCalledTimes(2))
    expect(onFileSelect).toHaveBeenCalledTimes(1)

    fireEvent.click(file)
    await waitFor(() => expect(getSkillFileContent).toHaveBeenCalledTimes(3))
    expect(onFileSelect).toHaveBeenCalledTimes(1)
  })

  it('reloads when the skill name changes', async () => {
    const getSkillDirectoryContents = vi.fn().mockResolvedValue(makeDir([]))
    setupElectronApi({ getSkillDirectoryContents })
    const { rerender } = render(<SkillFolderExplorer skill={makeSkill('skill-1')} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(1))

    rerender(<SkillFolderExplorer skill={makeSkill('skill-2')} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(getSkillDirectoryContents).toHaveBeenCalledTimes(2))
  })
})
