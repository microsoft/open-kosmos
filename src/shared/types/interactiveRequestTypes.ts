export type InteractiveRequestType = 'approval' | 'choice' | 'form';

export type InteractiveRequestStatus =
  | 'pending'
  | 'submitted'
  | 'resolved'
  | 'rejected'
  | 'skipped'
  | 'expired';

export type InteractiveRequestSource = 'assistant' | 'tool' | 'system';

export interface InteractiveRequestBase {
  interactionId: string;
  chatId: string;
  chatSessionId: string;
  requestType: InteractiveRequestType;
  status: InteractiveRequestStatus;
  title: string;
  description?: string;
  submitLabel?: string;
  skipLabel?: string;
  createdAt: number;
  expiresAt?: number;
  source?: InteractiveRequestSource;
  metadata?: Record<string, unknown>;
}

export interface ApprovalInteractionItem {
  itemId: string;
  toolCallId?: string;
  toolName: string;
  message: string;
  paths: Array<{
    path: string;
    normalizedPath?: string;
  }>;
}

export interface ApprovalInteractionRequest extends InteractiveRequestBase {
  requestType: 'approval';
  items: ApprovalInteractionItem[];
}

export interface ChoiceInteractionOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ChoiceInteractionRequest extends InteractiveRequestBase {
  requestType: 'choice';
  mode: 'single' | 'multi';
  options: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
}

export interface FormInteractionField {
  key: string;
  label: string;
  type: 'string' | 'int' | 'double' | 'boolean';
  control?: 'text' | 'textarea' | 'time' | 'folder' | 'file' | 'number' | 'checkbox' | 'select' | 'multiselect';
  varName?: string;
  required?: boolean;
  defaultValue?: string | number | boolean | string[];
  placeholder?: string;
  description?: string;
  options?: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
}

export interface FormInteractionRequest extends InteractiveRequestBase {
  requestType: 'form';
  fields: FormInteractionField[];
}

export type InteractiveRequest =
  | ApprovalInteractionRequest
  | ChoiceInteractionRequest
  | FormInteractionRequest;

export interface InteractiveResponse {
  interactionId: string;
  chatSessionId: string;
  requestType: InteractiveRequestType;
  action: 'approve' | 'reject' | 'submit' | 'skip' | 'expire';
  resolutionSource?: 'user' | 'system-fallback' | 'timeout' | 'chat-cancelled';
  approvalItemDecisions?: Array<{
    itemId: string;
    approved: boolean;
  }>;
  selectedValues?: string[];
  formValues?: Record<string, unknown>;
}

export interface InteractionHistoryEntry {
  interactionId: string;
  requestType: InteractiveRequestType;
  title: string;
  description?: string;
  source?: InteractiveRequestSource;
  resolutionSource?: InteractiveResponse['resolutionSource'];
  createdAt: number;
  resolvedAt: number;
  status: Extract<InteractiveRequestStatus, 'resolved' | 'rejected' | 'skipped' | 'expired'>;
  summaryText: string;
}