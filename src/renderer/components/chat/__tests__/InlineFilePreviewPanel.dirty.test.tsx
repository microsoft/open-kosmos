/** @vitest-environment happy-dom */

/**
 * InlineFilePreviewPanel — dirty-editing cascade tests (isolated)
 *
 * This file is deliberately separated from InlineFilePreviewPanel.coverage3
 * because that file uses `vi.doMock('monaco-editor', …)` with manually-resolved
 * promises to exercise the delayed/destroyed import paths. Those doMock calls
 * poison the monaco module cache for any later test that relies on the standard
 * capturing mock, so the `onDidChangeModelContent` callback (FN@451) is never
 * recorded and the whole isDirty=true cascade stays uncovered.
 *
 * Here the capturing monaco mock is the ONLY monaco mock in the file, so the
 * dynamic `import('monaco-editor')` inside the edit-mode effect reliably calls
 * editor.create → records the change callback. Driving that callback flips
 * isDirty=true, which is what unlocks:
 *   - handleSave guard + body (lines 491, 492, 500, 506)
 *   - dirty conditional CSS class on the Save button (line 708)
 *   - the dirty-guarded handleClose (line 564) and handleBack (line 570)
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

// ---- CSS ----
vi.mock('../../../styles/InlineFilePreviewPanel.css', () => ({}));

// ---- lucide-react ----
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  ArrowLeft: () => <span data-testid="icon-arrowleft" />,
  FileText: () => <span />,
  FileSpreadsheet: () => <span />,
  FileIcon: () => <span />,
  File: () => <span />,
  FileType: () => <span />,
  Globe: () => <span />,
  Code: () => <span />,
  Eye: () => <span />,
  BookOpen: () => <span />,
  Braces: () => <span />,
  AlertTriangle: () => <span />,
  Download: () => <span />,
  ExternalLink: () => <span />,
  Pencil: () => <span />,
  Save: () => <span />,
  LogOut: () => <span />,
  Monitor: () => <span data-testid="icon-monitor" />,
  Minimize: () => <span data-testid="icon-minimize" />,
}));

// ---- react-markdown / rehype / remark ----
vi.mock('react-markdown', () => ({
  default: ({ children }: any) => <div data-testid="markdown-body">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));

// ---- helpers ----
vi.mock('../../../lib/utils/yamlFrontMatter', () => ({
  parseFrontMatter: vi.fn((text: string) => ({ frontMatter: null, content: text })),
}));
vi.mock('../../../lib/skills/installableSkillArtifacts', () => ({
  isInstallableSkillArtifact: vi.fn(() => false),
}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const i18nMock = vi.hoisted(() => {
  const translate = (key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      'common.edit': 'Edit',
      'viewer.file.backToFiles': 'Back to files',
      'viewer.file.closePreview': 'Close preview',
      'viewer.file.discardChangesConfirm': 'Discard unsaved changes?',
      'viewer.file.exitEditMode': 'Exit edit mode',
      'viewer.file.noChanges': 'No changes',
      'viewer.file.saveCtrlShortcut': 'Save (Ctrl/Cmd+S)',
      'viewer.file.saveFailed': 'Failed to save file',
      'viewer.file.saved': `Saved ${params?.name ?? ''}`,
    };
    return translations[key] ?? key;
  };
  return { t: translate };
});

vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: i18nMock.t, language: 'en', setLanguage: vi.fn() }),
}));

// ---- toast ----
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError, showToast: vi.fn() }),
}));

// ---- Monaco editor mock that records the content-change callback ----
let capturedChangeCallback: (() => void) | null = null;
let mockGetValue = vi.fn(() => 'file content');

vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn(() => ({
      getValue: mockGetValue,
      setValue: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onDidChangeModelContent: vi.fn((cb: () => void) => {
        capturedChangeCallback = cb;
        return { dispose: vi.fn() };
      }),
    })),
  },
}));

import { InlineFilePreviewPanel, type InlineFileDescriptor } from '../InlineFilePreviewPanel';

function setupElectronApi(overrides: any = {}) {
  Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
      fs: {
        readFile: vi.fn().mockResolvedValue({ success: true, content: 'file content' }),
        writeFile: vi.fn().mockResolvedValue({ success: true }),
        stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 512, mtime: 1000 } }),
        ...overrides.fs,
      },
      workspace: {
        openPath: vi.fn(),
        showInFolder: vi.fn(),
        ...overrides.workspace,
      },
    },
  });
}

const LOCAL_TXT: InlineFileDescriptor = { name: 'notes.txt', url: '/tmp/notes.txt', size: 512 };
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  i18nMock.t = (key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      'common.edit': 'Edit',
      'viewer.file.backToFiles': 'Back to files',
      'viewer.file.closePreview': 'Close preview',
      'viewer.file.discardChangesConfirm': 'Discard unsaved changes?',
      'viewer.file.exitEditMode': 'Exit edit mode',
      'viewer.file.noChanges': 'No changes',
      'viewer.file.saveCtrlShortcut': 'Save (Ctrl/Cmd+S)',
      'viewer.file.saveFailed': 'Failed to save file',
      'viewer.file.saved': `Saved ${params?.name ?? ''}`,
    };
    return translations[key] ?? key;
  };
  capturedChangeCallback = null;
  mockGetValue = vi.fn(() => 'file content');
  setupElectronApi();
  vi.stubGlobal('confirm', vi.fn(() => true));
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
});

// Render → wait for content-ready → click Edit → flush dynamic monaco import so
// the change callback is captured. The presence of `.file-viewer-edit-wrapper`
// proves the line-612 load guard passed (isContentReady=true), which is the
// pre-condition for the edit-mode container to mount when isEditing flips.
async function openAndEdit(opts: { onBack?: () => void } = {}) {
  const rendered = render(
    <InlineFilePreviewPanel
      file={LOCAL_TXT}
      isOpen={true}
      onClose={onClose}
      onBack={opts.onBack}
    />
  );
  await waitFor(() => expect(screen.getByTitle('Edit')).toBeInTheDocument());
  await waitFor(() =>
    expect(document.querySelector('.file-viewer-edit-wrapper')).not.toBeNull()
  );
  await waitFor(() => expect(window.electronAPI.fs?.readFile).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByTitle('Edit'));

  await waitFor(() =>
    expect(document.querySelector('.inline-preview-edit-wrapper')).not.toBeNull()
  );
  await waitFor(() => expect(capturedChangeCallback).not.toBeNull(), { timeout: 2000 });
  return rendered;
}

describe('InlineFilePreviewPanel — dirty editing cascade (FN@451)', () => {
  it('change callback → dirty class on Save + successful save (491,492,500,708)', async () => {
    await openAndEdit();
    expect(capturedChangeCallback).not.toBeNull();

    mockGetValue.mockReturnValue('brand new content');
    act(() => { capturedChangeCallback!(); });

    const saveBtn = await screen.findByTitle('Save (Ctrl/Cmd+S)');
    expect(saveBtn.className).toContain('inline-preview-btn-dirty');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => { fireEvent.click(saveBtn); });
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Saved notes.txt'));
    expect((window.electronAPI as any).fs.writeFile).toHaveBeenCalled();
  });

  it('save failure with no error field → generic fallback message (line 506)', async () => {
    (window.electronAPI as any).fs.writeFile = vi.fn().mockResolvedValue({ success: false });
    await openAndEdit();
    expect(capturedChangeCallback).not.toBeNull();

    mockGetValue.mockReturnValue('edited body');
    act(() => { capturedChangeCallback!(); });

    const saveBtn = await screen.findByTitle('Save (Ctrl/Cmd+S)');
    await act(async () => { fireEvent.click(saveBtn); });
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Failed to save file'));
  });

  it('handleClose blocked when dirty + confirm=false (line 564)', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    await openAndEdit();
    expect(capturedChangeCallback).not.toBeNull();

    mockGetValue.mockReturnValue('unsaved changes');
    act(() => { capturedChangeCallback!(); });
    await screen.findByTitle('Save (Ctrl/Cmd+S)');

    fireEvent.click(screen.getByTitle('Close preview'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('handleBack blocked when dirty + confirm=false (line 570)', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const onBack = vi.fn();
    await openAndEdit({ onBack });
    expect(capturedChangeCallback).not.toBeNull();

    mockGetValue.mockReturnValue('unsaved edits');
    act(() => { capturedChangeCallback!(); });
    await screen.findByTitle('Save (Ctrl/Cmd+S)');

    fireEvent.click(screen.getByTitle('Back to files'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('keeps dirty edit state when the translation function identity changes', async () => {
    const { rerender } = await openAndEdit();
    expect(capturedChangeCallback).not.toBeNull();

    mockGetValue.mockReturnValue('unsaved edits after language switch');
    act(() => { capturedChangeCallback!(); });
    const saveBtn = await screen.findByTitle('Save (Ctrl/Cmd+S)');
    expect(saveBtn.className).toContain('inline-preview-btn-dirty');
    expect((window.electronAPI as any).fs.readFile).toHaveBeenCalledTimes(1);

    i18nMock.t = (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'common.edit': 'Edit',
        'viewer.file.backToFiles': 'Back to files',
        'viewer.file.closePreview': 'Close preview',
        'viewer.file.discardChangesConfirm': 'Discard unsaved changes?',
        'viewer.file.exitEditMode': 'Exit edit mode',
        'viewer.file.noChanges': 'No changes',
        'viewer.file.saveCtrlShortcut': 'Save (Ctrl/Cmd+S)',
        'viewer.file.saveFailed': 'Failed to save file',
        'viewer.file.saved': `Saved ${params?.name ?? ''}`,
      };
      return translations[key] ?? key;
    };
    rerender(
      <InlineFilePreviewPanel
        file={LOCAL_TXT}
        isOpen={true}
        onClose={onClose}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const stillDirtySaveBtn = await screen.findByTitle('Save (Ctrl/Cmd+S)');
    expect(stillDirtySaveBtn.className).toContain('inline-preview-btn-dirty');
    expect((window.electronAPI as any).fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('handleSave is a no-op when not dirty (guard line 491)', async () => {
    await openAndEdit();
    // No change callback fired → isDirty stays false → Save button disabled.
    const saveBtn = await screen.findByTitle('No changes');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveBtn);
    expect((window.electronAPI as any).fs.writeFile).not.toHaveBeenCalled();
  });
});
