// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import {
  OverlayFileViewer,
  FileViewerAtom,
  __testables,
  __setLoadMonacoEditorForTests,
} from '../OverlayFileViewer';

const stableI18n = { t: (key: string) => key, language: 'en', setLanguage: vi.fn() };

vi.mock('@/lib/i18n/useI18n', () => ({ useI18n: () => stableI18n }));
vi.mock('@/atom', () => ({
  atom: (initialValue: unknown, actionFactory?: (get: () => unknown, set: (v: unknown) => void) => unknown) => {
    let state = initialValue;
    const subscribers: Array<() => void> = [];
    const get = () => state;
    const set = (value: unknown) => { state = value; subscribers.forEach(fn => fn()); };
    const actions = actionFactory ? actionFactory(get, set) : { set };
    return {
      use: () => {
        const [value, setValue] = React.useState(state);
        React.useEffect(() => {
          const refresh = () => setValue({ ...(state as object) } as any);
          subscribers.push(refresh);
          return () => { subscribers.splice(subscribers.indexOf(refresh), 1); };
        }, []);
        return [value, actions];
      },
    };
  },
  WithStore: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));
vi.mock('../../../styles/OverlayFileViewer.css', () => ({}));
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('../../ui/ToastProvider', () => ({ useToast: () => ({ showSuccess, showError, showToast: vi.fn() }) }));
vi.mock('../../../lib/utils/yamlFrontMatter', () => ({ parseFrontMatter: vi.fn(() => ({ frontMatter: {}, content: '# heading' })) }));
vi.mock('../../../lib/skills/installableSkillArtifacts', () => ({ isInstallableSkillArtifact: vi.fn(() => false) }));
vi.mock('../../../lib/utilities/logger', () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));
vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn(() => ({
      dispose: vi.fn(),
      focus: vi.fn(),
      getValue: vi.fn(() => ''),
      onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    })),
  },
}));

function setupElectronApi(readFileResult = { success: true, content: '# heading' }) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      fs: {
        readFile: vi.fn().mockResolvedValue(readFileResult),
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        stat: vi.fn().mockResolvedValue({ success: true, size: 1024 }),
      },
      workspace: { openPath: vi.fn() },
    },
  });
}

function Wrapper({ name, url }: { name: string; url: string }) {
  const [, actions] = FileViewerAtom.use();
  return (
    <>
      <button onClick={() => actions.open({ name, url })}>Open</button>
      <OverlayFileViewer />
    </>
  );
}

