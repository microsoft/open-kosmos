import { atom } from "@/atom";
import { type WritableDraft, produce } from 'immer';
import type {
  AgentQuestionPayload,
  DoctorTaskState,
  DoctorInquiryPayload,
} from '@shared/ipc/doctor';
import { doctorApi, doctorEvents } from '../ipc/doctor';

// ─────────────────────────────────────────────
// Step 1: Inquiry form
// ─────────────────────────────────────────────

export interface InquiryForm {
  /** A: bug description (required). */
  description: string;
  /** B: reproduction steps (required; the "I'm not sure" button auto-fills this). */
  reproSteps: string;
  /** B2: when the bug last occurred (required; the "Not time-related" button auto-fills this). */
  occurredAt: string;
  /** C: id of the affected agent; undefined = not chosen yet, '__none__' = "not related to any Agent". */
  agentId: string | undefined;
  /** D: id of the affected chat session; undefined = not chosen yet, '__none__' = "not related to any session". Disabled when agentId is __none__/undefined. */
  chatSessionId: string | undefined;
  /** F: screenshots (we hold the raw File and read bytes only at submit time). */
  screenshots: File[];
}

export const NONE_OPTION = '__none__';
export const UNSURE_TEXT = "I'm not sure";
export const TIME_AGNOSTIC_TEXT = 'Not time-related';

const zeroInquiryForm: InquiryForm = {
  description: '',
  reproSteps: '',
  occurredAt: '',
  agentId: undefined,
  chatSessionId: undefined,
  screenshots: [],
};

interface InquiryState {
  /** 'idle': closed / 'idle-show': visible and editable / 'pending': submitted, running in background. */
  type: 'idle' | 'idle-show' | 'pending';
  form: InquiryForm;
  /** Transient submit-time error (e.g. IPC call failed). */
  error?: string;
}

const zeroInquiryState: InquiryState = {
  type: 'idle',
  form: zeroInquiryForm,
};

/**
 * Step 1: feedback form open/close, field maintenance, submission.
 * - hide(): close the dialog only, keep the form
 * - discard(): clear the form and close
 * - submit(): after submit, enter pending; the form is preserved until analyze reaches a terminal
 *   state (done/error), at which point analyze triggers the reset.
 */
