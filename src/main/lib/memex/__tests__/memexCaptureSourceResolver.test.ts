import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { resolveMemexCaptureSource } from '../memexCaptureSourceResolver';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'memex-source-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('resolveMemexCaptureSource', () => {
  async function writeChatSessionFile(messageText = 'Remember that I prefer concise answers.'): Promise<string> {
    const chatSessionFilePath = path.join(tempDir, 'chatSession_20260707120000_device_random.json');
    await writeFile(chatSessionFilePath, JSON.stringify({
      chatSession_id: 'chatSession_20260707120000_device_random',
      chat_history: [
        {
          id: 'user-1',
          role: 'user',
          timestamp: Date.now(),
          content: [{ type: 'text', text: messageText }],
        },
      ],
      context_history: [],
    }), 'utf8');
    return chatSessionFilePath;
  }

  it('resolves current chat-session evidence to the persisted latest user message anchor', async () => {
    const chatSessionFilePath = await writeChatSessionFile();
    const ensureChatSessionSaved = vi.fn().mockResolvedValue({ success: true });

    const resolved = await resolveMemexCaptureSource({
      scope: 'profile-memory',
      category: 'preference',
      source_type: 'chat-session',
      profile_intent_quote: 'I prefer concise answers',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'user-1',
      ensureChatSessionSaved,
    });

    expect(ensureChatSessionSaved).toHaveBeenCalledOnce();
    expect(resolved).toMatchObject({
      sourceType: 'chat-session',
      sourcePath: await realpath(chatSessionFilePath),
      sourceAnchor: 'message:user:user-1',
      sourceRelpath: 'chat-1/202607/chatSession_20260707120000_device_random.json',
      sourceChatId: 'chat-1',
      sourceChatSessionId: 'chatSession_20260707120000_device_random',
    });
  });

  it('fails closed when chat-session capture has no current user message id', async () => {
    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath: path.join(tempDir, 'missing.json'),
    })).rejects.toThrow(/No current persisted user message/);
  });

  it('rejects capture from sub-agents and invalid source types', async () => {
    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      isSubAgent: true,
    })).rejects.toThrow(/Sub-agents may read memory/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'raw',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
    })).rejects.toThrow(/capture requires source_type/);
  });

  it('rejects invalid chat-session capture context before reading the file', async () => {
    const chatSessionFilePath = await writeChatSessionFile();

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'user-1',
      skipPersistence: true,
    })).rejects.toThrow(/persistence is disabled/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      currentUserMessageId: 'user-1',
    })).rejects.toThrow(/persisted chat session path/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
      source: chatSessionFilePath,
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'user-1',
    })).rejects.toThrow(/omit source/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
      source_anchor: 'message:user:user-1',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'user-1',
    })).rejects.toThrow(/message:user:latest/);
  });

  it('rejects chat-session capture when the save barrier fails or anchor disappears', async () => {
    const chatSessionFilePath = await writeChatSessionFile();

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'user-1',
      ensureChatSessionSaved: vi.fn().mockResolvedValue({ success: false, error: 'disk full' }),
    })).rejects.toThrow(/disk full/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'chat-session',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'missing-user',
    })).rejects.toThrow(/no longer contains/);
  });

  it('enforces profile-memory categories and quote anchoring', async () => {
    const chatSessionFilePath = await writeChatSessionFile('Remember that I prefer concise answers.');
    const base = {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilePath,
      currentUserMessageId: 'user-1',
    };

    await expect(resolveMemexCaptureSource({
      scope: 'profile-memory',
      category: 'decision',
      source_type: 'chat-session',
      profile_intent_quote: 'I prefer concise answers',
    }, base)).rejects.toThrow(/preference, constraint, or correction/);

    await expect(resolveMemexCaptureSource({
      scope: 'profile-memory',
      category: 'preference',
      source_type: 'chat-session',
    }, base)).rejects.toThrow(/requires profile_intent_quote/);

    await expect(resolveMemexCaptureSource({
      scope: 'profile-memory',
      category: 'preference',
      source_type: 'chat-session',
      profile_intent_quote: 'I prefer long answers',
    }, base)).rejects.toThrow(/must appear/);
  });

  it('rejects profile-memory capture from file-backed evidence', async () => {
    await expect(resolveMemexCaptureSource({
      scope: 'profile-memory',
      category: 'preference',
      source_type: 'knowledge-file',
      source: path.join(tempDir, 'note.md'),
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: tempDir,
    })).rejects.toThrow(/profile-memory capture only supports chat-session/);
  });

  it('rejects source_anchor on file-backed evidence and invalid knowledge-file contexts', async () => {
    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
      source_anchor: 'message:user:latest',
      source: path.join(tempDir, 'note.md'),
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: tempDir,
    })).rejects.toThrow(/source_anchor is only supported/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: tempDir,
    })).rejects.toThrow(/knowledge-file capture requires source/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
      source: path.join(tempDir, 'note.md'),
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
    })).rejects.toThrow(/configured knowledge base path/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
      source: path.join(tempDir, 'note.md'),
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: 'relative-root',
    })).rejects.toThrow(/configured knowledge base path/);
  });

  it('rejects file-backed sources outside roots, relative sources, and non-regular files', async () => {
    const root = path.join(tempDir, 'kb');
    const outside = path.join(tempDir, 'outside.md');
    await mkdir(root, { recursive: true });
    await writeFile(outside, '# Outside', 'utf8');

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
      source: 'relative.md',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: root,
    })).rejects.toThrow(/absolute path/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
      source: outside,
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: root,
    })).rejects.toThrow(/configured root/);

    await expect(resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'decision',
      source_type: 'knowledge-file',
      source: root,
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      knowledgeBasePath: root,
    })).rejects.toThrow(/not a regular file/);
  });

  it('resolves @chat-session deliverable paths under the deliverables root', async () => {
    const deliverablesRoot = path.join(tempDir, 'deliverables');
    await mkdir(deliverablesRoot, { recursive: true });
    const sourcePath = path.join(deliverablesRoot, 'plan.md');
    await writeFile(sourcePath, '# Plan', 'utf8');

    const resolved = await resolveMemexCaptureSource({
      scope: 'current-agent',
      category: 'deliverable',
      source_type: 'session-deliverable',
      source: '@chat-session:plan.md',
    }, {
      userAlias: 'alice',
      chatId: 'chat-1',
      chatSessionId: 'chatSession_20260707120000_device_random',
      chatSessionFilesPath: deliverablesRoot,
      sourceAgentId: 'agent-1',
    });

    expect(resolved).toMatchObject({
      sourceType: 'session-deliverable',
      sourcePath: await realpath(sourcePath),
      sourceRelpath: 'plan.md',
      sourceAgentId: 'agent-1',
    });
  });
});
