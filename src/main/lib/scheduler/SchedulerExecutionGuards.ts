export interface ExecutionToken {
  jobId: string;
  generation: number;
}

export class SchedulerExecutionGuards {
  private readonly executingJobs = new Map<string, number>();

  private executionSlots: number;

  private generation = 0;

  constructor(readonly maxConcurrentExecutions: number) {
    this.executionSlots = maxConcurrentExecutions;
  }

  isJobExecuting(jobId: string): boolean {
    return (this.executingJobs.get(jobId) ?? 0) > 0;
  }

  getExecutingJobIds(): string[] {
    return Array.from(this.executingJobs.keys());
  }

  getExecutionSlotsAvailable(): number {
    return this.executionSlots;
  }

  hasAvailableSlot(): boolean {
    return this.executionSlots > 0;
  }

  markStarted(jobId: string): ExecutionToken {
    this.executingJobs.set(jobId, (this.executingJobs.get(jobId) ?? 0) + 1);
    this.executionSlots -= 1;
    return { jobId, generation: this.generation };
  }

  markFinished(token: ExecutionToken): void {
    if (token.generation !== this.generation) {
      return;
    }

    const inFlightCount = this.executingJobs.get(token.jobId) ?? 0;
    if (inFlightCount <= 1) {
      this.executingJobs.delete(token.jobId);
    } else {
      this.executingJobs.set(token.jobId, inFlightCount - 1);
    }

    this.executionSlots = Math.min(this.maxConcurrentExecutions, this.executionSlots + 1);
  }

  reset(): void {
    this.generation += 1;
    this.executingJobs.clear();
    this.executionSlots = this.maxConcurrentExecutions;
  }
}
