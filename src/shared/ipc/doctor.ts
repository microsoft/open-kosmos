import { connectRenderToMain, connectMainToRender } from './base';
export type * from './base';

// ──────────────────────────────────────────────
// Inquiry payload (renderer → main)
// ──────────────────────────────────────────────

export interface DoctorInquiryPayload {
  /** Required: bug description. */
  description: string;
  /** Required: reproduction steps (must be filled even when the user is unsure — they can write "I'm not sure"). */
  stepsToReproduce: string;
  /** Required: when the bug last occurred (free-form; if not time-related, the user can write so). */
  occurredAt: string;
  /** Optional: agent id when the bug is session-related; undefined when "not related to any Agent". */
  agentId?: string;
  /** Optional: chat session id of the affected session; undefined when "not related to any session" or no agent was chosen. */
  chatSessionId?: string;
  /** Optional: raw screenshot bytes (structured-clone friendly). */
  screenshots?: ScreenshotAttachment[];
}

export interface ScreenshotAttachment {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

// ──────────────────────────────────────────────
// Task state machine (main → renderer)
// ──────────────────────────────────────────────

export type DoctorTaskState =
  | 'pending'
  | 'analyzing'
  | 'creating_issue'
  | 'waiting_for_user'
  | 'done'
  | 'error';

interface DoctorTaskStatusBase {
  taskId: string;
}

export type DoctorTaskStatus =
  | (DoctorTaskStatusBase & { state: 'pending' | 'analyzing' | 'creating_issue' | 'waiting_for_user' })
  | (DoctorTaskStatusBase & { state: 'done'; issueUrl: string })
  | (DoctorTaskStatusBase & { state: 'error'; error: string });

export interface DoctorStepInfoPayload {
  taskId: string;
  /** One-line step description, e.g. "Collecting logs..." / "Analyzing conversation history...". */
  stepInfo: string;
}

// ──────────────────────────────────────────────
// Agent Question / Answer (ask_user_question tool)
// ──────────────────────────────────────────────

export type QuestionInputType = 'single_select' | 'multi_select' | 'text';

interface AgentQuestionBase {
  id: string;
  text: string;
  required?: boolean;
}

export interface TextQuestion extends AgentQuestionBase {
  inputType: 'text';
  placeholder?: string;
}

export interface SingleSelectQuestion extends AgentQuestionBase {
  inputType: 'single_select';
  options: string[];
}

export interface MultiSelectQuestion extends AgentQuestionBase {
  inputType: 'multi_select';
  options: string[];
}

export type AgentQuestion = TextQuestion | SingleSelectQuestion | MultiSelectQuestion;

export interface AgentQuestionPayload {
  taskId: string;
  questions: AgentQuestion[];
}

/** text/single_select answers are string; multi_select answers are string[]. */
export type AgentAnswerValue = string | string[];

export interface AgentAnswerPayload {
  taskId: string;
  answers: Record<string, AgentAnswerValue>;
}

// ──────────────────────────────────────────────
// Render → Main
// ──────────────────────────────────────────────

type RenderToMain = {
  submitDoctorInquiry: {
    call: [payload: DoctorInquiryPayload];
    return: { taskId: string };
  };
  submitAgentAnswer: {
    call: [payload: AgentAnswerPayload];
    return: void;
  };
};

// ──────────────────────────────────────────────
// Main → Renderer
// ──────────────────────────────────────────────

export type MainToRender = {
  doctorTaskStatusChanged: DoctorTaskStatus;
  doctorAgentQuestion: AgentQuestionPayload;
  doctorStepInfo: DoctorStepInfoPayload;
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('doctor');
export const mainToRender = connectMainToRender<MainToRender>('doctor');