export const doctorInquiryAtom = atom(zeroInquiryState, (get, set, use) => {
  function show() {
    const state = get();
    if (state.type === 'pending') return;
    set({ ...state, type: 'idle-show', error: undefined });
  }

  function hide() {
    const state = get();
    if (state.type === 'pending') return;
    set({ ...state, type: 'idle' });
  }

  function discard() {
    if (get().type === 'pending') return;
    set(zeroInquiryState);
  }

  function updateForm(change: (form: WritableDraft<InquiryForm>) => void) {
    set(produce((draft) => { change(draft.form); }));
  }

  function isAllValid(): boolean {
    const { form } = get();
    if (!form.description.trim()) return false;
    if (!form.reproSteps.trim()) return false;
    if (!form.occurredAt.trim()) return false;
    if (!form.agentId) return false;
    if (form.agentId !== NONE_OPTION && !form.chatSessionId) return false;
    return true;
  }

  function hasValidField() {
    const { form } = get();
    return (
      form.description.trim() !== '' ||
      form.reproSteps.trim() !== '' ||
      form.occurredAt.trim() !== '' ||
      (form.agentId !== undefined && form.agentId !== NONE_OPTION) ||
      (form.chatSessionId !== undefined && form.chatSessionId !== NONE_OPTION) ||
      form.screenshots.length > 0
    );
  }

  /**
   * Internal: called by doctorAnalyzeAtom once analyze reaches a terminal state, to reset the
   * whole inquiry.
   */
  function _onAnalyzeFinished() {
    set(zeroInquiryState);
  }

  async function submit() {
    if (!isAllValid()) return;
    const { form } = get();
    set({ type: 'pending', form });

    try {
      const screenshots = await Promise.all(
        form.screenshots.map(async (file) => ({
          name: file.name,
          mimeType: file.type || 'image/png',
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );

      const payload: DoctorInquiryPayload = {
        description: form.description.trim(),
        stepsToReproduce: form.reproSteps.trim(),
        occurredAt: form.occurredAt.trim(),
        agentId: form.agentId === NONE_OPTION ? undefined : form.agentId,
        chatSessionId:
          form.agentId === NONE_OPTION || form.chatSessionId === NONE_OPTION
            ? undefined
            : form.chatSessionId,
        screenshots: screenshots.length > 0 ? screenshots : undefined,
      };

      await doctorApi.submitDoctorInquiry(payload);
      // The pending state is preserved until main pushes done/error
    } catch (err) {
      set({
        type: 'idle-show',
        form,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { show, hide, discard, updateForm, submit, isAllValid, hasValidField, _onAnalyzeFinished };
});

// ─────────────────────────────────────────────
// Step 2: Analyze state (driven by main → renderer events)
// ─────────────────────────────────────────────

export interface AnalyzeState {
  /** 'idle' = no task is running. */
  status: DoctorTaskState | 'idle';
  /** Most recent step description; `at` drives the indicator's auto tooltip (2s) — even if `info` doesn't change, a new `at` re-triggers it. */
  step?: { info: string; at: number };
  /** The question currently awaiting a user answer (present when waiting_for_user). */
  question?: AgentQuestionPayload;
  /** Issue url at done. */
  issueUrl?: string;
  /** Error message at error. */
  error?: string;
}

const zeroAnalyzeState: AnalyzeState = {
  status: 'idle',
};

/**
 * Step 2: runtime state of the self-diagnosis task.
 * The IPC subscription is registered once when the atom is first queried, and remains active for
 * the whole application lifecycle.
 */
export const doctorAnalyzeAtom = atom(zeroAnalyzeState, (get, set, use) => {
  function setStatus(status: DoctorTaskState, extras?: { issueUrl?: string; error?: string }) {
    const prev = get();
    set({
      ...prev,
      status,
      issueUrl: extras?.issueUrl ?? prev.issueUrl,
      error: extras?.error ?? prev.error,
      // Clear the question once we enter a terminal state
      question: status === 'waiting_for_user' ? prev.question : undefined,
    });

    if (status === 'done' || status === 'error') {
      // Reset the inquiry form so it's empty next time the user opens it
      const inquiry = use(doctorInquiryAtom)[1];
      inquiry._onAnalyzeFinished();
    }
  }

  function setStepInfo(info: string) {
    set({ ...get(), step: { info, at: Date.now() } });
  }

  function setQuestion(question: AgentQuestionPayload) {
    set({ ...get(), question });
  }

  function clearQuestion() {
    const prev = get();
    set({ ...prev, question: undefined });
  }

  /** After done/error, the user explicitly dismisses the indicator and we go back to idle. */
  function dismiss() {
    set(zeroAnalyzeState);
  }

  /** Submit the user's answer to ask_user_question. */
  async function submitAnswer(answers: Record<string, string | string[]>) {
    const taskId = get().question?.taskId;
    if (!taskId) return;
    await doctorApi.submitAgentAnswer({ taskId, answers });
    clearQuestion();
  }

  // ── IPC subscription: registered once when the atom is first instantiated (application lifetime). ──
  doctorEvents.doctorTaskStatusChanged((_e, s) => {
    const extras: { issueUrl?: string; error?: string } = {};
    if (s.state === 'done') extras.issueUrl = s.issueUrl;
    if (s.state === 'error') extras.error = s.error;
    setStatus(s.state, extras);
  });
  doctorEvents.doctorStepInfo((_e, p) => setStepInfo(p.stepInfo));
  doctorEvents.doctorAgentQuestion((_e, p) => setQuestion(p));

  return { dismiss, submitAnswer };
});