describe('OverlayFileViewer supplemental coverage', () => {
  let editor: any;
  let changeHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stableI18n.t = (key: string) => key;
    changeHandler = undefined;
    editor = {
      value: '# heading',
      getValue: vi.fn(() => editor.value),
      onDidChangeModelContent: vi.fn((cb: () => void) => {
        changeHandler = cb;
        return { dispose: vi.fn() };
      }),
      focus: vi.fn(),
      dispose: vi.fn(),
    };
    __setLoadMonacoEditorForTests(async () => ({ editor: { create: vi.fn(() => editor) } } as any));
    setupElectronApi();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: null });
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    (window as any).confirm = vi.fn();
  });

  it('shows the fallback read error for unsuccessful local reads', async () => {
    setupElectronApi({ success: false, error: 'Denied' });
    render(<Wrapper name="plain.txt" url="/repo/plain.txt" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('Denied')).toBeInTheDocument());
  });

  it('does not render front matter rows for empty metadata objects', async () => {
    render(<Wrapper name="notes.md" url="/repo/notes.md" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('# heading')).toBeInTheDocument());
    expect(document.querySelector('.file-viewer-frontmatter-table')).toBeNull();
  });

  it('exposes helper mappings for Monaco languages and local paths', () => {
    expect(__testables.getMonacoLanguage('md')).toBe('markdown');
    expect(__testables.getMonacoLanguage('unknown')).toBe('plaintext');
    expect(__testables.getMonacoLanguage('rb')).toBe('ruby');
    expect(__testables.getLocalPath('file:///repo/note.md')).toBe('/repo/note.md');
    expect(__testables.isLocalFile('/repo/note.md')).toBe(true);
  });

  it('enters edit mode, tracks dirty state, saves successfully, and disposes on close', async () => {
    render(<Wrapper name="script.js" url="/repo/script.js" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.editFile')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('viewer.loading')).toBeNull());

    fireEvent.click(screen.getByLabelText('viewer.file.editFile'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.save')).toBeInTheDocument());

    editor.value = 'console.log(1);';
    act(() => changeHandler?.());
    await waitFor(() => expect(screen.getByLabelText('viewer.file.save')).not.toBeDisabled());

    fireEvent.keyDown(window, { ctrlKey: true, key: 's' });
    await waitFor(() => expect((window.electronAPI as any).fs.writeFile).toHaveBeenCalledWith('/repo/script.js', 'console.log(1);', 'utf-8', { conflictResolution: 'replace' }));
    expect(showSuccess).toHaveBeenCalled();

    (window.electronAPI as any).fs.writeFile = vi.fn().mockRejectedValue(new Error('write boom'));
    editor.value = 'console.log(2);';
    act(() => changeHandler?.());
    await waitFor(() => expect(screen.getByLabelText('viewer.file.save')).not.toBeDisabled());
    await userEvent.click(screen.getByLabelText('viewer.file.save'));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('viewer.file.saveFailed'));

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    fireEvent.click(screen.getByLabelText('viewer.file.closeViewer'));
    await waitFor(() => expect(editor.dispose).toHaveBeenCalled());
  });

  it('keeps dirty edit state when the translation function identity changes', async () => {
    const { rerender } = render(<Wrapper name="script.js" url="/repo/script.js" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.editFile')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('viewer.loading')).toBeNull());

    fireEvent.click(screen.getByLabelText('viewer.file.editFile'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.save')).toBeInTheDocument());

    editor.value = 'unsaved after language change';
    act(() => changeHandler?.());
    const saveButton = await screen.findByLabelText('viewer.file.save');
    expect(saveButton).not.toBeDisabled();
    expect((window.electronAPI as any).fs.readFile).toHaveBeenCalledTimes(1);

    stableI18n.t = (key: string) => key;
    rerender(<Wrapper name="script.js" url="/repo/script.js" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByLabelText('viewer.file.save')).not.toBeDisabled();
    expect((window.electronAPI as any).fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('shows save errors, confirms discard, toggles fullscreen, and exits edit mode', async () => {
    (window.electronAPI as any).fs.writeFile = vi.fn().mockResolvedValue({ success: false, error: 'save failed' });
    render(<Wrapper name="script.js" url="/repo/script.js" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.editFile')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('viewer.loading')).toBeNull());

    const content = document.querySelector('.file-viewer-content') as any;
    content.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    await userEvent.click(screen.getByLabelText('viewer.file.enterFullscreen'));
    expect(content.requestFullscreen).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('viewer.file.editFile'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.save')).toBeInTheDocument());
    editor.value = 'edited';
    act(() => changeHandler?.());
    await userEvent.click(screen.getByLabelText('viewer.file.save'));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('save failed'));
    expect(screen.getByText('save failed')).toBeInTheDocument();

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByLabelText('viewer.file.exitEditing'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByLabelText('viewer.file.save')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('viewer.file.exitEditing'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.editFile')).toBeInTheDocument());
  });

  it('renders html source mode and exits fullscreen on close when there are no unsaved changes', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<h1>Hello</h1>' }) as any;
    render(<Wrapper name="page.html" url="https://example.com/page.html" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByTitle('page.html')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('viewer.file.viewSourceCode'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.viewRendered')).toBeInTheDocument());

    const content = document.querySelector('.file-viewer-content') as any;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: content });
    await userEvent.click(screen.getByLabelText('viewer.file.closeViewer'));
    await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalled());
  });

  it('renders office and fallback metadata views for local and remote files', async () => {
    render(<Wrapper name="sheet.xlsx" url="/repo/sheet.xlsx" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('viewer.file.openDefaultApp')).toBeInTheDocument());
    await userEvent.click(screen.getByText('viewer.file.openDefaultApp'));
    expect((window.electronAPI as any).workspace.openPath).toHaveBeenCalledWith('/repo/sheet.xlsx');

    render(<Wrapper name="archive" url="https://example.com/archive.bin" />);
    fireEvent.click(screen.getAllByText('Open')[1]);
    await waitFor(() => expect(screen.getAllByText('viewer.file.openDefaultApp').length).toBeGreaterThan(1));
  });

  it('handles keyboard fullscreen shortcut', async () => {
    render(<Wrapper name="script.js" url="/repo/script.js" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.editFile')).toBeInTheDocument());

    const content = document.querySelector('.file-viewer-content') as any;
    content.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: 'f' });
    await waitFor(() => expect(content.requestFullscreen).toHaveBeenCalled());

    await userEvent.click(screen.getByLabelText('viewer.file.closeViewer'));
  });



  it('renders json and text files and reflects fullscreen-active labels', async () => {
    const { rerender } = render(<Wrapper name="data.json" url="/repo/data.json" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.download')).toBeInTheDocument());

    rerender(<Wrapper name="note.txt" url="/repo/note.txt" />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.download')).toBeInTheDocument());

    const content = document.querySelector('.file-viewer-content') as any;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: content });
    fireEvent(document, new Event('fullscreenchange'));
    await waitFor(() => expect(screen.getByLabelText('viewer.file.exitFullscreen')).toBeInTheDocument());
  });

});
