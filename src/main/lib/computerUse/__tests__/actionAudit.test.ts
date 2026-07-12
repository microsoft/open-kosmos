import { describe, it, expect, vi } from 'vitest';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { ActionAudit, getActionAudit } from '../actionAudit';

describe('ActionAudit', () => {
  it('records an entry with a default timestamp', () => {
    const audit = new ActionAudit();
    const before = Date.now();
    const entry = audit.record({ action: 'click', target: '1,2', confirmed: true, chatSessionId: 's1' });
    expect(entry.action).toBe('click');
    expect(entry.target).toBe('1,2');
    expect(entry.confirmed).toBe(true);
    expect(entry.chatSessionId).toBe('s1');
    expect(entry.ts).toBeGreaterThanOrEqual(before);
  });

  it('honors an explicit timestamp', () => {
    const audit = new ActionAudit();
    const entry = audit.record({ action: 'type_text', confirmed: false, ts: 123 });
    expect(entry.ts).toBe(123);
    expect(entry.target).toBeUndefined();
  });

  it('lists all entries and filters by session', () => {
    const audit = new ActionAudit();
    audit.record({ action: 'a', confirmed: false, chatSessionId: 's1' });
    audit.record({ action: 'b', confirmed: false, chatSessionId: 's2' });
    expect(audit.list()).toHaveLength(2);
    expect(audit.list('s1')).toHaveLength(1);
    expect(audit.list('s1')[0].action).toBe('a');
  });

  it('clears all entries', () => {
    const audit = new ActionAudit();
    audit.record({ action: 'a', confirmed: false });
    audit.clear();
    expect(audit.list()).toHaveLength(0);
  });

  it('clears only a single session', () => {
    const audit = new ActionAudit();
    audit.record({ action: 'a', confirmed: false, chatSessionId: 's1' });
    audit.record({ action: 'b', confirmed: false, chatSessionId: 's2' });
    audit.clear('s1');
    expect(audit.list()).toHaveLength(1);
    expect(audit.list()[0].chatSessionId).toBe('s2');
  });

  it('caps retained entries at the ring size', () => {
    const audit = new ActionAudit();
    for (let i = 0; i < 600; i++) {
      audit.record({ action: `a${i}`, confirmed: false });
    }
    const all = audit.list();
    expect(all).toHaveLength(500);
    // oldest dropped first
    expect(all[0].action).toBe('a100');
    expect(all[all.length - 1].action).toBe('a599');
  });

  it('returns a stable process-wide singleton', () => {
    expect(getActionAudit()).toBe(getActionAudit());
  });
});
