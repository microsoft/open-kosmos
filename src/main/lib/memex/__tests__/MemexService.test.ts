import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { MemexService } from '../MemexService';
import { buildMemexHome, ensureHome, type MemexHome } from '../memexHome';

// Exercises the native facade end-to-end through the vendored memex commands
// against a real on-disk temp home — no mocks, so it also guards the vendor
// integration (frontmatter, link resolution, archive moves).

let userData: string;
let home: MemexHome;
let svc: MemexService;

beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), 'memex-svc-'));
  home = buildMemexHome(userData, 'alice', 'agent-1');
  await ensureHome(home);
  svc = new MemexService();
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('MemexService retro + read', () => {
  it('captures a memory and reads it back', async () => {
    const confirm = await svc.retro(home, { title: 'First Note', body: 'Hello world.' });
    expect(confirm).toContain('Saved card');

    const summaries = await svc.listCards(home);
    expect(summaries).toHaveLength(1);
    const slug = summaries[0].slug;
    expect(summaries[0].title).toBe('First Note');

    const raw = await svc.read(home, slug);
    expect(raw).toContain('Hello world.');
    expect(raw).toContain('title: First Note');
  });

  describe('MemexService capture', () => {
    async function createKnowledgeSource(): Promise<{ kbRoot: string; sourcePath: string }> {
      const kbRoot = path.join(userData, 'kb');
      await mkdir(kbRoot, { recursive: true });
      const sourcePath = path.join(kbRoot, 'decision.md');
      await writeFile(sourcePath, '# Decision\n\nUse the local Memex capture pipeline.', 'utf8');
      return { kbRoot, sourcePath };
    }

    async function createChatSessionSource(): Promise<{ chatSessionFilePath: string; chatSessionId: string }> {
      const chatSessionId = 'chatSession_20260707120000_device_random';
      const chatSessionFilePath = path.join(userData, `${chatSessionId}.json`);
      await writeFile(chatSessionFilePath, JSON.stringify({
        chatSession_id: chatSessionId,
        chat_history: [
          {
            id: 'user-1',
            role: 'user',
            timestamp: Date.now(),
            content: [{ type: 'text', text: 'Remember that I prefer concise answers.' }],
          },
        ],
        context_history: [],
      }), 'utf8');
      return { chatSessionFilePath, chatSessionId };
    }

    it('remember creates an active card with validated provenance from a knowledge file', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();

      const result = await svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Capture Pipeline Decision',
        body: 'Use the explicit Manage-Memory capture operation for durable memory.',
        category: 'decision',
        tags: ['memory', 'capture'],
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
        sourceAgentId: 'agent-1',
        sourceAgentName: 'Helper',
      });

      expect(result).toMatchObject({
        status: 'created',
        changed: true,
        metadata: { writeSucceeded: true, slug: 'capture-pipeline-decision' },
      });

      const detail = await svc.readCardStructured(home, 'capture-pipeline-decision');
      expect(detail.title).toBe('Capture Pipeline Decision');
      expect(detail.status).toBe('active');
      expect(detail.category).toBe('decision');
      expect(detail.tags).toEqual(['memory', 'capture']);
      expect(detail.source).toBe(await realpath(sourcePath));
      expect(detail.rawContent).toContain('source_type: knowledge-file');
      expect(detail.rawContent).toContain('provenance: validated');
      expect(detail.rawContent).toContain('capture_validation: memex-capture-v1');
      expect(detail.rawContent).toContain('source_agent_id: agent-1');
    });

    it('defaults capture mode to remember and accepts an explicit flat slug', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();

      const result = await svc.capture(home, {
        scope: 'current-agent',
        title: 'Explicit Slug Title',
        slug: 'explicit-slug',
        body: 'Captured with the default mode.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
      });

      expect(result.status).toBe('created');
      await expect(svc.capture(home, {
        scope: 'current-agent',
        title: 'Nested Slug Title',
        slug: 'nested/slug',
        body: 'Invalid slug.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
      })).rejects.toThrow(/nested paths/);
    });

    it('remember supports chat-session provenance, related slugs, and idempotent retry', async () => {
      const { chatSessionFilePath, chatSessionId } = await createChatSessionSource();
      const input = {
        scope: 'profile-memory' as const,
        mode: 'remember',
        title: 'Concise Answer Preference',
        body: 'The user prefers concise answers.',
        category: 'preference',
        tags: ['preference', 'preference', 'style'],
        related_slugs: ['stable-memory', 'stable-memory'],
        source_type: 'chat-session',
        source_anchor: 'message:user:latest',
        profile_intent_quote: 'I prefer concise answers',
      };
      const ctx = {
        userAlias: 'alice',
        chatId: 'chat-1',
        chatSessionId,
        chatSessionFilePath,
        currentUserMessageId: 'user-1',
        ensureChatSessionSaved: async () => ({ success: true }),
        sourceAgentId: 'agent-1',
        sourceAgentName: 'Helper',
      };

      const first = await svc.capture(home, input, ctx);
      const second = await svc.capture(home, input, ctx);

      expect(first.status).toBe('created');
      expect(second).toMatchObject({ status: 'already-captured', changed: false });
      const raw = await svc.read(home, 'concise-answer-preference');
      expect(raw).toContain("source_anchor: 'message:user:user-1'");
      expect(raw).toContain('source_anchor_validation: validated');
      expect(raw).toContain('source_relpath: chat-1/202607/chatSession_20260707120000_device_random.json');
      expect(raw).toContain("tags: 'preference, style'");
      expect(raw).toContain('Related: [[stable-memory]]');
    });

    it('rejects duplicate remember with different evidence or body', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      const base = {
        scope: 'current-agent' as const,
        mode: 'remember',
        title: 'Duplicate Memory',
        body: 'Original fact.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      };
      const ctx = { userAlias: 'alice', chatId: 'chat-1', knowledgeBasePath: kbRoot };

      await svc.capture(home, base, ctx);

      await expect(svc.capture(home, {
        ...base,
        body: 'Different fact.',
      }, ctx)).rejects.toThrow(/Card already exists/);

      await expect(svc.capture(home, {
        ...base,
        slug: 'different-slug',
        body: 'Different slug but same title.',
      }, ctx)).rejects.toThrow(/Card title already exists/);
    });

    it('update appends a deterministic Updates entry without rewriting the original body', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();

      await svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Stable Memory',
        body: 'Original durable fact.',
        category: 'project-context',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
        sourceAgentId: 'agent-1',
      });

      const update = await svc.capture(home, {
        scope: 'current-agent',
        mode: 'update',
        slug: 'stable-memory',
        body: 'New durable detail.',
        category: 'project-context',
        source_type: 'knowledge-file',
        source: '@knowledge-base:decision.md',
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
        sourceAgentId: 'agent-1',
      });

      expect(update.status).toBe('updated');
      const raw = await svc.read(home, 'stable-memory');
      expect(raw).toContain('Original durable fact.');
      expect(raw).toContain('## Updates');
      expect(raw).toContain('New durable detail. Source:');
      expect(raw).toContain('<!-- capture-key:');
    });

    it('serializes concurrent update captures so no append is lost', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      const ctx = {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
        sourceAgentId: 'agent-1',
      };

      await svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Concurrent Target',
        body: 'Base fact.',
        category: 'project-context',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, ctx);

      await Promise.all(Array.from({ length: 8 }, (_, index) => svc.capture(home, {
        scope: 'current-agent',
        mode: 'update',
        slug: 'concurrent-target',
        body: `Concurrent detail ${index}.`,
        category: 'project-context',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, ctx)));

      const raw = await svc.read(home, 'concurrent-target');
      for (let index = 0; index < 8; index += 1) {
        expect(raw).toContain(`Concurrent detail ${index}.`);
      }
    });

    it('serializes concurrent remember captures so duplicate titles cannot fork memory', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      const ctx = { userAlias: 'alice', chatId: 'chat-1', knowledgeBasePath: kbRoot };
      const attempts = await Promise.allSettled([
        svc.capture(home, {
          scope: 'current-agent',
          mode: 'remember',
          slug: 'title-race-a',
          title: 'Title Race',
          body: 'First body.',
          category: 'decision',
          source_type: 'knowledge-file',
          source: sourcePath,
        }, ctx),
        svc.capture(home, {
          scope: 'current-agent',
          mode: 'remember',
          slug: 'title-race-b',
          title: 'Title Race',
          body: 'Second body.',
          category: 'decision',
          source_type: 'knowledge-file',
          source: sourcePath,
        }, ctx),
      ]);

      expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await svc.searchCards(home, 'Title Race')).map((card) => card.slug)).toHaveLength(1);
    });

    it('revalidates capture source evidence after waiting behind a queued mutation', async () => {
      const { chatSessionFilePath, chatSessionId } = await createChatSessionSource();
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      let markSaveStarted!: () => void;
      let releaseSave!: () => void;
      const saveStarted = new Promise<void>((resolve) => {
        markSaveStarted = resolve;
      });
      const releaseSavePromise = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });

      const queuedFirst = svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Queue Holder',
        body: 'This capture holds the per-home mutation queue.',
        category: 'decision',
        source_type: 'chat-session',
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        chatSessionId,
        chatSessionFilePath,
        currentUserMessageId: 'user-1',
        ensureChatSessionSaved: async () => {
          markSaveStarted();
          await releaseSavePromise;
        },
      });
      await saveStarted;

      const queuedSecond = svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Stale Evidence',
        body: 'This must not be captured after its source disappears.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );

      await rm(sourcePath);
      releaseSave();
      await expect(queuedFirst).resolves.toMatchObject({ status: 'created' });
      const secondError = await queuedSecond;
      expect(secondError).toBeInstanceOf(Error);
      expect((secondError as Error).message).toMatch(/ENOENT|no such file/i);
      await expect(svc.read(home, 'stale-evidence')).rejects.toThrow(/Card not found/);
    });

    it('correct appends by title, rejects duplicate title targets, and is idempotent', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      const ctx = { userAlias: 'alice', chatId: 'chat-1', knowledgeBasePath: kbRoot };
      await svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Correction Target',
        body: 'Old fact.',
        category: 'project-context',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, ctx);

      const correctionInput = {
        scope: 'current-agent' as const,
        mode: 'correct',
        title: 'Correction Target',
        body: 'Corrected fact.',
        category: 'project-context',
        source_type: 'knowledge-file',
        source: sourcePath,
      };
      const first = await svc.capture(home, correctionInput, ctx);
      const second = await svc.capture(home, correctionInput, ctx);

      expect(first.status).toBe('corrected');
      expect(second.status).toBe('already-captured');
      expect(await svc.read(home, 'correction-target')).toContain('## Corrections');

      await svc.retro(home, { slug: 'duplicate-title', title: 'Correction Target', body: 'same title' });
      await expect(svc.capture(home, {
        ...correctionInput,
        body: 'Another correction.',
      }, ctx)).rejects.toThrow(/Multiple cards matched title/);
    });

    it('append fills missing frontmatter fields and includes chat-session source anchors', async () => {
      const { chatSessionFilePath, chatSessionId } = await createChatSessionSource();
      await writeFile(path.join(home.cardsDir, 'bare-card.md'), 'Bare body.', 'utf8');

      const result = await svc.capture(home, {
        scope: 'current-agent',
        mode: 'update',
        slug: 'bare-card',
        body: 'Anchored update.',
        category: 'decision',
        source_type: 'chat-session',
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        chatSessionId,
        chatSessionFilePath,
        currentUserMessageId: 'user-1',
        ensureChatSessionSaved: async () => undefined,
      });

      expect(result.status).toBe('updated');
      const raw = await svc.read(home, 'bare-card');
      expect(raw).toContain('title: bare-card');
      expect(raw).toContain('source: ');
      expect(raw).toContain('(message:user:user-1)');
      expect(raw).toContain('category: decision');
    });

    it('rejects invalid capture modes, fields, tags, related slugs, and missing targets', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      const ctx = { userAlias: 'alice', chatId: 'chat-1', knowledgeBasePath: kbRoot };
      const base = {
        scope: 'current-agent' as const,
        mode: 'remember',
        title: 'Validation Target',
        body: 'Valid body.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      };

      await expect(svc.capture(home, { ...base, mode: 'merge' }, ctx)).rejects.toThrow(/capture mode/);
      await expect(svc.capture(home, { ...base, title: '   ' }, ctx)).rejects.toThrow(/requires title/);
      await expect(svc.capture(home, { ...base, title: 'x'.repeat(200) }, ctx)).rejects.toThrow(/title exceeds/);
      await expect(svc.capture(home, { ...base, body: '<!-- capture-key:bad -->' }, ctx)).rejects.toThrow(/capture-key/);
      await expect(svc.capture(home, { ...base, body: 'Use [[raw-link]]' }, ctx)).rejects.toThrow(/raw wikilinks/);
      await expect(svc.capture(home, { ...base, body: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456' }, ctx)).rejects.toThrow(/Sensitive input rejected/);
      await expect(svc.capture(home, { ...base, tags: Array.from({ length: 17 }, (_, i) => `tag-${i}`) }, ctx)).rejects.toThrow(/tags exceeds/);
      await expect(svc.capture(home, { ...base, related_slugs: ['nested/path'] }, ctx)).rejects.toThrow(/nested paths/);
      await expect(svc.capture(home, { ...base, mode: 'update', slug: 'missing-card' }, ctx)).rejects.toThrow(/Card not found/);
      await expect(svc.capture(home, { ...base, mode: 'update', title: 'Missing Title' }, ctx)).rejects.toThrow(/No card matched title/);
      await expect(svc.capture(home, { ...base, mode: 'update', related_slugs: ['some-card'] }, ctx)).rejects.toThrow(/related_slugs/);
    });

    it('rejects appends to malformed or inactive target cards and honors abort before write', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();
      const ctx = { userAlias: 'alice', chatId: 'chat-1', knowledgeBasePath: kbRoot };
      await writeFile(path.join(home.cardsDir, 'bad-frontmatter.md'), '---\n: bad\n---\nbody', 'utf8');
      await svc.write(home, 'resolved-target', [
        '---',
        'title: Resolved Target',
        'created: 2024-01-01',
        'source: test',
        'status: Resolved',
        '---',
        'old',
      ].join('\n'));

      await expect(svc.capture(home, {
        scope: 'current-agent',
        mode: 'update',
        slug: 'bad-frontmatter',
        body: 'New detail.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, ctx)).rejects.toThrow(/malformed frontmatter/);

      await expect(svc.capture(home, {
        scope: 'current-agent',
        mode: 'update',
        slug: 'resolved-target',
        body: 'New detail.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, ctx)).rejects.toThrow(/capture append is not allowed/);

      const abortController = new AbortController();
      abortController.abort();
      await expect(svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Abort Target',
        body: 'Should not write.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        ...ctx,
        abortSignal: abortController.signal,
      })).rejects.toThrow();
    });

    it('rejects capture from sub-agent context while read paths remain unaffected', async () => {
      const { kbRoot, sourcePath } = await createKnowledgeSource();

      await expect(svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Blocked Subagent Write',
        body: 'Sub-agents should not write memory.',
        category: 'constraint',
        source_type: 'knowledge-file',
        source: sourcePath,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
        isSubAgent: true,
      })).rejects.toThrow(/Sub-agents/);

      await expect(svc.recall(home)).resolves.toMatch(/No cards yet|Use the `capture` operation/);
    });

    it('rejects file-backed sources outside the configured knowledge root', async () => {
      const { kbRoot } = await createKnowledgeSource();
      const outside = path.join(userData, 'outside.md');
      await writeFile(outside, 'outside', 'utf8');

      await expect(svc.capture(home, {
        scope: 'current-agent',
        mode: 'remember',
        title: 'Outside Source',
        body: 'This source is outside the root.',
        category: 'decision',
        source_type: 'knowledge-file',
        source: outside,
      }, {
        userAlias: 'alice',
        chatId: 'chat-1',
        knowledgeBasePath: kbRoot,
        sourceAgentId: 'agent-1',
      })).rejects.toThrow(/under its configured root/);
    });
  });

  it('derives a slug from the title when none is given', async () => {
    await svc.retro(home, { title: 'My Great Idea', body: 'x' });
    const summaries = await svc.listCards(home);
    expect(summaries[0].slug).toBe('my-great-idea');
  });

  it('stores category and tags in frontmatter', async () => {
    await svc.retro(home, {
      title: 'Tagged',
      body: 'body',
      category: 'work',
      tags: ['alpha', 'beta'],
    });
    const summaries = await svc.listCards(home);
    const detail = await svc.readCardStructured(home, summaries[0].slug);
    expect(detail.category).toBe('work');
    expect(detail.tags).toEqual(['alpha', 'beta']);
  });

  it('throws when retro has no title', async () => {
    await expect(svc.retro(home, { title: '', body: 'x' })).rejects.toThrow(/title/);
  });

  it('throws when reading a non-existent card', async () => {
    await expect(svc.read(home, 'does-not-exist')).rejects.toThrow(/not found|Card not found/i);
  });

  it('throws when read is given an empty slug', async () => {
    await expect(svc.read(home, '  ')).rejects.toThrow(/read requires a slug/);
  });

  it('rejects direct reads of inactive cards and warns for conflict cards', async () => {
    await svc.write(home, 'resolved-read', [
      '---',
      'title: Resolved Read',
      'created: 2024-01-01',
      'source: test',
      'status: resolved',
      '---',
      'stale read',
    ].join('\n'));
    await svc.write(home, 'conflict-read', [
      '---',
      'title: Conflict Read',
      'created: 2024-01-01',
      'source: test',
      'status: conflict',
      '---',
      'disputed read',
    ].join('\n'));

    await expect(svc.read(home, 'resolved-read')).rejects.toThrow(/inactive memory/);
    await expect(svc.read(home, 'conflict-read')).resolves.toMatch(/marked conflict/i);
  });
});

