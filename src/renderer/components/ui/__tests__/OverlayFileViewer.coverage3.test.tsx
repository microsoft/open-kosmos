/** @vitest-environment happy-dom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/atom', () => ({
  atom: (initialValue: unknown, actionFactory?: (get: () => unknown, set: (v: unknown) => void) => unknown) => {
    let state = initialValue;
    const subscribers: Array<() => void> = [];
    const get = () => state;
    const set = (value: unknown) => {
      state = value;
      subscribers.forEach(fn => fn());
    };
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

vi.mock('../../../styles/OverlayFileViewer.css', () => ({}));
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));
vi.mock('../../../lib/utils/yamlFrontMatter', () => ({
  parseFrontMatter: vi.fn((content: string) => ({ frontMatter: null, content })),
}));
vi.mock('../../../lib/skills/installableSkillArtifacts', () => ({
  isInstallableSkillArtifact: vi.fn(() => false),
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: loggerMock.error, info: vi.fn(), warn: vi.fn() }),
}));

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ ...toast, showToast: vi.fn() }),
}));

const monacoMock = vi.hoisted(() => ({
  getValue: vi.fn(() => 'file content'),
  changeCallback: null as null | (() => void),
  editorDispose: vi.fn(),
  subscriptionDispose: vi.fn(),
  create: vi.fn(),
}));
vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn((container: HTMLElement, options: Record<string, unknown>) => {
      monacoMock.create(container, options);
      const editor = {
        getValue: monacoMock.getValue,
        setValue: vi.fn(),
        dispose: monacoMock.editorDispose,
        focus: vi.fn(),
        onDidChangeModelContent: vi.fn((cb: () => void) => {
          monacoMock.changeCallback = cb;
          return { dispose: monacoMock.subscriptionDispose };
        }),
      };
      return editor;
    }),
  },
}));

vi.mock('lucide-react', () => {
  const Icon = (props: any) => <span data-icon {...props} />;
  return {
    X: Icon,
    Download: Icon,
    FileText: Icon,
    FileSpreadsheet: Icon,
    FileIcon: Icon,
    File: Icon,
    FileType: Icon,
    Globe: Icon,
    Code: Icon,
    Eye: Icon,
    BookOpen: Icon,
    Braces: Icon,
    AlertTriangle: Icon,
    Pencil: Icon,
    Save: Icon,
    LogOut: Icon,
    Monitor: Icon,
    Minimize: Icon,
  };
});

import * as mockedMonacoModule from 'monaco-editor';
import { OverlayFileViewer, FileViewerAtom, type OverlayFileDescriptor } from '../OverlayFileViewer';

void mockedMonacoModule;

function setupElectronApi(overrides: Record<string, any> = {}) {
  const api = {
    fs: {
      readFile: vi.fn().mockResolvedValue({ success: true, content: 'file content' }),
      writeFile: vi.fn().mockResolvedValue({ success: true }),
      stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 1024 } }),
      ...overrides.fs,
    },
    workspace: {
      openPath: vi.fn(),
      ...overrides.workspace,
    },
  };
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: api,
  });
  return api;
}

function Wrapper({ file }: { file: OverlayFileDescriptor }) {
  const [, actions] = FileViewerAtom.use();
  return (
    <>
      <button onClick={() => actions.open(file)}>Open</button>
      <OverlayFileViewer />
    </>
  );
}

async function openViewer(file: OverlayFileDescriptor, overrides: Record<string, any> = {}) {
  const api = setupElectronApi(overrides);
  render(<Wrapper file={file} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open' })); });
  await waitFor(() => expect(screen.getAllByText(file.name).length).toBeGreaterThan(0));
  return api;
}

async function enterEditMode() {
  await waitFor(() => expect(screen.getByTitle('Edit')).toBeTruthy());
  await act(async () => { fireEvent.click(screen.getByTitle('Edit')); });
  await vi.dynamicImportSettled();
  await waitFor(() => expect(screen.getByTitle('Exit Edit Mode')).toBeTruthy());
  await waitFor(() => expect(monacoMock.changeCallback).not.toBeNull());
}

function makeDirty(value = 'changed content') {
  monacoMock.getValue.mockReturnValue(value);
  act(() => { monacoMock.changeCallback?.(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  monacoMock.getValue.mockReturnValue('file content');
  monacoMock.changeCallback = null;
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  (document as any).exitFullscreen = vi.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  HTMLElement.prototype.requestFullscreen = vi.fn(async function requestFullscreen(this: HTMLElement) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OverlayFileViewer edit mode coverage', () => {
  it('saves dirty local text edits successfully', async () => {
    const api = await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });
    await enterEditMode();
    makeDirty('new content');

    await act(async () => { fireEvent.click(screen.getByTitle('Save (⌘S)')); });

    expect(api.fs.writeFile).toHaveBeenCalledWith('/tmp/notes.txt', 'new content', 'utf-8', {
      conflictResolution: 'replace',
    });
    expect(toast.showSuccess).toHaveBeenCalledWith('Saved notes.txt');
  });

  it('shows write errors and save-error banner', async () => {
    await openViewer(
      { name: 'notes.txt', url: '/tmp/notes.txt' },
      { fs: { writeFile: vi.fn().mockResolvedValue({ success: false, error: 'disk full' }) } },
    );
    await enterEditMode();
    makeDirty('new content');

    await act(async () => { fireEvent.click(screen.getByTitle('Save (⌘S)')); });

    expect(toast.showError).toHaveBeenCalledWith('disk full');
    expect(screen.getByText('disk full')).toBeTruthy();
  });

  it('shows a generic save error when writeFile throws', async () => {
    await openViewer(
      { name: 'notes.txt', url: '/tmp/notes.txt' },
      { fs: { writeFile: vi.fn().mockRejectedValue(new Error('boom')) } },
    );
    await enterEditMode();
    makeDirty('new content');

    await act(async () => { fireEvent.click(screen.getByTitle('Save (⌘S)')); });

    expect(toast.showError).toHaveBeenCalledWith('Failed to save file');
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('keeps edit mode when dirty cancel is rejected, then exits when confirmed', async () => {
    await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });
    await enterEditMode();
    makeDirty('new content');

    (window.confirm as any).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTitle('Exit Edit Mode'));
    expect(screen.getByTitle('Exit Edit Mode')).toBeTruthy();

    (window.confirm as any).mockReturnValueOnce(true);
    fireEvent.click(screen.getByTitle('Exit Edit Mode'));
    await waitFor(() => expect(screen.queryByTitle('Exit Edit Mode')).toBeNull());
    expect(monacoMock.editorDispose).toHaveBeenCalled();
  });

  it('keeps viewer open when dirty close is rejected', async () => {
    await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });
    await enterEditMode();
    makeDirty('new content');

    (window.confirm as any).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTitle('Close'));

    expect(screen.getByText('notes.txt')).toBeTruthy();
  });

  it('saves dirty content with keyboard shortcut', async () => {
    const api = await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });
    await enterEditMode();
    makeDirty('keyboard save');

    await act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });

    expect(api.fs.writeFile).toHaveBeenCalledWith('/tmp/notes.txt', 'keyboard save', 'utf-8', {
      conflictResolution: 'replace',
    });
  });
});

describe('OverlayFileViewer loading and fullscreen coverage', () => {
  it('shows local read catch errors', async () => {
    await openViewer(
      { name: 'broken.txt', url: '/tmp/broken.txt' },
      { fs: { readFile: vi.fn().mockRejectedValue(new Error('read failed')) } },
    );

    await waitFor(() => expect(screen.getByText(/cannot be read/i)).toBeTruthy());
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('loads remote text successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('remote body'),
    });

    await openViewer({ name: 'remote.txt', url: 'https://example.com/remote.txt' });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://example.com/remote.txt'));
  });

  it('toggles fullscreen and exits fullscreen on close', async () => {
    await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });

    await act(async () => { fireEvent.click(screen.getByLabelText('Enter fullscreen presentation')); });
    await waitFor(() => expect(screen.getByLabelText('Exit fullscreen presentation')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByTitle('Close')); });

    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it('logs fullscreen toggle failures', async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn().mockRejectedValue(new Error('fullscreen denied'));
    await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });

    await act(async () => { fireEvent.click(screen.getByLabelText('Enter fullscreen presentation')); });

    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('does not close on Escape while fullscreen', async () => {
    await openViewer({ name: 'notes.txt', url: '/tmp/notes.txt' });
    await act(async () => { fireEvent.click(screen.getByLabelText('Enter fullscreen presentation')); });
    await waitFor(() => expect(screen.getByLabelText('Exit fullscreen presentation')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText('notes.txt')).toBeTruthy();
  });

  it('opens local Office files through the default application', async () => {
    const api = await openViewer({
      name: 'sheet.xlsx',
      url: '/tmp/sheet.xlsx',
      size: 2 * 1024 * 1024,
      lastModified: '2026-07-04',
    });

    fireEvent.click(screen.getByText('Open with Default App'));

    expect(api.workspace.openPath).toHaveBeenCalledWith('/tmp/sheet.xlsx');
    expect(screen.getByText('2.0 MB')).toBeTruthy();
    expect(screen.getByText('2026-07-04')).toBeTruthy();
  });
});
