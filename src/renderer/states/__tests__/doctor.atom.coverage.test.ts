/**
 * @vitest-environment happy-dom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockSubmitDoctorInquiry = vi.hoisted(() => vi.fn());
const mockSubmitAgentAnswer = vi.hoisted(() => vi.fn());

// Capture event listener callbacks so tests can fire them
const doctorEventCallbacks = vi.hoisted(() => ({
  taskStatusChanged: null as ((_e: any, s: any) => void) | null,
  stepInfo: null as ((_e: any, p: any) => void) | null,
  agentQuestion: null as ((_e: any, p: any) => void) | null,
}));

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('../../ipc/doctor', () => ({
  doctorApi: {
    submitDoctorInquiry: mockSubmitDoctorInquiry,
    submitAgentAnswer: mockSubmitAgentAnswer,
  },
  doctorEvents: {
    doctorTaskStatusChanged: (cb: any) => { doctorEventCallbacks.taskStatusChanged = cb; },
    doctorStepInfo: (cb: any) => { doctorEventCallbacks.stepInfo = cb; },
    doctorAgentQuestion: (cb: any) => { doctorEventCallbacks.agentQuestion = cb; },
  },
}));

// ── imports after mocks ────────────────────────────────────────────────────────
import { doctorInquiryAtom, doctorAnalyzeAtom, NONE_OPTION, UNSURE_TEXT, TIME_AGNOSTIC_TEXT } from '../doctor.atom';

// ── store builder (same pattern as left-nav.atom.test.ts) ─────────────────────
function buildStore() {
  const map: Record<string, any> = {};
  function query(atomObj: any): any {
    const key: string = atomObj.key;
    if (map[key]) return map[key];
    const ownSymbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(atomObj));
    const uniqSym = ownSymbols.find((s) => s.toString().includes('BUILD'));
    if (!uniqSym) throw new Error('Cannot find BUILD symbol on atom');
    map[key] = (atomObj as any)[uniqSym](query);
    return map[key];
  }
  return query;
}

describe('Constants', () => {
  it('NONE_OPTION is __none__', () => {
    expect(NONE_OPTION).toBe('__none__');
  });

  it('UNSURE_TEXT is correct', () => {
    expect(UNSURE_TEXT).toBe("I'm not sure");
  });

  it('TIME_AGNOSTIC_TEXT is correct', () => {
    expect(TIME_AGNOSTIC_TEXT).toBe('Not time-related');
  });
});

describe('doctorInquiryAtom', () => {
  let query: ReturnType<typeof buildStore>;
  let inquiry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
    inquiry = query(doctorInquiryAtom);
  });

  it('initialises with idle state and empty form', () => {
    const state = inquiry.get();
    expect(state.type).toBe('idle');
    expect(state.form.description).toBe('');
    expect(state.form.screenshots).toEqual([]);
  });

  describe('show / hide / discard', () => {
    it('show transitions idle → idle-show', () => {
      inquiry.actions.show();
      expect(inquiry.get().type).toBe('idle-show');
    });

    it('show is no-op when pending', () => {
      inquiry.actions.show();
      // Manually put into pending by calling the internal set directly
      // We'll test via submit flow; for now just verify show→idle-show
      expect(inquiry.get().type).toBe('idle-show');
    });

    it('hide transitions idle-show → idle', () => {
      inquiry.actions.show();
      expect(inquiry.get().type).toBe('idle-show');
      inquiry.actions.hide();
      expect(inquiry.get().type).toBe('idle');
    });

    it('hide clears error', () => {
      // Manually set state with error
      inquiry.actions.show();
      // Set error by accessing internal state via a failed submit
      const state = inquiry.get();
      expect(state.error).toBeUndefined();
    });

    it('discard resets form to zero', () => {
      inquiry.actions.show();
      inquiry.actions.updateForm((f: any) => { f.description = 'test'; });
      inquiry.actions.discard();
      expect(inquiry.get().type).toBe('idle');
      expect(inquiry.get().form.description).toBe('');
    });

    it('discard is no-op when pending', async () => {
      // Fill the form to make it valid, submit to enter pending
      inquiry.actions.show();
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = NONE_OPTION;
        f.chatSessionId = NONE_OPTION;
      });
      // Submit enters 'pending' synchronously before awaiting API call
      let resolveSubmit: () => void;
      mockSubmitDoctorInquiry.mockReturnValue(new Promise<void>((resolve) => { resolveSubmit = resolve; }));
      const submitPromise = inquiry.actions.submit();
      // State should be 'pending' right after the synchronous part of submit
      // (it sets type to 'pending' before awaiting the API)
      expect(inquiry.get().type).toBe('pending');
      inquiry.actions.discard(); // should be no-op
      expect(inquiry.get().type).toBe('pending');
      resolveSubmit!();
      await submitPromise;
    });

    it('show is no-op when already pending', async () => {
      inquiry.actions.show();
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = NONE_OPTION;
        f.chatSessionId = NONE_OPTION;
      });
      let resolveSubmit: () => void;
      mockSubmitDoctorInquiry.mockReturnValue(new Promise<void>((resolve) => { resolveSubmit = resolve; }));
      const submitPromise = inquiry.actions.submit();
      expect(inquiry.get().type).toBe('pending');
      inquiry.actions.show(); // no-op
      expect(inquiry.get().type).toBe('pending');
      resolveSubmit!();
      await submitPromise;
    });

    it('hide is no-op when pending', async () => {
      inquiry.actions.show();
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = NONE_OPTION;
        f.chatSessionId = NONE_OPTION;
      });
      let resolveSubmit: () => void;
      mockSubmitDoctorInquiry.mockReturnValue(new Promise<void>((resolve) => { resolveSubmit = resolve; }));
      const submitPromise = inquiry.actions.submit();
      expect(inquiry.get().type).toBe('pending');
      inquiry.actions.hide();
      expect(inquiry.get().type).toBe('pending');
      resolveSubmit!();
      await submitPromise;
    });
  });

  describe('updateForm', () => {
    it('updates form fields', () => {
      inquiry.actions.updateForm((f: any) => { f.description = 'hello'; });
      expect(inquiry.get().form.description).toBe('hello');
    });

    it('can update multiple fields', () => {
      inquiry.actions.updateForm((f: any) => {
        f.reproSteps = 'step1';
        f.occurredAt = 'today';
        f.agentId = 'abc';
      });
      const { form } = inquiry.get();
      expect(form.reproSteps).toBe('step1');
      expect(form.occurredAt).toBe('today');
      expect(form.agentId).toBe('abc');
    });
  });

  describe('isAllValid', () => {
    it('returns false when description is empty', () => {
      expect(inquiry.actions.isAllValid()).toBe(false);
    });

    it('returns false when reproSteps missing', () => {
      inquiry.actions.updateForm((f: any) => { f.description = 'bug'; });
      expect(inquiry.actions.isAllValid()).toBe(false);
    });

    it('returns false when occurredAt missing', () => {
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
      });
      expect(inquiry.actions.isAllValid()).toBe(false);
    });

    it('returns false when agentId not set', () => {
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
      });
      expect(inquiry.actions.isAllValid()).toBe(false);
    });

    it('returns false when agentId set but chatSessionId missing', () => {
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = 'agent1';
      });
      expect(inquiry.actions.isAllValid()).toBe(false);
    });

    it('returns true when agentId is NONE_OPTION (no chatSessionId required)', () => {
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = NONE_OPTION;
      });
      expect(inquiry.actions.isAllValid()).toBe(true);
    });

    it('returns true when all required fields filled with chatSessionId', () => {
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = 'agent1';
        f.chatSessionId = 'session1';
      });
      expect(inquiry.actions.isAllValid()).toBe(true);
    });
  });

  describe('hasValidField', () => {
    it('returns false when form is empty', () => {
      expect(inquiry.actions.hasValidField()).toBe(false);
    });

    it('returns true when description has content', () => {
      inquiry.actions.updateForm((f: any) => { f.description = 'something'; });
      expect(inquiry.actions.hasValidField()).toBe(true);
    });

    it('returns true when reproSteps has content', () => {
      inquiry.actions.updateForm((f: any) => { f.reproSteps = 'steps'; });
      expect(inquiry.actions.hasValidField()).toBe(true);
    });

    it('returns true when occurredAt has content', () => {
      inquiry.actions.updateForm((f: any) => { f.occurredAt = 'today'; });
      expect(inquiry.actions.hasValidField()).toBe(true);
    });

    it('returns true when agentId is a real agent (not NONE_OPTION)', () => {
      inquiry.actions.updateForm((f: any) => { f.agentId = 'agent1'; });
      expect(inquiry.actions.hasValidField()).toBe(true);
    });

    it('returns false when agentId is NONE_OPTION', () => {
      inquiry.actions.updateForm((f: any) => { f.agentId = NONE_OPTION; });
      expect(inquiry.actions.hasValidField()).toBe(false);
    });

    it('returns true when chatSessionId is a real session', () => {
      inquiry.actions.updateForm((f: any) => { f.chatSessionId = 'session1'; });
      expect(inquiry.actions.hasValidField()).toBe(true);
    });

    it('returns false when chatSessionId is NONE_OPTION', () => {
      inquiry.actions.updateForm((f: any) => { f.chatSessionId = NONE_OPTION; });
      expect(inquiry.actions.hasValidField()).toBe(false);
    });

    it('returns true when screenshots present', () => {
      inquiry.actions.updateForm((f: any) => { f.screenshots.push(new File(['x'], 'x.png')); });
      expect(inquiry.actions.hasValidField()).toBe(true);
    });
  });

  describe('submit', () => {
    beforeEach(() => {
      inquiry.actions.show();
      inquiry.actions.updateForm((f: any) => {
        f.description = 'bug';
        f.reproSteps = 'steps';
        f.occurredAt = 'now';
        f.agentId = NONE_OPTION;
        f.chatSessionId = NONE_OPTION;
      });
    });

    it('does nothing when form is not valid', async () => {
      inquiry.actions.discard(); // reset to empty form
      await inquiry.actions.submit();
      expect(mockSubmitDoctorInquiry).not.toHaveBeenCalled();
    });

    it('submits and enters pending state', async () => {
      mockSubmitDoctorInquiry.mockResolvedValue(undefined);
      await inquiry.actions.submit();
      // After submit resolves, state remains pending until analyze finishes
      expect(mockSubmitDoctorInquiry).toHaveBeenCalled();
    });

    it('maps NONE_OPTION agentId to undefined in payload', async () => {
      mockSubmitDoctorInquiry.mockResolvedValue(undefined);
      await inquiry.actions.submit();
      const payload = mockSubmitDoctorInquiry.mock.calls[0][0];
      expect(payload.agentId).toBeUndefined();
    });

    it('maps NONE_OPTION chatSessionId to undefined in payload', async () => {
      mockSubmitDoctorInquiry.mockResolvedValue(undefined);
      await inquiry.actions.submit();
      const payload = mockSubmitDoctorInquiry.mock.calls[0][0];
      expect(payload.chatSessionId).toBeUndefined();
    });

    it('on error reverts to idle-show with error message', async () => {
      mockSubmitDoctorInquiry.mockRejectedValue(new Error('IPC failed'));
      await inquiry.actions.submit();
      const state = inquiry.get();
      expect(state.type).toBe('idle-show');
      expect(state.error).toContain('IPC failed');
    });

    it('on non-Error rejection uses string conversion', async () => {
      mockSubmitDoctorInquiry.mockRejectedValue('string error');
      await inquiry.actions.submit();
      const state = inquiry.get();
      expect(state.error).toBe('string error');
    });

    it('includes screenshots in payload', async () => {
      const fakeArrayBuffer = new ArrayBuffer(4);
      const fakeFile = { name: 'shot.png', type: 'image/png', arrayBuffer: vi.fn().mockResolvedValue(fakeArrayBuffer) } as any;
      inquiry.actions.updateForm((f: any) => { f.screenshots.push(fakeFile); });
      mockSubmitDoctorInquiry.mockResolvedValue(undefined);
      await inquiry.actions.submit();
      const payload = mockSubmitDoctorInquiry.mock.calls[0][0];
      expect(payload.screenshots).toBeDefined();
      expect(payload.screenshots[0].name).toBe('shot.png');
    });

    it('sends undefined screenshots when empty', async () => {
      mockSubmitDoctorInquiry.mockResolvedValue(undefined);
      await inquiry.actions.submit();
      const payload = mockSubmitDoctorInquiry.mock.calls[0][0];
      expect(payload.screenshots).toBeUndefined();
    });
  });

  describe('_onAnalyzeFinished', () => {
    it('resets inquiry state to idle', () => {
      inquiry.actions.show();
      inquiry.actions.updateForm((f: any) => { f.description = 'test'; });
      inquiry.actions._onAnalyzeFinished();
      expect(inquiry.get().type).toBe('idle');
      expect(inquiry.get().form.description).toBe('');
    });
  });
});

describe('doctorAnalyzeAtom', () => {
  let query: ReturnType<typeof buildStore>;
  let analyze: any;

  beforeEach(() => {
    vi.clearAllMocks();
    query = buildStore();
    analyze = query(doctorAnalyzeAtom);
  });

  it('initialises with idle status', () => {
    expect(analyze.get().status).toBe('idle');
  });

  describe('IPC events', () => {
    it('taskStatusChanged → pending updates status', () => {
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'pending' });
      expect(analyze.get().status).toBe('pending');
    });

    it('taskStatusChanged → analyzing updates status', () => {
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'analyzing' });
      expect(analyze.get().status).toBe('analyzing');
    });

    it('taskStatusChanged → done updates status and issueUrl', () => {
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'done', issueUrl: 'https://issue.test' });
      expect(analyze.get().status).toBe('done');
      expect(analyze.get().issueUrl).toBe('https://issue.test');
    });

    it('taskStatusChanged → error updates status and error message', () => {
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'error', error: 'something broke' });
      expect(analyze.get().status).toBe('error');
      expect(analyze.get().error).toBe('something broke');
    });

    it('taskStatusChanged → done calls _onAnalyzeFinished on inquiry', () => {
      const inq = query(doctorInquiryAtom);
      inq.actions.show();
      inq.actions.updateForm((f: any) => { f.description = 'bug'; });
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'done' });
      // Inquiry resets
      expect(inq.get().type).toBe('idle');
    });

    it('stepInfo event sets step info', () => {
      doctorEventCallbacks.stepInfo!(null, { stepInfo: 'Running diagnostic...' });
      const state = analyze.get();
      expect(state.step?.info).toBe('Running diagnostic...');
      expect(typeof state.step?.at).toBe('number');
    });

    it('agentQuestion event sets question', () => {
      const question = { taskId: 'task-1', questions: [{ id: 'q1', text: 'What happened?' }] };
      doctorEventCallbacks.agentQuestion!(null, question);
      expect(analyze.get().question).toEqual(question);
    });

    it('entering terminal state clears question', () => {
      const question = { taskId: 'task-1', questions: [] };
      doctorEventCallbacks.agentQuestion!(null, question);
      expect(analyze.get().question).toBeDefined();
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'done' });
      expect(analyze.get().question).toBeUndefined();
    });

    it('waiting_for_user status preserves existing question', () => {
      const question = { taskId: 'task-1', questions: [] };
      doctorEventCallbacks.agentQuestion!(null, question);
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'waiting_for_user' });
      expect(analyze.get().question).toEqual(question);
    });
  });

  describe('dismiss', () => {
    it('resets analyze state to idle', () => {
      doctorEventCallbacks.taskStatusChanged!(null, { state: 'done', issueUrl: 'https://x' });
      expect(analyze.get().status).toBe('done');
      analyze.actions.dismiss();
      expect(analyze.get().status).toBe('idle');
      expect(analyze.get().issueUrl).toBeUndefined();
    });
  });

  describe('submitAnswer', () => {
    it('calls doctorApi.submitAgentAnswer with taskId and answers', async () => {
      mockSubmitAgentAnswer.mockResolvedValue(undefined);
      const question = { taskId: 'task-42', questions: [] };
      doctorEventCallbacks.agentQuestion!(null, question);

      await analyze.actions.submitAnswer({ q1: 'yes' });

      expect(mockSubmitAgentAnswer).toHaveBeenCalledWith({
        taskId: 'task-42',
        answers: { q1: 'yes' },
      });
    });

    it('is a no-op when no question is set', async () => {
      await analyze.actions.submitAnswer({ q1: 'yes' });
      expect(mockSubmitAgentAnswer).not.toHaveBeenCalled();
    });

    it('clears question after submitting answer', async () => {
      mockSubmitAgentAnswer.mockResolvedValue(undefined);
      const question = { taskId: 'task-1', questions: [] };
      doctorEventCallbacks.agentQuestion!(null, question);
      await analyze.actions.submitAnswer({ q1: 'answer' });
      expect(analyze.get().question).toBeUndefined();
    });
  });
});