describe('MemexService listCards + searchCards', () => {
  beforeEach(async () => {
    await svc.retro(home, { title: 'Apple Pie', body: 'A dessert recipe.', category: 'food' });
    await svc.retro(home, { title: 'Banana Bread', body: 'Another baked good.', category: 'food' });
    await svc.retro(home, { title: 'Rocket Science', body: 'Orbital mechanics.', category: 'physics' });
  });

  it('lists every card as a summary', async () => {
    const summaries = await svc.listCards(home);
    expect(summaries.map((s) => s.slug).sort()).toEqual(
      ['apple-pie', 'banana-bread', 'rocket-science'],
    );
    for (const s of summaries) {
      expect(s.excerpt.length).toBeGreaterThan(0);
    }
  });

  it('filters by every whitespace-separated token (AND semantics)', async () => {
    const results = await svc.searchCards(home, 'baked good');
    expect(results.map((r) => r.slug)).toEqual(['banana-bread']);
  });

  it('matches against the category field', async () => {
    const results = await svc.searchCards(home, 'physics');
    expect(results.map((r) => r.slug)).toEqual(['rocket-science']);
  });

  it('returns all cards for an empty query', async () => {
    const results = await svc.searchCards(home, '   ');
    expect(results).toHaveLength(3);
  });

  it('respects the limit argument', async () => {
    const results = await svc.searchCards(home, '', 2);
    expect(results).toHaveLength(2);
  });

  it('returns an empty array when nothing matches', async () => {
    const results = await svc.searchCards(home, 'nonexistent-keyword');
    expect(results).toEqual([]);
  });

  it('filters inactive cards from structured list and search results', async () => {
    await svc.write(home, 'resolved-note', [
      '---',
      'title: Resolved Note',
      'created: 2024-01-01',
      'source: test',
      'status: resolved',
      '---',
      'stale keyword',
    ].join('\n'));
    await svc.write(home, 'active-note', [
      '---',
      'title: Active Note',
      'created: 2024-01-02',
      'source: test',
      'status: active',
      '---',
      'fresh keyword',
    ].join('\n'));

    expect((await svc.listCards(home)).map((card) => card.slug)).not.toContain('resolved-note');
    expect((await svc.searchCards(home, 'keyword')).map((card) => card.slug)).toEqual(['active-note']);
  });

  it('excludes malformed-frontmatter cards from list, sidepane search, recall, and agent search', async () => {
    await writeFile(path.join(home.cardsDir, 'malformed-note.md'), [
      '---',
      ': bad',
      '---',
      'corrupt keyword',
    ].join('\n'), 'utf8');

    expect((await svc.listCards(home)).map((card) => card.slug)).not.toContain('malformed-note');
    expect((await svc.searchCards(home, 'corrupt')).map((card) => card.slug)).not.toContain('malformed-note');
    expect(await svc.recall(home, 'corrupt')).toMatch(/No cards matched/);
    expect(await svc.search(home, 'corrupt')).toMatch(/No cards matched/);
  });

  it('keeps conflict cards visible with a warning', async () => {
    await svc.write(home, 'conflict-note', [
      '---',
      'title: Conflict Note',
      'created: 2024-01-01',
      'source: test',
      'status: conflict',
      '---',
      'needs review',
    ].join('\n'));

    const summary = (await svc.listCards(home)).find((card) => card.slug === 'conflict-note');
    expect(summary?.status).toBe('conflict');
    expect(summary?.warning).toMatch(/marked conflict/i);
  });

  it('applies manifest filters before listing current cards', async () => {
    await svc.write(home, 'tagged-by-author', [
      '---',
      'title: Tagged By Author',
      'created: 2024-01-01',
      'modified: 2024-01-05',
      'source: Casey',
      'category: decision',
      'tags: alpha, beta',
      '---',
      'filterable body',
    ].join('\n'));

    expect(await svc.recall(home, undefined, 10, { category: 'decision' })).toContain('tagged-by-author');
    expect(await svc.recall(home, undefined, 10, { category: 'missing' })).toMatch(/No cards yet/);
    expect(await svc.recall(home, undefined, 10, { tag: 'beta' })).toContain('tagged-by-author');
    expect(await svc.recall(home, undefined, 10, { tag: 'gamma' })).toMatch(/No cards yet/);
    expect(await svc.recall(home, undefined, 10, { author: 'casey' })).toContain('tagged-by-author');
    expect(await svc.recall(home, undefined, 10, { author: 'other' })).toMatch(/No cards yet/);
    expect(await svc.recall(home, undefined, 10, { since: '2024-01-04' })).toContain('tagged-by-author');
    expect(await svc.recall(home, undefined, 10, { since: '2030-01-01' })).toMatch(/No cards yet/);
    expect(await svc.recall(home, undefined, 10, { before: '2024-01-02' })).toContain('tagged-by-author');
    expect(await svc.recall(home, undefined, 10, { before: '2020-01-01' })).toMatch(/No cards yet/);
  });

  it('recall without a query honors limits and conflict titles', async () => {
    await svc.write(home, 'conflict-list', [
      '---',
      'title: Conflict List',
      'created: 2030-01-01',
      'source: test',
      'status: conflict',
      '---',
      'visible conflict',
    ].join('\n'));

    expect(await svc.recall(home, undefined, 1)).toContain('1 of 4 active cards shown');
    expect(await svc.recall(home, undefined, 0)).toMatch(/No active cards matched/);
    expect(await svc.recall(home, undefined, -1)).toContain('Conflict List [CONFLICT - verify before relying]');
  });

  it('recall without a query uses defaults and falls back to slug for missing titles', async () => {
    await writeFile(path.join(home.cardsDir, 'untitled-card.md'), [
      '---',
      'created: 2031-01-01',
      'source: test',
      '---',
      'untitled body',
    ].join('\n'), 'utf8');

    const out = await svc.recall(home);

    expect(out).toContain('untitled-card');
  });
});

