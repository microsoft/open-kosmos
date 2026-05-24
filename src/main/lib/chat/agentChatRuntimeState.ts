import type { InteractiveRequest } from '@shared/types/interactiveRequestTypes';

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
}