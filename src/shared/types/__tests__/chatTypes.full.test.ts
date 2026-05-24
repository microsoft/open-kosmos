import {
  MessageHelper,
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  ToolMessage,
  validateImageFile,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_TEXT_TYPES,
  FILE_ATTACHMENT_LIMITS,
} from '../chatTypes';

describe('validateImageFile', () => {
  it('returns true for supported image types', () => {
    SUPPORTED_IMAGE_TYPES.forEach(type => {
      const file = { type } as File;
      expect(validateImageFile(file)).toBe(true);
    });
  });

  it('returns false for unsupported types', () => {
    const file = { type: 'application/pdf' } as File;
    expect(validateImageFile(file)).toBe(false);
  });

  it('returns false for empty type', () => {
    const file = { type: '' } as File;
    expect(validateImageFile(file)).toBe(false);
  });
});

describe('MessageHelper', () => {
  const userMsg: UserMessage = {
    id: 'u1',
    role: 'user',
    timestamp: 1000,
    content: [
      { type: 'text', text: 'hello' },
      { type: 'image', image_url: { url: 'data:...' }, metadata: { fileName: 'a.png', fileSize: 100, mimeType: 'image/png' } },
      { type: 'file', file_url: { url: 'f' }, metadata: { fileName: 'b.txt', fileSize: 50, mimeType: 'text/plain', lines: 10 } },
      { type: 'office', office_url: { url: 'o' }, metadata: { fileName: 'c.docx', fileSize: 200, mimeType: 'application/docx' } },
      { type: 'others', file_url: { url: 'x' }, metadata: { fileName: 'd.bin', fileSize: 300, mimeType: 'application/octet-stream' } },
    ] as any,
  };

  const textOnlyMsg: UserMessage = {
    id: 'u2',
    role: 'user',
    timestamp: 2000,
    content: [{ type: 'text', text: 'only text' }],
  };

  describe('getText', () => {
    it('concatenates all text parts', () => {
      expect(MessageHelper.getText(userMsg)).toBe('hello');
    });

    it('returns empty string when no text parts', () => {
      const msg: UserMessage = { id: 'x', role: 'user', timestamp: 0, content: [] };
      expect(MessageHelper.getText(msg)).toBe('');
    });
  });

  describe('getImages', () => {
    it('returns image parts', () => {
      const imgs = MessageHelper.getImages(userMsg);
      expect(imgs).toHaveLength(1);
      expect(imgs[0].type).toBe('image');
    });
  });

  describe('getFiles', () => {
    it('returns file parts', () => {
      const files = MessageHelper.getFiles(userMsg);
      expect(files).toHaveLength(1);
      expect(files[0].type).toBe('file');
    });
  });

  describe('getOffice', () => {
    it('returns office parts', () => {
      const office = MessageHelper.getOffice(userMsg);
      expect(office).toHaveLength(1);
      expect(office[0].type).toBe('office');
    });
  });

  describe('getOthers', () => {
    it('returns others parts', () => {
      const others = MessageHelper.getOthers(userMsg);
      expect(others).toHaveLength(1);
      expect(others[0].type).toBe('others');
    });
  });

  describe('hasAttachments', () => {
    it('returns true when non-text parts exist', () => {
      expect(MessageHelper.hasAttachments(userMsg)).toBe(true);
    });

    it('returns false when only text parts', () => {
      expect(MessageHelper.hasAttachments(textOnlyMsg)).toBe(false);
    });
  });

  describe('hasImages', () => {
    it('returns true when image parts exist', () => {
      expect(MessageHelper.hasImages(userMsg)).toBe(true);
    });

    it('returns false when no image parts', () => {
      expect(MessageHelper.hasImages(textOnlyMsg)).toBe(false);
    });
  });

  describe('hasFiles', () => {
    it('returns true when file parts exist', () => {
      expect(MessageHelper.hasFiles(userMsg)).toBe(true);
    });

    it('returns false when no file parts', () => {
      expect(MessageHelper.hasFiles(textOnlyMsg)).toBe(false);
    });
  });

  describe('hasOffice', () => {
    it('returns true when office parts exist', () => {
      expect(MessageHelper.hasOffice(userMsg)).toBe(true);
    });

    it('returns false when no office parts', () => {
      expect(MessageHelper.hasOffice(textOnlyMsg)).toBe(false);
    });
  });

  describe('hasOthers', () => {
    it('returns true when others parts exist', () => {
      expect(MessageHelper.hasOthers(userMsg)).toBe(true);
    });

    it('returns false when no others parts', () => {
      expect(MessageHelper.hasOthers(textOnlyMsg)).toBe(false);
    });
  });

  describe('getAttachmentCounts', () => {
    it('returns correct counts', () => {
      const counts = MessageHelper.getAttachmentCounts(userMsg);
      expect(counts).toEqual({ images: 1, files: 1, office: 1, others: 1, total: 4 });
    });

    it('returns zeros for text-only message', () => {
      const counts = MessageHelper.getAttachmentCounts(textOnlyMsg);
      expect(counts).toEqual({ images: 0, files: 0, office: 0, others: 0, total: 0 });
    });
  });

  describe('createTextMessage', () => {
    it('creates a user text message', () => {
      const msg = MessageHelper.createTextMessage('hi', 'user', 'id1');
      expect(msg.role).toBe('user');
      expect(msg.id).toBe('id1');
      expect(msg.content).toEqual([{ type: 'text', text: 'hi' }]);
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('creates an assistant text message', () => {
      const msg = MessageHelper.createTextMessage('response', 'assistant');
      expect(msg.role).toBe('assistant');
      expect(msg.id).toMatch(/^msg_/);
    });

    it('creates a system text message', () => {
      const msg = MessageHelper.createTextMessage('system', 'system');
      expect(msg.role).toBe('system');
    });
  });

  describe('createToolMessage', () => {
    it('creates a tool message', () => {
      const msg = MessageHelper.createToolMessage('output', 'tc1', 'search', 'tool-id');
      expect(msg.role).toBe('tool');
      expect(msg.id).toBe('tool-id');
      expect(msg.tool_call_id).toBe('tc1');
      expect(msg.name).toBe('search');
      expect(msg.content).toEqual([{ type: 'text', text: 'output' }]);
    });

    it('generates id when not provided', () => {
      const msg = MessageHelper.createToolMessage('out', 'tc2', 'tool');
      expect(msg.id).toMatch(/^tool_/);
    });
  });

  describe('setTextContent', () => {
    it('replaces text content while preserving non-text parts', () => {
      const result = MessageHelper.setTextContent(userMsg, 'new text');
      const textParts = result.content.filter(p => p.type === 'text');
      expect(textParts).toHaveLength(1);
      expect((textParts[0] as any).text).toBe('new text');
      // Non-text parts preserved
      expect(result.content.filter(p => p.type !== 'text').length).toBe(4);
    });

    it('adds text to message with no prior text', () => {
      const msg: UserMessage = {
        id: 'x', role: 'user', timestamp: 0,
        content: [{ type: 'image', image_url: { url: '' }, metadata: { fileName: '', fileSize: 0, mimeType: '' } }] as any,
      };
      const result = MessageHelper.setTextContent(msg, 'added');
      expect(result.content[0]).toEqual({ type: 'text', text: 'added' });
    });
  });
});

describe('SUPPORTED_TEXT_TYPES', () => {
  it('is a non-empty array', () => {
    expect(SUPPORTED_TEXT_TYPES.length).toBeGreaterThan(0);
  });
});

describe('FILE_ATTACHMENT_LIMITS', () => {
  it('has expected properties', () => {
    expect(FILE_ATTACHMENT_LIMITS).toBeDefined();
    expect(typeof FILE_ATTACHMENT_LIMITS).toBe('object');
  });
});
