// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WithStore } from '@/atom';
import { createAttachmentsAtom, AttachmentList } from '../Attachments';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() })
}));

vi.mock('../../ui/FileTypeIcon', () => ({
  default: ({ fileName }: { fileName: string }) => <span>{fileName}</span>,
}));

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

const imageContent = {
  type: 'image',
  image_url: { url: 'blob:img', detail: 'auto' },
  metadata: { fileName: 'photo.png', fileSize: 10, mimeType: 'image/png' },
};
const fileContent = {
  type: 'file',
  file: { fileName: 'notes.txt', filePath: '/repo/notes.txt', mimeType: 'text/plain' },
  metadata: { fileSize: 20, lastModified: 0, encoding: 'utf-8', detail: 'auto' },
};
const officeContent = {
  type: 'office',
  file: { fileName: 'deck.pptx', filePath: '/repo/deck.pptx', mimeType: 'application/vnd.ms-powerpoint' },
  metadata: { fileSize: 30, lastModified: 0, detail: 'auto', truncated: false },
};
const othersContent = {
  type: 'others',
  file: { fileName: 'archive.bin', filePath: '/repo/archive.bin', mimeType: 'application/octet-stream' },
  metadata: { fileSize: 40, lastModified: 0, detail: 'auto' },
};

vi.mock('@/lib/utilities/contentUtils', () => ({
  ContentPartFactory: { createText: (text: string) => ({ type: 'text', text }) },
  ContentAnalyzer: { analyzeContent: vi.fn(() => ({ imageCount: 0, fileCount: 0, othersCount: 0, totalSize: 0, estimatedTokens: 0 })) },
  formatFileSize: vi.fn(() => '0 B'),
  ContentConverter: {
    fileToImageContent: vi.fn(async () => ({ ...imageContent })),
    fileToFileContent: vi.fn(async () => ({ ...fileContent })),
    fileToOfficeContent: vi.fn(async () => ({ ...officeContent })),
    fileToOthersContent: vi.fn(async () => ({ ...othersContent })),
  },
  FileProcessor: {
    fileToDataURL: vi.fn(async () => 'data:image/png;base64,abc'),
  },
}));

function setupAtom() {
  const atom = createAttachmentsAtom();
  let capturedActions: any;

  function Probe() {
    const [, actions] = atom.use();
    capturedActions = actions;
    return <AttachmentList attachmentsStateAtom={atom} />;
  }

  render(
    <WithStore>
      <Probe />
    </WithStore>,
  );

  return () => capturedActions;
}

describe('Attachments supplemental coverage', () => {
  it('rejects duplicate attachments by matching file name and size without fullPath', async () => {
    const getActions = setupAtom();

    await act(async () => {
      await getActions().addImage(new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' }));
      await getActions().addFile(new File([new Uint8Array(20)], 'notes.txt', { type: 'text/plain' }));
      await getActions().addOffice(new File([new Uint8Array(30)], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' }));
      await getActions().addOthers(new File([new Uint8Array(40)], 'archive.bin', { type: 'application/octet-stream' }));
    });

    await expect(getActions().addImage(new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' }))).rejects.toThrow('DUPLICATE');
    await expect(getActions().addFile(new File([new Uint8Array(20)], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow('DUPLICATE');
    await expect(getActions().addOffice(new File([new Uint8Array(30)], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' }))).rejects.toThrow('DUPLICATE');
    await expect(getActions().addOthers(new File([new Uint8Array(40)], 'archive.bin', { type: 'application/octet-stream' }))).rejects.toThrow('DUPLICATE');
  });

  it('loads others attachments from an existing multipart message', async () => {
    const getActions = setupAtom();

    await act(async () => {
      getActions().loadFromMessage({
        id: 'seed',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }, othersContent],
        timestamp: 1,
      });
    });

    expect(screen.getByText('archive.bin')).toBeInTheDocument();
    expect(getActions().createMessage('edited').content[1]).toMatchObject({
      type: 'others',
      file: { fileName: 'archive.bin' },
    });
  });

  it('removes a loaded others attachment through the rendered list', async () => {
    const getActions = setupAtom();
    const user = userEvent.setup();

    await act(async () => {
      getActions().loadFromMessage({
        id: 'seed',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }, othersContent],
        timestamp: 1,
      });
    });

    await user.click(screen.getByTitle('chat.attachments.removeFile'));
    expect(screen.queryByText('archive.bin')).toBeNull();
  });
});