describe('MemexService links + graph', () => {
  beforeEach(async () => {
    // hub <- a, b ; c is an orphan with no inbound
    await svc.retro(home, { slug: 'hub', title: 'Hub', body: 'Central node.' });
    await svc.retro(home, { slug: 'a', title: 'A', body: 'See [[hub]].' });
    await svc.retro(home, { slug: 'b', title: 'B', body: 'Also [[hub]].' });
    await svc.retro(home, { slug: 'c', title: 'C', body: 'Standalone, links nothing known.' });
  });

  it('resolves inbound and outbound links in readCardStructured', async () => {
    const hub = await svc.readCardStructured(home, 'hub');
    expect(hub.inbound.sort()).toEqual(['a', 'b']);

    const a = await svc.readCardStructured(home, 'a');
    expect(a.outbound).toContain('hub');
  });

  it('filters detail outbound links to resolved known card slugs', async () => {
    await svc.retro(home, {
      slug: 'casey',
      title: 'Casey',
      body: 'Canonical target.',
    });
    await svc.retro(home, {
      slug: 'linker',
      title: 'Linker',
      body: 'Known with different case: [[Casey]]. Dangling: [[ghost-card]].',
    });

    const detail = await svc.readCardStructured(home, 'linker');

    expect(detail.outbound).toEqual(['casey']);
    expect(detail.resolvedWikilinks).toEqual({ Casey: 'casey' });
    expect(detail.outbound).not.toContain('ghost-card');
  });

  it('exposes resolved wikilink targets for renderer navigation', async () => {
    await svc.retro(home, {
      slug: 'target-card',
      title: 'Target Card',
      body: 'Canonical target.',
    });
    await svc.retro(home, {
      slug: 'linker',
      title: 'Linker',
      body: 'Alias link: [[target-card|the target]].',
    });

    const detail = await svc.readCardStructured(home, 'linker');

    expect(detail.outbound).toEqual(['target-card']);
    expect(detail.resolvedWikilinks).toEqual({ 'target-card': 'target-card' });
  });

  it('builds a graph with edges, orphans, and node link counts', async () => {
    const graph = await svc.getGraph(home);
    expect(graph.nodes).toHaveLength(4);

    const hubNode = graph.nodes.find((n) => n.slug === 'hub')!;
    expect(hubNode.inbound).toBe(2);
    expect(hubNode.isOrphan).toBe(false);

    // a, b, c have no inbound links → orphans
    expect(graph.orphans.sort()).toEqual(['a', 'b', 'c']);

    const edgePairs = graph.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgePairs).toEqual(['a->hub', 'b->hub']);
  });

  it('reports aggregate link stats when no slug is given', async () => {
    const out = await svc.links(home);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('throws when links is requested for a missing card slug', async () => {
    await expect(svc.links(home, 'missing-card')).rejects.toThrow(/Card not found: missing-card/);
  });
});

describe('MemexService archive', () => {
  it('soft-deletes a card so it no longer lists', async () => {
    await svc.retro(home, { slug: 'temp', title: 'Temp', body: 'short-lived' });
    expect((await svc.listCards(home)).map((s) => s.slug)).toContain('temp');

    const msg = await svc.archive(home, 'temp');
    expect(msg).toContain('temp');
    expect((await svc.listCards(home)).map((s) => s.slug)).not.toContain('temp');
  });

  it('throws when archiving an empty slug', async () => {
    await expect(svc.archive(home, '')).rejects.toThrow(/archive requires a slug/);
  });
});

describe('MemexService delete', () => {
  it('permanently deletes an active card', async () => {
    await svc.retro(home, { slug: 'doomed', title: 'Doomed', body: 'remove me' });
    expect((await svc.listCards(home)).map((s) => s.slug)).toContain('doomed');

    const msg = await svc.delete(home, 'doomed');
    expect(msg).toBe('Deleted card: doomed');
    expect((await svc.listCards(home)).map((s) => s.slug)).not.toContain('doomed');
    await expect(svc.read(home, 'doomed')).rejects.toThrow(/Card not found/i);
  });

  it('throws when deleting an empty slug or missing card', async () => {
    await expect(svc.delete(home, '')).rejects.toThrow(/delete requires a slug/);
    await expect(svc.delete(home, 'never-existed')).rejects.toThrow(/Card not found: never-existed/);
  });
});

describe('MemexService recall + search guards', () => {
  it('recall on an empty store returns a helpful hint', async () => {
    const out = await svc.recall(home);
    expect(out).toMatch(/No cards yet/i);
  });

  it('search requires a non-empty query', async () => {
    await expect(svc.search(home, '   ')).rejects.toThrow(/non-empty query/);
  });

  it('organize on an empty store does not throw', async () => {
    const out = await svc.organize(home);
    expect(typeof out).toBe('string');
  });
});

describe('MemexService recall/search with a query (keyword path)', () => {
  beforeEach(async () => {
    await svc.retro(home, { title: 'Coffee Brewing', body: 'Pour-over technique notes.', category: 'food' });
    await svc.retro(home, { title: 'Tea Steeping', body: 'Green tea timing.', category: 'food' });
  });

  describe('MemexService reads against a missing home', () => {
    beforeEach(async () => {
      await rm(home.root, { recursive: true, force: true });
    });

    it('returns empty structured read results without creating directories', async () => {
      expect(await svc.listCards(home)).toEqual([]);
      expect(await svc.searchCards(home, '')).toEqual([]);
      expect(await svc.getGraph(home)).toEqual({ nodes: [], edges: [], orphans: [], hubs: [] });
      await expect(svc.readCardStructured(home, 'missing')).rejects.toThrow(/Card not found/i);
      await expect(access(home.cardsDir)).rejects.toThrow();
    });

    it('returns helpful text for read-only tool operations without creating directories', async () => {
      await expect(svc.recall(home)).resolves.toMatch(/No cards yet/i);
      await expect(svc.search(home, 'anything')).resolves.toMatch(/No cards matched/i);
      await expect(svc.links(home)).resolves.toBe('No cards yet.');
      await expect(svc.organize(home)).resolves.toBe('No cards yet.');
      await expect(access(home.cardsDir)).rejects.toThrow();
    });
  });

  it('recall WITH a query routes through keyword search and returns matches', async () => {
    const out = await svc.recall(home, 'coffee');
    expect(typeof out).toBe('string');
    expect(out.toLowerCase()).toContain('coffee');
  });

  it('recall with a query that matches nothing returns the "No cards matched" message', async () => {
    const out = await svc.recall(home, 'zzz-no-such-token');
    expect(out).toMatch(/No cards matched/i);
  });

  it('search returns formatted output for a matching query', async () => {
    const out = await svc.search(home, 'tea');
    expect(out.toLowerCase()).toContain('tea');
  });

  it('search handles negative and zero limits plus later-paragraph matches', async () => {
    await svc.write(home, 'later-match', [
      '---',
      'title: Later Match',
      'created: 2030-01-01',
      'source: test',
      '---',
      'Opening paragraph.',
      '',
      'Second paragraph mentions espresso.',
    ].join('\n'));

    expect(await svc.search(home, 'espresso', -1)).toContain('> Match: Second paragraph mentions espresso.');
    expect(await svc.search(home, 'espresso', 0)).toMatch(/No cards matched/);
  });

  it('search returns title and slug fallbacks for empty-body metadata matches', async () => {
    await writeFile(path.join(home.cardsDir, 'slug-only-match.md'), [
      '---',
      'created: 2030-01-01',
      'source: test',
      '---',
      '',
    ].join('\n'), 'utf8');

    const out = await svc.search(home, 'slug-only-match');

    expect(out).toContain('## slug-only-match');
    expect(out).toContain('slug-only-match');
    expect(out).toContain('> Matched: slug:slug, slug:only, slug:match');
  });

  it('search returns the "No cards matched" message when nothing matches', async () => {
    const out = await svc.search(home, 'zzz-no-such-token');
    expect(out).toMatch(/No cards matched/i);
  });

  it('recall and search exclude inactive active-dir cards', async () => {
    await svc.write(home, 'resolved-coffee', [
      '---',
      'title: Resolved Coffee',
      'created: 2024-01-03',
      'source: test',
      'status: resolved',
      '---',
      'coffee stale',
    ].join('\n'));

    const recallOut = await svc.recall(home, 'coffee');
    const searchOut = await svc.search(home, 'coffee');

    expect(recallOut).toMatch(/Coffee Brewing/i);
    expect(searchOut).toMatch(/Coffee Brewing/i);
    expect(recallOut).not.toMatch(/Resolved Coffee/i);
    expect(searchOut).not.toMatch(/Resolved Coffee/i);
  });

  it('recall and search include conflict cards with a warning', async () => {
    await svc.write(home, 'conflict-tea', [
      '---',
      'title: Conflict Tea',
      'created: 2024-01-04',
      'source: test',
      'status: conflict',
      '---',
      'tea disputed',
    ].join('\n'));

    const out = await svc.search(home, 'disputed');

    expect(out).toMatch(/Conflict Tea \[CONFLICT - verify before relying\]/);
    expect(out).toMatch(/marked conflict/i);
  });

  it('recall throws when a sensitive query is rejected by the search command', async () => {
    await expect(svc.recall(home, 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456')).rejects.toThrow(/Sensitive input rejected/i);
  });

  it('search throws when a sensitive query is rejected by the search command', async () => {
    await expect(svc.search(home, 'https://user:secret@example.com')).rejects.toThrow(/Sensitive input rejected/i);
  });
});

describe('MemexService write (raw frontmatter path)', () => {
  it('throws when write is given an empty slug', async () => {
    await expect(svc.write(home, '  ', 'whatever')).rejects.toThrow(/write requires a slug/);
  });

  it('writes a raw card and reads it back', async () => {
    const raw = [
      '---',
      'title: Raw Power User Card',
      'created: 2026-06-01',
      'source: importer',
      '---',
      'Raw body content.',
    ].join('\n');
    const confirm = await svc.write(home, 'raw-card', raw);
    expect(confirm).toContain('Saved card: raw-card');

    const back = await svc.read(home, 'raw-card');
    expect(back).toContain('Raw body content.');
  });
});

describe('MemexService archive failure', () => {
  it('throws when archiving a slug that does not exist', async () => {
    await expect(svc.archive(home, 'never-existed')).rejects.toThrow(/Failed to archive|not found/i);
  });
});

describe('MemexService structured reads — optional fields and YAML-typed values', () => {
  // A raw card whose frontmatter uses UNQUOTED ISO dates (js-yaml parses these
  // into JS Date objects, exercising toDateString's Date branch) and a YAML
  // list for tags (exercising parseTags' Array branch), plus category/status/
  // source so the optionalString branches are taken.
  beforeEach(async () => {
    const raw = [
      '---',
      'title: Fully Annotated Card',
      'created: 2026-06-01',
      'modified: 2026-06-02',
      'source: importer',
      'category: research',
      'status: draft',
      'tags:',
      '  - alpha',
      '  - beta',
      '---',
      'Annotated body.',
    ].join('\n');
    await svc.write(home, 'annotated', raw);
  });

  it('readCardStructured surfaces category, status, source, tags, and dates', async () => {
    const detail = await svc.readCardStructured(home, 'annotated');
    expect(detail.category).toBe('research');
    expect(detail.status).toBe('draft');
    expect(detail.source).toBe('importer');
    expect(detail.tags).toEqual(['alpha', 'beta']);
    // Unquoted YAML `created` round-trips through Date → 'YYYY-MM-DD'. writeCommand
    // always stamps `modified` to today, so it is a well-formed date string too.
    expect(detail.created).toBe('2026-06-01');
    expect(detail.modified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.rawContent).toContain('title: Fully Annotated Card');
    expect(detail.rawContent).toContain('Annotated body.');
  });

  it('listCards reflects the YAML-typed date and category for the raw card', async () => {
    const summaries = await svc.listCards(home);
    const card = summaries.find((s) => s.slug === 'annotated')!;
    expect(card.category).toBe('research');
    expect(card.modified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('searchCards matches against YAML-list tags (array tag branch)', async () => {
    const results = await svc.searchCards(home, 'alpha');
    expect(results.map((r) => r.slug)).toContain('annotated');
  });
});

describe('MemexService structured reads — absent optional fields (|| undefined fallbacks)', () => {
  // A card carrying ONLY a title exercises every "optional field is missing"
  // fallback branch in listCards/searchCards/readCardStructured: no category, no
  // created/modified, no tags, no status, and an empty body (buildExcerpt → '').
  // We write the .md file DIRECTLY (bypassing writeCommand, which would stamp
  // `modified` to today and require created/source), so the fields stay absent.
  beforeEach(async () => {
    const raw = ['---', 'title: Bare Minimum', '---', ''].join('\n');
    await writeFile(path.join(home.cardsDir, 'bare-minimum.md'), raw, 'utf8');
  });

  it('listCards leaves absent optional fields undefined', async () => {
    const card = (await svc.listCards(home)).find((s) => s.slug === 'bare-minimum')!;
    expect(card.category).toBeUndefined();
    expect(card.created).toBeUndefined();
    expect(card.modified).toBeUndefined();
    expect(card.excerpt).toBe('');
  });

  it('readCardStructured leaves absent optional fields undefined', async () => {
    const detail = await svc.readCardStructured(home, 'bare-minimum');
    expect(detail.category).toBeUndefined();
    expect(detail.status).toBeUndefined();
    expect(detail.tags).toBeUndefined();
    expect(detail.created).toBeUndefined();
    expect(detail.modified).toBeUndefined();
  });

  it('searchCards returns the bare card and matches by title only', async () => {
    const results = await svc.searchCards(home, 'minimum');
    expect(results.map((r) => r.slug)).toEqual(['bare-minimum']);
  });
});

describe('MemexService helper branches via raw cards', () => {
  it('toDateString keeps a non-Date string date as-is (quoted YAML string)', async () => {
    const raw = [
      '---',
      'title: Quoted Date Card',
      'created: "free-form-date"',
      'source: importer',
      '---',
      'body',
    ].join('\n');
    await svc.write(home, 'quoted-date', raw);
    const detail = await svc.readCardStructured(home, 'quoted-date');
    // String value is sliced to 10 chars rather than parsed as a Date.
    expect(detail.created).toBe('free-form-');
  });

  it('toDateString returns empty for a non-string, non-Date created value (numeric)', async () => {
    const raw = [
      '---',
      'title: Numeric Date Card',
      'created: 20260601',
      'source: importer',
      '---',
      'body',
    ].join('\n');
    await svc.write(home, 'numeric-date', raw);
    const card = (await svc.listCards(home)).find((s) => s.slug === 'numeric-date')!;
    // A number is neither Date nor string → toDateString('') → undefined summary.
    expect(card.created).toBeUndefined();
  });

  it('slugify falls back to a generated slug when the title has no alphanumerics', async () => {
    await svc.retro(home, { title: '!!!', body: 'symbols only' });
    const slugs = (await svc.listCards(home)).map((s) => s.slug);
    expect(slugs.some((s) => s.startsWith('card-'))).toBe(true);
  });

  it('parseTags accepts a comma-separated tag string (retro join → string branch)', async () => {
    await svc.retro(home, { title: 'CSV Tags', body: 'x', tags: ['one', 'two', 'three'] });
    const detail = await svc.readCardStructured(home, 'csv-tags');
    expect(detail.tags).toEqual(['one', 'two', 'three']);
  });
});

describe('MemexService write failure (missing required frontmatter field)', () => {
  it('throws when raw markdown is missing a required field', async () => {
    const raw = ['---', 'title: No Source', 'created: 2026-06-01', '---', 'body'].join('\n');
    await expect(svc.write(home, 'no-source', raw)).rejects.toThrow(/Missing required fields|source/);
  });
});

describe('MemexService links on an empty store', () => {
  it('returns the "No cards yet." hint for aggregate stats when there are no cards', async () => {
    await expect(svc.links(home)).resolves.toBe('No cards yet.');
  });

  it('throws for a specific missing card slug', async () => {
    await expect(svc.links(home, 'anything')).rejects.toThrow(/Card not found: anything/);
  });
});

describe('MemexService listCards excerpt truncation', () => {
  it('truncates a long first paragraph with an ellipsis', async () => {
    const longBody = 'word '.repeat(80).trim(); // ~400 chars, single paragraph
    await svc.retro(home, { title: 'Long Card', body: longBody });
    const summaries = await svc.listCards(home);
    const card = summaries.find((s) => s.slug === 'long-card')!;
    expect(card.excerpt.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(card.excerpt.endsWith('…')).toBe(true);
  });
});

describe('MemexService getGraph — hubs, dangling links, and duplicate edges', () => {
  it('classifies a node with many inbound links as a hub', async () => {
    await svc.retro(home, { slug: 'bighub', title: 'Big Hub', body: 'Central.' });
    for (let i = 0; i < 10; i += 1) {
      await svc.retro(home, { slug: `feeder-${i}`, title: `Feeder ${i}`, body: 'Points to [[bighub]].' });
    }
    const graph = await svc.getGraph(home);
    const hub = graph.nodes.find((n) => n.slug === 'bighub')!;
    expect(hub.inbound).toBe(10);
    expect(hub.isHub).toBe(true);
    expect(graph.hubs).toContain('bighub');
  });

  it('ignores links that do not resolve to a known card (dangling link)', async () => {
    await svc.retro(home, { slug: 'lonely', title: 'Lonely', body: 'Refers to [[ghost-card]] which does not exist.' });
    const graph = await svc.getGraph(home);
    // No edge is created for the dangling link.
    expect(graph.edges).toHaveLength(0);
    const node = graph.nodes.find((n) => n.slug === 'lonely')!;
    expect(node.outbound).toBe(0);
  });

  it('deduplicates two distinct link texts that resolve to the same target', async () => {
    // `extractLinks` already de-dups identical wikilinks via a Set, so to exercise
    // getGraph's own `seenEdges` guard we use two DISTINCT link texts that the
    // case-insensitive resolver collapses onto the same slug: `[[target]]` (exact)
    // and `[[Target]]` (case-insensitive). Both yield `target`, so the second pass
    // hits `seenEdges.has(key)` and is skipped — leaving a single edge.
    await svc.retro(home, { slug: 'target', title: 'Target', body: 'A destination.' });
    await svc.retro(home, { slug: 'dup', title: 'Dup', body: 'See [[target]] and again [[Target]].' });
    const graph = await svc.getGraph(home);
    const edgesFromDup = graph.edges.filter((e) => e.from === 'dup');
    expect(edgesFromDup).toEqual([{ from: 'dup', to: 'target' }]);
  });
});

describe('MemexService retro write-path branches', () => {
  it('falls back to empty content when body is undefined', async () => {
    // RetroInput.body is typed as a string, but a caller may pass undefined; the
    // `input.body ?? ''` guard keeps stringifyFrontmatter happy.
    const confirm = await svc.retro(home, { title: 'No Body', body: undefined as unknown as string });
    expect(confirm).toContain('Saved card');
    const detail = await svc.readCardStructured(home, 'no-body');
    expect(detail.content).toBe('');
  });

  it('rejects a body that contains a secret (writeCommand failure → throw)', async () => {
    // A fake AWS access-key id trips the vendored sensitive-input guard, so
    // writeCommand returns {success:false, error}, which retro rethrows.
    const body = 'leaked key AKIA1234567890ABCDEF in notes';
    await expect(svc.retro(home, { title: 'Sneaky', body })).rejects.toThrow(/Sensitive input rejected/i);
  });

  it('surfaces a redaction warning when the body has tokenized URL credentials', async () => {
    // A `scheme://user:pass@host` URL is masked (not rejected), and the warning is
    // threaded back through formatWriteConfirmation's warnings branch.
    const body = 'visit https://user:pass@example.com/path for details';
    const confirm = await svc.retro(home, { title: 'Has URL', body });
    expect(confirm).toContain('Saved card');
    expect(confirm).toContain('Warning:');
  });
});

describe('MemexService title fallbacks for cards with no title', () => {
  // A raw card carrying NO `title` exercises every `String(data.title || slug)`
  // fallback across listCards/searchCards/readCardStructured/getGraph. Written
  // directly so writeCommand (which requires title/created/source) is bypassed.
  beforeEach(async () => {
    const raw = ['---', 'category: misc', '---', 'searchable body content here'].join('\n');
    await writeFile(path.join(home.cardsDir, 'no-title.md'), raw, 'utf8');
  });

  it('listCards uses the slug as the title', async () => {
    const card = (await svc.listCards(home)).find((s) => s.slug === 'no-title')!;
    expect(card.title).toBe('no-title');
  });

  it('searchCards builds a haystack and falls back to the slug for the title', async () => {
    const results = await svc.searchCards(home, 'searchable');
    const card = results.find((s) => s.slug === 'no-title')!;
    expect(card.title).toBe('no-title');
  });

  it('readCardStructured falls back to the slug when title is absent', async () => {
    const detail = await svc.readCardStructured(home, 'no-title');
    expect(detail.title).toBe('no-title');
  });

  it('getGraph labels a titleless node with its slug', async () => {
    const graph = await svc.getGraph(home);
    const node = graph.nodes.find((n) => n.slug === 'no-title')!;
    expect(node.title).toBe('no-title');
  });
});

describe('MemexService searchCards null-query guard', () => {
  it('treats an undefined query as empty and returns all cards', async () => {
    await svc.retro(home, { title: 'Only Card', body: 'x' });
    const results = await svc.searchCards(home, undefined as unknown as string);
    expect(results.map((r) => r.slug)).toContain('only-card');
  });
});

describe('MemexService parseTags array + empty-after-filter branches', () => {
  it('parses a genuine YAML-list tags value (Array.isArray branch)', async () => {
    // Written directly so the YAML sequence survives as an array — writeCommand
    // would re-serialize it into a comma string, taking the other branch.
    const raw = ['---', 'title: List Tags', 'tags:', '  - red', '  - green', '---', 'body'].join('\n');
    await writeFile(path.join(home.cardsDir, 'list-tags.md'), raw, 'utf8');
    const detail = await svc.readCardStructured(home, 'list-tags');
    expect(detail.tags).toEqual(['red', 'green']);
  });

  it('returns undefined when a tags string is only separators (empty after filter)', async () => {
    const raw = ['---', 'title: Empty Tags', "tags: ', ,'", '---', 'body'].join('\n');
    await writeFile(path.join(home.cardsDir, 'empty-tags.md'), raw, 'utf8');
    const detail = await svc.readCardStructured(home, 'empty-tags');
    expect(detail.tags).toBeUndefined();
  });
});

describe('MemexService sortKey fallbacks across multiple cards', () => {
  // With ≥2 cards the list comparator actually runs, exercising sortKey's
  // `modified || created || ''` chain: one card has only `created` (modified
  // falsy → use created), the other has neither (created falsy → use '').
  beforeEach(async () => {
    const hasCreated = ['---', 'title: Has Created', 'created: 2026-06-01', '---', 'body'].join('\n');
    const hasNeither = ['---', 'title: Has Neither', '---', 'body'].join('\n');
    await writeFile(path.join(home.cardsDir, 'has-created.md'), hasCreated, 'utf8');
    await writeFile(path.join(home.cardsDir, 'has-neither.md'), hasNeither, 'utf8');
  });

  it('orders cards lacking modified/created without throwing', async () => {
    const slugs = (await svc.listCards(home)).map((s) => s.slug).sort();
    expect(slugs).toEqual(['has-created', 'has-neither']);
  });
});

describe('MemexService nested-slug rejection (flat-slug guard)', () => {
  // The store is constructed with nestedSlugs=false, so a write to a path-like
  // slug would land in a subdirectory that scanAll collapses to its basename —
  // a later read/list could not resolve it. assertFlatSlug rejects separators at
  // the facade so write/read/archive stay symmetric. Each entry point is checked
  // for both '/' and '\\' to cover both arms of the guard's OR.
  it('write rejects a forward-slash slug', async () => {
    await expect(svc.write(home, 'deep/topic/card', 'body')).rejects.toThrow(/nested paths are not supported/);
  });

  it('write rejects a back-slash slug', async () => {
    await expect(svc.write(home, 'deep\\topic', 'body')).rejects.toThrow(/nested paths are not supported/);
  });

  it('read rejects a nested slug', async () => {
    await expect(svc.read(home, 'deep/topic/card')).rejects.toThrow(/nested paths are not supported/);
  });

  it('read rejects a Windows-reserved slug', async () => {
    await expect(svc.read(home, 'bad:name')).rejects.toThrow(/reserved characters/);
  });

  it('archive rejects a nested slug', async () => {
    await expect(svc.archive(home, 'deep/topic/card')).rejects.toThrow(/nested paths are not supported/);
  });

  it('archive rejects a Windows-reserved slug', async () => {
    await expect(svc.archive(home, 'bad*name')).rejects.toThrow(/reserved characters/);
  });

  it('retro rejects an explicit nested slug', async () => {
    await expect(
      svc.retro(home, { slug: 'deep/topic/card', title: 'Deep', body: 'x' }),
    ).rejects.toThrow(/nested paths are not supported/);
  });

  it('links rejects a Windows-reserved slug', async () => {
    await expect(svc.links(home, 'bad?name')).rejects.toThrow(/reserved characters/);
  });

  it('retro accepts a title with a slash because slugify flattens it (guard false branch)', async () => {
    // slugify('A/B Note') → 'a-b-note' (no separator), so the guard passes and the
    // card is saved under the flattened slug.
    const confirm = await svc.retro(home, { title: 'A/B Note', body: 'flattened' });
    expect(confirm).toContain('Saved card');
    const slugs = (await svc.listCards(home)).map((s) => s.slug);
    expect(slugs).toContain('a-b-note');
  });
});
