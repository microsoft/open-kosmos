/**
 * @vitest-environment happy-dom
 */

import type { ClipboardEvent } from 'react';

const { mockValidateImageFile } = vi.hoisted(() => ({
  mockValidateImageFile: vi.fn(() => true),
}));

vi.mock('@shared/types/chatTypes', async () => {
  const actual = await vi.importActual('@shared/types/chatTypes');
  return {
    ...actual,
    validateImageFile: mockValidateImageFile,
  };
});

import { handleTextareaPaste } from '../chat-input/textareaPaste';

type ClipboardItemStub = {
  type: string;
  getAsFile: () => File | null;
};

function makePasteEvent(options: {
  types?: string[];
  text?: string;
  items?: ClipboardItemStub[];
  clipboardData?: null;
}) {
  const preventDefault = vi.fn();
  return {
    preventDefault,
    clipboardData: options.clipboardData === null
      ? null
      : {
          types: options.types ?? [],
          getData: vi.fn(() => options.text ?? ''),
          items: options.items ?? [],
        },
  } as unknown as ClipboardEvent<HTMLTextAreaElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe('handleTextareaPaste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    mockValidateImageFile.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns without changes when clipboard data is unavailable', async () => {
    const event = makePasteEvent({ clipboardData: null });
    const setDraftMessage = vi.fn();

    await handleTextareaPaste({
      event,
      message: 'hello',
      supportsImages: true,
      textarea: null,
      setDraftMessage,
      handleImageSelect: vi.fn(),
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setDraftMessage).not.toHaveBeenCalled();
  });

  it('prefers trimmed text content and inserts it at the textarea selection', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello world';
    textarea.setSelectionRange(6, 11);
    const event = makePasteEvent({
      types: ['text/plain', 'image/png'],
      text: ' pasted ',
      items: [{ type: 'image/png', getAsFile: () => new File(['x'], 'p.png', { type: 'image/png' }) }],
    });
    const setDraftMessage = vi.fn((next: string) => {
      textarea.value = next;
    });
    const handleImageSelect = vi.fn();

    await handleTextareaPaste({
      event,
      message: 'hello world',
      supportsImages: true,
      textarea,
      setDraftMessage,
      handleImageSelect,
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setDraftMessage).toHaveBeenCalledWith('hello pasted');
    expect(textarea.selectionStart).toBe('hello pasted'.length);
    expect(handleImageSelect).not.toHaveBeenCalled();
  });

  it('appends trimmed text when the textarea ref is unavailable', async () => {
    const event = makePasteEvent({ types: ['text/plain'], text: ' pasted ' });
    const setDraftMessage = vi.fn();

    await handleTextareaPaste({
      event,
      message: 'hello',
      supportsImages: true,
      textarea: null,
      setDraftMessage,
      handleImageSelect: vi.fn(),
    });

    expect(setDraftMessage).toHaveBeenCalledWith('hellopasted');
  });

  it('ignores non-text paste when images are unsupported or absent', async () => {
    const unsupportedEvent = makePasteEvent({
      types: ['image/png'],
      items: [{ type: 'image/png', getAsFile: () => new File(['x'], 'p.png', { type: 'image/png' }) }],
    });
    const noImageEvent = makePasteEvent({
      types: ['text/html'],
      items: [{ type: 'text/html', getAsFile: () => null }],
    });
    const handleImageSelect = vi.fn();

    await handleTextareaPaste({
      event: unsupportedEvent,
      message: '',
      supportsImages: false,
      textarea: null,
      setDraftMessage: vi.fn(),
      handleImageSelect,
    });
    await handleTextareaPaste({
      event: noImageEvent,
      message: '',
      supportsImages: true,
      textarea: null,
      setDraftMessage: vi.fn(),
      handleImageSelect,
    });

    expect(unsupportedEvent.preventDefault).not.toHaveBeenCalled();
    expect(noImageEvent.preventDefault).not.toHaveBeenCalled();
    expect(handleImageSelect).not.toHaveBeenCalled();
  });

  it('skips missing files, alerts for invalid images, and attaches valid renamed images', async () => {
    mockValidateImageFile
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const validFile = new File(['valid'], 'valid.png', { type: 'image/png' });
    const invalidFile = new File(['invalid'], 'invalid.tiff', { type: 'image/tiff' });
    const event = makePasteEvent({
      types: ['image/png'],
      items: [
        { type: 'image/png', getAsFile: () => null },
        { type: 'image/tiff', getAsFile: () => invalidFile },
        { type: 'image/png', getAsFile: () => validFile },
      ],
    });
    const handleImageSelect = vi.fn().mockResolvedValue(undefined);

    await handleTextareaPaste({
      event,
      message: '',
      supportsImages: true,
      textarea: null,
      setDraftMessage: vi.fn(),
      handleImageSelect,
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Unsupported image format'));
    expect(handleImageSelect).toHaveBeenCalledTimes(1);
    const renamedFile = handleImageSelect.mock.calls[0][0] as File;
    expect(renamedFile.name).toMatch(/^screenshot-.*\.png$/);
    expect(renamedFile.type).toBe('image/png');
  });
});
