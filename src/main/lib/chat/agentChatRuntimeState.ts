import type { InteractiveRequest } from '@shared/types/interactiveRequestTypes';
import type { UserMessage } from '@shared/types/chatTypes';

import type { CancellationToken } from '../cancellation';
import type { ChatStatus } from './agentChatTypes';

export interface SaveResult {
  success: boolean;
  error?: string;
}

export class AgentChatRuntimeState {
  private _chatStatus: ChatStatus;
  private _pendingInteractiveRequest: InteractiveRequest | null = null;
  private _currentCancellationToken: CancellationToken | undefined;
  private _toolExecutionNonce = 0;
  private _activeToolCancellationHandler: (() => Promise<void> | void) | null = null;
  private _messagesToSave: any[] = [];
  private _saveChain: Promise<SaveResult> = Promise.resolve({ success: true });
  private _queuedSteeringMessages: UserMessage[] = [];
  private _editingSteeringMessageId: string | null = null;

  constructor(initialChatStatus: ChatStatus) {
    this._chatStatus = initialChatStatus;
  }

  get chatStatus(): ChatStatus {
    return this._chatStatus;
  }

  get pendingInteractiveRequest(): InteractiveRequest | null {
    return this._pendingInteractiveRequest;
  }

  get currentCancellationToken(): CancellationToken | undefined {
    return this._currentCancellationToken;
  }

  get toolExecutionNonce(): number {
    return this._toolExecutionNonce;
  }

  get activeToolCancellationHandler(): (() => Promise<void> | void) | null {
    return this._activeToolCancellationHandler;
  }

  get messagesToSave(): any[] {
    return this._messagesToSave;
  }

  get saveChain(): Promise<SaveResult> {
    return this._saveChain;
  }

  get queuedSteeringMessages(): UserMessage[] {
    return this._queuedSteeringMessages;
  }

  setChatStatus(status: ChatStatus): void {
    this._chatStatus = status;
  }

  setPendingInteractiveRequest(request: InteractiveRequest | null): void {
    this._pendingInteractiveRequest = request;
  }

  bindCancellationToken(token: CancellationToken | undefined): void {
    this._currentCancellationToken = token;
  }

  clearCancellationToken(): void {
    this._currentCancellationToken = undefined;
  }

  bumpToolExecutionNonce(): number {
    this._toolExecutionNonce += 1;
    return this._toolExecutionNonce;
  }

  setToolExecutionNonce(next: number): void {
    this._toolExecutionNonce = next;
  }

  setActiveToolCancellationHandler(handler: (() => Promise<void> | void) | null): void {
    this._activeToolCancellationHandler = handler;
  }

  setMessagesToSave(messages: any[]): void {
    this._messagesToSave = messages;
  }

  setSaveChain(chain: Promise<SaveResult>): void {
    this._saveChain = chain;
  }

  enqueueSteeringMessage(message: UserMessage): void {
    const existingIndex = this._queuedSteeringMessages.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) {
      this._queuedSteeringMessages[existingIndex] = message;
      return;
    }
    this._queuedSteeringMessages.push(message);
  }

  /**
   * Update a queued steering message in place ONLY if it is still present.
   * Unlike enqueueSteeringMessage (which upserts by appending when the id is
   * absent), this never re-adds a message that was already consumed/committed.
   * The edit IPC uses it so an edit that races the consumption of the same
   * prompt cannot resurrect a just-sent prompt as a duplicate tail entry.
   * Returns true when it updated an existing entry, false when the id was gone.
   */
  updateSteeringMessage(message: UserMessage): boolean {
    const existingIndex = this._queuedSteeringMessages.findIndex((item) => item.id === message.id);
    if (existingIndex < 0) {
      return false;
    }
    this._queuedSteeringMessages[existingIndex] = message;
    // An update is the edit-submit signal, so it releases any editing hold on
    // this id: the drain must be able to consume the just-submitted content.
    if (this._editingSteeringMessageId === message.id) {
      this._editingSteeringMessageId = null;
    }
    return true;
  }

  /**
   * Restore a message to the FRONT of the queue. Used when a taken prompt is
   * neither committed nor consumed (a pre-commit failure/cancellation): it was
   * removed from the queue but never answered, so it must go back to the head to
   * preserve FIFO order and stay the next prompt to run. Dedupes by id in case
   * the same draft is still present.
   */
  restoreSteeringMessageToFront(message: UserMessage): void {
    const existingIndex = this._queuedSteeringMessages.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) {
      this._queuedSteeringMessages.splice(existingIndex, 1);
    }
    this._queuedSteeringMessages.unshift(message);
  }

  removeSteeringMessage(messageId: string): void {
    this._queuedSteeringMessages = this._queuedSteeringMessages.filter((item) => item.id !== messageId);
    if (this._editingSteeringMessageId === messageId) {
      this._editingSteeringMessageId = null;
    }
  }

  promoteSteeringMessage(messageId: string): UserMessage | null {
    const index = this._queuedSteeringMessages.findIndex((item) => item.id === messageId);
    if (index < 0) {
      return null;
    }

    const [message] = this._queuedSteeringMessages.splice(index, 1);
    this._queuedSteeringMessages.unshift(message);
    return message;
  }

  takeSteeringMessage(messageId: string): UserMessage | null {
    // An editing draft is invisible to the drain: the commit point must not take
    // (send) a prompt the user started editing after it was peeked but before it
    // was committed (an edit that landed inside this prompt's hook window). It
    // stays queued + held and is consumed only after the edit is submitted
    // (updateSteeringMessage releases the hold) or cancelled.
    if (this._editingSteeringMessageId === messageId) {
      return null;
    }
    const index = this._queuedSteeringMessages.findIndex((item) => item.id === messageId);
    if (index < 0) {
      return null;
    }

    const [message] = this._queuedSteeringMessages.splice(index, 1);
    return message;
  }

  takeNextSteeringMessage(): UserMessage | null {
    const head = this._queuedSteeringMessages[0];
    if (!head || this._editingSteeringMessageId === head.id) {
      return null;
    }
    return this._queuedSteeringMessages.shift() ?? null;
  }

  peekNextSteeringMessage(): UserMessage | null {
    const head = this._queuedSteeringMessages[0];
    if (!head || this._editingSteeringMessageId === head.id) {
      // The head is being edited: report the queue as having nothing consumable so
      // the drain STOPS at (waits on) this prompt instead of consuming it with the
      // stale pre-edit content or skipping ahead to a later prompt (which would
      // break FIFO). Consumption resumes when the edit is submitted or cancelled.
      return null;
    }
    return head;
  }

  clearSteeringMessages(): void {
    this._queuedSteeringMessages = [];
    this._editingSteeringMessageId = null;
  }

  /**
   * Mark (or unmark) a queued steering message as being edited in the renderer.
   * A held id is invisible to the drain (see peekNextSteeringMessage /
   * takeSteeringMessage), so main never consumes a prompt the user is still
   * editing. At most one draft is held at a time, mirroring the renderer's
   * single-edit invariant: setting a new id replaces the previous hold (switching
   * the edit target releases the old one). Clearing only releases when the id
   * matches, so a stale unmark cannot free a hold on a different draft.
   */
  setSteeringMessageEditing(messageId: string, editing: boolean): void {
    if (editing) {
      this._editingSteeringMessageId = messageId;
    } else if (this._editingSteeringMessageId === messageId) {
      this._editingSteeringMessageId = null;
    }
  }

  get editingSteeringMessageId(): string | null {
    return this._editingSteeringMessageId;
  }
}