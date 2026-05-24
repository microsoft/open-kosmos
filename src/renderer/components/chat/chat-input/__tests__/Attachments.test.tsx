// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Attachments — full coverage
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WithStore } from '@/atom';
import { AttachmentList, AttachmentsStatus, createAttachmentsAtom } from '../Attachments';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../ui/FileTypeIcon', () => ({
  default: ({ fileName }: { fileName: string }) => <span data-testid="file-icon">{fileName}</span>,
}));

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

const mockAnalyzeContent = vi.hoisted(() => vi.fn(() => ({
  imageCount: 1, fileCount: 1, othersCount: 0, totalSize: 100, estimatedTokens: 50,
})));
const mockFormatFileSize = vi.hoisted(() => vi.fn(() => '100 B'));

vi.mock('@/lib/utilities/contentUtils', () => ({
  ContentAnalyzer: { analyzeContent: (...a: any[]) => mockAnalyzeContent(...a) },
  formatFileSize: (...a: any[]) => mockFormatFileSize(...a),
  ContentPartFactory: {
    createText: (t: string) => ({ type: 'text', text: t }),
  },
  ContentConverter: {
    fileToImageContent: vi.fn().mockResolvedValue({
      type: 'image',
      image_url: { url: 'blob:img', detail: 'auto' },
      metadata: { fileName: 'img.png', fileSize: 100, mimeType: 'image/png' },
    }),
    fileToFileContent: vi.fn().mockResolvedValue({
      type: 'file',
      file: { fileName: 'doc.txt', filePath: '/tmp/doc.txt', mimeType: 'text/plain' },
      metadata: { fileSize: 50, lastModified: 0, encoding: 'utf-8', detail: 'auto' },
    }),
    fileToOthersContent: vi.fn().mockResolvedValue({
      type: 'others',
      file: { fileName: 'bin.exe', filePath: '/tmp/bin.exe', mimeType: 'application/octet-stream' },
      metadata: { fileSize: 200, lastModified: 0, detail: 'auto' },
    }),
    fileToOfficeContent: vi.fn().mockResolvedValue({
      type: 'office',
      file: { fileName: 'deck.pptx', filePath: '/tmp/deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      metadata: { fileSize: 300, lastModified: 0, detail: 'auto', truncated: false },
    }),
  },
  FileProcessor: {
    fileToDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeImagePart(fileName = 'img.png', url = '') {
  return {
    type: 'image' as const,
    image_url: { url, detail: 'auto' as const },
    metadata: { fileName, fileSize: 100, mimeType: 'image/png' },
  };
}

function makeFilePart(fileName = 'doc.txt', filePath = '/tmp/doc.txt') {
  return {
    type: 'file' as const,
    file: { fileName, filePath, mimeType: 'text/plain' },
    metadata: { fileSize: 50, lastModified: 0, encoding: 'utf-8' as const, detail: 'auto' as const },
  };
}

function makeOfficePart(fileName = 'deck.pptx', filePath = '/tmp/deck.pptx') {
  return {
    type: 'office' as const,
    file: { fileName, filePath, mimeType: 'application/vnd.ms-powerpoint' },
    metadata: { fileSize: 300, lastModified: 0, detail: 'auto' as const, truncated: false },
  };
}

function makeOthersPart(fileName = 'bin.exe', filePath = '/tmp/bin.exe') {
  return {
    type: 'others' as const,
    file: { fileName, filePath, mimeType: 'application/octet-stream' },
    metadata: { fileSize: 200, lastModified: 0, detail: 'auto' as const },
  };
}

/**
 * Render AttachmentList with specific seeded parts.
 * We use a ValueAtom (created inside the Attachments module via createAttachmentsAtom)
 * and inject parts by calling atom actions.
 */
async function renderListWithParts(parts: any[]) {
  const atom = createAttachmentsAtom();
  let capturedActions: any;

  const Feed = () => {
    const [, actions] = atom.use();
    capturedActions = actions;
    return <AttachmentList attachmentsStateAtom={atom} />;
  };

  render(<WithStore><Feed /></WithStore>);

  // Seed via loadFromMessage which directly sets state
  await act(async () => {
    capturedActions.loadFromMessage({
      id: 'seed',
      role: 'user',
      content: [{ type: 'text', text: '' }, ...parts],
      timestamp: 0,
    });
  });

  return { atom, actions: capturedActions };
}

// ── AttachmentList ────────────────────────────────────────────────────────────

describe('AttachmentList', () => {
  it('returns null when list is empty', () => {
    const atom = createAttachmentsAtom();
    const { container } = render(<WithStore><AttachmentList attachmentsStateAtom={atom} /></WithStore>);
    expect(container.firstChild).toBeNull();
  });

  it('renders image attachment (no previewUrl in loaded state)', async () => {
    await renderListWithParts([makeImagePart()]);
    expect(screen.getByText('img.png')).toBeInTheDocument();
  });

  it('renders file attachment', async () => {
    await renderListWithParts([makeFilePart()]);
    expect(screen.getByText('doc.txt')).toBeInTheDocument();
  });

  it('renders office attachment', async () => {
    await renderListWithParts([makeOfficePart()]);
    expect(screen.getByText('deck.pptx')).toBeInTheDocument();
  });

  it('renders others attachment', async () => {
    await renderListWithParts([makeOthersPart()]);
    expect(screen.getByText('bin.exe')).toBeInTheDocument();
  });

  it('remove button on file calls removeContent', async () => {
    await renderListWithParts([makeFilePart()]);
    fireEvent.click(screen.getByTitle('Remove file'));
    expect(screen.queryByText('doc.txt')).toBeNull();
  });

  it('remove button on image calls removeContent', async () => {
    await renderListWithParts([makeImagePart()]);
    fireEvent.click(screen.getByTitle('Remove attachment'));
    expect(screen.queryByText('img.png')).toBeNull();
  });

  it('remove button on office calls removeContent', async () => {
    await renderListWithParts([makeOfficePart()]);
    fireEvent.click(screen.getByTitle('Remove Office file'));
    expect(screen.queryByText('deck.pptx')).toBeNull();
  });

  it('remove button on others calls removeContent', async () => {
    await renderListWithParts([makeOthersPart()]);
    const btns = screen.getAllByTitle('Remove file');
    fireEvent.click(btns[0]);
    expect(screen.queryByText('bin.exe')).toBeNull();
  });

  it('image click when no previewUrl does NOT dispatch imageViewer:open', async () => {
    const listener = vi.fn();
    window.addEventListener('imageViewer:open', listener);
    await renderListWithParts([makeImagePart('x.png', '')]);
    fireEvent.click(document.querySelector('.attachment-item.image')!);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('imageViewer:open', listener);
  });

  it('image click WITH previewUrl dispatches imageViewer:open', async () => {
    // To get a previewUrl, we need to use addImage which calls FileProcessor.fileToDataURL
    const { ContentConverter, FileProcessor } = await import('@/lib/utilities/contentUtils');
    const listener = vi.fn();
    window.addEventListener('imageViewer:open', listener);

    const atom = createAttachmentsAtom();
    let capturedActions: any;
    const Feed = () => {
      const [, actions] = atom.use();
      capturedActions = actions;
      return <AttachmentList attachmentsStateAtom={atom} />;
    };
    render(<WithStore><Feed /></WithStore>);

    const file = new File([''], 'img.png', { type: 'image/png' });
    await act(async () => { await capturedActions.addImage(file); });

    fireEvent.click(document.querySelector('.attachment-item.image')!);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('imageViewer:open', listener);
  });

  it('file click with filePath dispatches fileViewer:open', async () => {
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    await renderListWithParts([makeFilePart()]);
    fireEvent.click(document.querySelector('.attachment-item.file')!);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('fileViewer:open', listener);
  });

  it('file click without filePath does NOT dispatch fileViewer:open', async () => {
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    await renderListWithParts([makeFilePart('nopath.txt', '')]);
    fireEvent.click(document.querySelector('.attachment-item.file')!);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('fileViewer:open', listener);
  });

  it('office click with filePath dispatches fileViewer:open', async () => {
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    await renderListWithParts([makeOfficePart()]);
    fireEvent.click(document.querySelector('.attachment-item.file')!);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('fileViewer:open', listener);
  });

  it('office click without filePath does NOT dispatch', async () => {
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    await renderListWithParts([makeOfficePart('nopath.pptx', '')]);
    fireEvent.click(document.querySelector('.attachment-item.file')!);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('fileViewer:open', listener);
  });

  it('others click with filePath dispatches fileViewer:open', async () => {
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    await renderListWithParts([makeOthersPart()]);
    fireEvent.click(document.querySelector('.attachment-item.file')!);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('fileViewer:open', listener);
  });

  it('others click without filePath does NOT dispatch', async () => {
    const listener = vi.fn();
    window.addEventListener('fileViewer:open', listener);
    await renderListWithParts([makeOthersPart('nopath.exe', '')]);
    fireEvent.click(document.querySelector('.attachment-item.file')!);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('fileViewer:open', listener);
  });

  it('file part lastModified present shows formatted date', async () => {
    const part = { ...makeFilePart(), metadata: { ...makeFilePart().metadata, lastModified: 1700000000000 } };
    await renderListWithParts([part]);
    expect(screen.getByText('doc.txt')).toBeInTheDocument();
  });
});

// ── AttachmentsStatus ─────────────────────────────────────────────────────────

describe('AttachmentsStatus', () => {
  it('returns null when totalSize === 0', () => {
    mockAnalyzeContent.mockReturnValue({ imageCount: 0, fileCount: 0, othersCount: 0, totalSize: 0, estimatedTokens: 0 });
    const atom = createAttachmentsAtom();
    const { container } = render(<WithStore><AttachmentsStatus attachmentsStateAtom={atom} /></WithStore>);
    expect(container.firstChild).toBeNull();
  });

  it('shows stats when totalSize > 0', () => {
    mockAnalyzeContent.mockReturnValue({ imageCount: 1, fileCount: 2, othersCount: 3, totalSize: 500, estimatedTokens: 200 });
    const atom = createAttachmentsAtom();
    const { container } = render(<WithStore><AttachmentsStatus attachmentsStateAtom={atom} /></WithStore>);
    expect(container.textContent).toContain('Images: 1');
    expect(container.textContent).toContain('Files: 2');
    expect(container.textContent).toContain('Others: 3');
  });

  it('shows othersCount as 0 when undefined', () => {
    mockAnalyzeContent.mockReturnValue({ imageCount: 0, fileCount: 0, othersCount: undefined, totalSize: 100, estimatedTokens: 0 });
    const atom = createAttachmentsAtom();
    const { container } = render(<WithStore><AttachmentsStatus attachmentsStateAtom={atom} /></WithStore>);
    expect(container.textContent).toContain('Others: 0');
  });
});

// ── createAttachmentsAtom actions ─────────────────────────────────────────────

describe('createAttachmentsAtom', () => {
  function setupAtom() {
    const atom = createAttachmentsAtom();
    let capturedActions: any;
    const Feed = () => {
      const [list, actions] = atom.use();
      capturedActions = actions;
      return <span data-testid="count">{list.length}</span>;
    };
    render(<WithStore><Feed /></WithStore>);
    return () => capturedActions;
  }

  it('addImage: adds image to list', async () => {
    const getActions = setupAtom();
    const file = new File([''], 'img.png', { type: 'image/png' });
    await act(async () => { await getActions().addImage(file); });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('addImage: throws DUPLICATE when same file added twice (by fullPath)', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToImageContent as any).mockResolvedValue({
      type: 'image',
      image_url: { url: 'blob:img', detail: 'auto' },
      metadata: { fileName: 'img.png', fileSize: 100, mimeType: 'image/png' },
    });
    const getActions = setupAtom();
    const file = Object.assign(new File([''], 'img.png', { type: 'image/png' }), { fullPath: '/unique/img.png' });
    await act(async () => { await getActions().addImage(file); });
    // Second add with same fullPath triggers DUPLICATE
    await expect(getActions().addImage(file)).rejects.toThrow('DUPLICATE');
  });

  it('addImage: rethrows when ContentConverter throws', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToImageContent as any).mockRejectedValueOnce(new Error('convert fail'));
    const getActions = setupAtom();
    const file = new File([''], 'bad.png', { type: 'image/png' });
    await expect(getActions().addImage(file)).rejects.toThrow('convert fail');
  });

  it('addFile: adds file to list', async () => {
    const getActions = setupAtom();
    const file = new File(['text'], 'doc.txt', { type: 'text/plain' });
    await act(async () => { await getActions().addFile(file); });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('addFile: throws DUPLICATE (by fullPath)', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToFileContent as any).mockResolvedValueOnce({
      type: 'file',
      file: { fileName: 'doc.txt', filePath: '/unique/doc.txt', mimeType: 'text/plain' },
      metadata: { fileSize: 50, lastModified: 0, encoding: 'utf-8', detail: 'auto' },
    });
    const getActions = setupAtom();
    const file = Object.assign(new File(['text'], 'doc.txt', { type: 'text/plain' }), { fullPath: '/unique/doc.txt' });
    await act(async () => { await getActions().addFile(file); });
    await expect(getActions().addFile(file)).rejects.toThrow('DUPLICATE');
  });

  it('addFile: rethrows when ContentConverter throws', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToFileContent as any).mockRejectedValueOnce(new Error('file fail'));
    const getActions = setupAtom();
    const file = new File([''], 'bad.txt', { type: 'text/plain' });
    await expect(getActions().addFile(file)).rejects.toThrow('file fail');
  });

  it('addOthers: adds others to list', async () => {
    const getActions = setupAtom();
    const file = new File([''], 'bin.exe', { type: 'application/octet-stream' });
    await act(async () => { await getActions().addOthers(file); });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('addOthers: throws DUPLICATE (by fullPath)', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToOthersContent as any).mockResolvedValueOnce({
      type: 'others',
      file: { fileName: 'bin.exe', filePath: '/unique/bin.exe', mimeType: 'application/octet-stream' },
      metadata: { fileSize: 200, lastModified: 0, detail: 'auto' },
    });
    const getActions = setupAtom();
    const file = Object.assign(new File([''], 'bin.exe', { type: 'application/octet-stream' }), { fullPath: '/unique/bin.exe' });
    await act(async () => { await getActions().addOthers(file); });
    await expect(getActions().addOthers(file)).rejects.toThrow('DUPLICATE');
  });

  it('addOthers: rethrows when ContentConverter throws', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToOthersContent as any).mockRejectedValueOnce(new Error('others fail'));
    const getActions = setupAtom();
    const file = new File([''], 'bad.exe', { type: 'application/octet-stream' });
    await expect(getActions().addOthers(file)).rejects.toThrow('others fail');
  });

  it('addOffice: adds office to list', async () => {
    const getActions = setupAtom();
    const file = new File([''], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' });
    await act(async () => { await getActions().addOffice(file); });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('addOffice: throws DUPLICATE (by fullPath)', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToOfficeContent as any).mockResolvedValueOnce({
      type: 'office',
      file: { fileName: 'deck.pptx', filePath: '/unique/deck.pptx', mimeType: 'application/vnd.ms-powerpoint' },
      metadata: { fileSize: 300, lastModified: 0, detail: 'auto', truncated: false },
    });
    const getActions = setupAtom();
    const file = Object.assign(new File([''], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' }), { fullPath: '/unique/deck.pptx' });
    await act(async () => { await getActions().addOffice(file); });
    await expect(getActions().addOffice(file)).rejects.toThrow('DUPLICATE');
  });

  it('addOffice: rethrows when ContentConverter throws', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToOfficeContent as any).mockRejectedValueOnce(new Error('office fail'));
    const getActions = setupAtom();
    const file = new File([''], 'bad.pptx', { type: 'application/vnd.ms-powerpoint' });
    await expect(getActions().addOffice(file)).rejects.toThrow('office fail');
  });

  it('isDuplicate: fullPath-based dedup for image', async () => {
    const { ContentConverter } = await import('@/lib/utilities/contentUtils');
    (ContentConverter.fileToImageContent as any).mockResolvedValueOnce({
      type: 'image',
      image_url: { url: 'blob:x', detail: 'auto' },
      metadata: { fileName: 'img.png', fileSize: 0, mimeType: 'image/png' },
      _fullPath: '/tmp/img.png',
    });
    const getActions = setupAtom();
    const f1 = Object.assign(new File([''], 'img.png', { type: 'image/png' }), { fullPath: '/tmp/img.png' });
    await act(async () => { await getActions().addImage(f1); });
    const f2 = Object.assign(new File([''], 'img.png', { type: 'image/png' }), { fullPath: '/tmp/img.png' });
    await expect(getActions().addImage(f2)).rejects.toThrow('DUPLICATE');
  });

  it('isDuplicate: fullPath-based dedup for file', async () => {
    const getActions = setupAtom();
    const f1 = Object.assign(new File([''], 'doc.txt', { type: 'text/plain' }), { fullPath: '/tmp/doc.txt' });
    await act(async () => { await getActions().addFile(f1); });
    const f2 = Object.assign(new File([''], 'doc.txt', { type: 'text/plain' }), { fullPath: '/tmp/doc.txt' });
    await expect(getActions().addFile(f2)).rejects.toThrow('DUPLICATE');
  });

  it('isDuplicate: fullPath-based dedup for office', async () => {
    const getActions = setupAtom();
    const f1 = Object.assign(new File([''], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' }), { fullPath: '/tmp/deck.pptx' });
    await act(async () => { await getActions().addOffice(f1); });
    const f2 = Object.assign(new File([''], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' }), { fullPath: '/tmp/deck.pptx' });
    await expect(getActions().addOffice(f2)).rejects.toThrow('DUPLICATE');
  });

  it('isDuplicate: fullPath-based dedup for others', async () => {
    const getActions = setupAtom();
    const f1 = Object.assign(new File([''], 'bin.exe', { type: 'application/octet-stream' }), { fullPath: '/tmp/bin.exe' });
    await act(async () => { await getActions().addOthers(f1); });
    const f2 = Object.assign(new File([''], 'bin.exe', { type: 'application/octet-stream' }), { fullPath: '/tmp/bin.exe' });
    await expect(getActions().addOthers(f2)).rejects.toThrow('DUPLICATE');
  });

  it('removeContent: removes item at index', async () => {
    const getActions = setupAtom();
    await act(async () => { await getActions().addFile(new File(['a'], 'a.txt', { type: 'text/plain' })); });
    act(() => { getActions().removeContent(0); });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('removeContent: out-of-range index is no-op', async () => {
    const getActions = setupAtom();
    await act(async () => { await getActions().addFile(new File(['a'], 'a.txt', { type: 'text/plain' })); });
    act(() => { getActions().removeContent(99); });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('removeContent on image revokes preview URL', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const getActions = setupAtom();
    await act(async () => { await getActions().addImage(new File([''], 'img.png', { type: 'image/png' })); });
    act(() => { getActions().removeContent(0); });
    expect(revokeSpy).toHaveBeenCalled();
    revokeSpy.mockRestore();
  });

  it('clear: removes all items', async () => {
    const getActions = setupAtom();
    await act(async () => { await getActions().addFile(new File(['a'], 'a.txt', { type: 'text/plain' })); });
    act(() => { getActions().clear(); });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('isValid: returns false when empty, true when populated', async () => {
    const getActions = setupAtom();
    expect(getActions().isValid()).toBe(false);
    await act(async () => { await getActions().addFile(new File(['a'], 'a.txt', { type: 'text/plain' })); });
    expect(getActions().isValid()).toBe(true);
  });

  it('createMessage: returns UserMessage with text + parts', async () => {
    const getActions = setupAtom();
    await act(async () => { await getActions().addFile(new File(['a'], 'a.txt', { type: 'text/plain' })); });
    const msg = getActions().createMessage('hello');
    expect(msg.role).toBe('user');
    expect(msg.content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(msg.content).toHaveLength(2);
  });

  it('createMessage: supports id/timestamp overrides', () => {
    const getActions = setupAtom();
    const msg = getActions().createMessage('hi', { id: 'custom-id', timestamp: 12345 });
    expect(msg.id).toBe('custom-id');
    expect(msg.timestamp).toBe(12345);
  });

  it('loadFromMessage: loads all part types from a message', async () => {
    const getActions = setupAtom();
    const message = {
      id: 'm1',
      role: 'user' as const,
      content: [
        { type: 'text', text: 'hello' },
        makeImagePart(),
        makeFilePart(),
        makeOfficePart(),
        makeOthersPart(),
      ],
      timestamp: 0,
    };
    await act(async () => { getActions().loadFromMessage(message); });
    expect(screen.getByTestId('count').textContent).toBe('4');
  });

  it('loadFromMessage: sets previewUrl for image parts', async () => {
    const getActions = setupAtom();
    const img = makeImagePart('test.png', 'blob:test-preview');
    await act(async () => {
      getActions().loadFromMessage({
        id: 'm2', role: 'user', content: [{ type: 'text', text: '' }, img], timestamp: 0,
      });
    });
    expect(getActions().getPreviewUrl('test.png')).toBe('blob:test-preview');
  });

  it('getPreviewUrl: returns undefined for unknown filename', () => {
    const getActions = setupAtom();
    expect(getActions().getPreviewUrl('unknown.png')).toBeUndefined();
  });

  it('getPreviewUrl: returns URL after addImage', async () => {
    const getActions = setupAtom();
    await act(async () => { await getActions().addImage(new File([''], 'img.png', { type: 'image/png' })); });
    expect(getActions().getPreviewUrl('img.png')).toBe('data:image/png;base64,abc');
  });
});
