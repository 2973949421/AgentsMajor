import type { Job } from "@agent-major/shared";

export interface JobDefinition<TPayload = unknown> {
  type: string;
  payload: TPayload;
  runAfter?: Date;
  dedupeKey?: string;
}

export interface JobQueue {
  enqueue<TPayload = unknown>(job: JobDefinition<TPayload>): Promise<Job>;
  claimNext(workerId: string, jobTypes?: string[]): Promise<Job | null>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, reason: string): Promise<void>;
}

export class UnconfiguredJobQueue implements JobQueue {
  async enqueue(): Promise<Job> {
    throw new Error("JobQueue is not configured in Phase 1.0.");
  }

  async claimNext(): Promise<Job | null> {
    throw new Error("JobQueue is not configured in Phase 1.0.");
  }

  async complete(): Promise<void> {
    throw new Error("JobQueue is not configured in Phase 1.0.");
  }

  async fail(): Promise<void> {
    throw new Error("JobQueue is not configured in Phase 1.0.");
  }
}
