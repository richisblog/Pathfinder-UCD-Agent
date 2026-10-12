export interface QueueClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface QueueProgress {
  requestId: string;
  currentCourse: string;
  completed: number;
  total: number;
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Schedule provider asked to retry after ${retryAfterMs}ms`);
    this.name = "RateLimitError";
  }
}

interface QueryQueueOptions<T> {
  clock: QueueClock;
  minimumDelayMs: number;
  jitterMs: number;
  random: () => number;
  maximumRetries?: number;
  worker: (course: string) => Promise<T>;
  onProgress?: (progress: QueueProgress) => void;
}

export class QueryQueue<T> {
  private readonly cancelled = new Set<string>();

  constructor(private readonly options: QueryQueueOptions<T>) {
    if (options.minimumDelayMs < 0 || options.jitterMs < 0) {
      throw new Error("Queue delays must not be negative");
    }
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId);
  }

  async enqueue(requestId: string, courses: string[]): Promise<T[]> {
    const results: T[] = [];

    try {
      for (let index = 0; index < courses.length; index += 1) {
        this.assertActive(requestId);
        if (index > 0) {
          const jitter = Math.floor(this.options.random() * this.options.jitterMs);
          await this.options.clock.sleep(this.options.minimumDelayMs + jitter);
          this.assertActive(requestId);
        }

        const course = courses[index]!;
        const result = await this.runWithRetry(requestId, course);
        results.push(result);
        this.options.onProgress?.({
          requestId,
          currentCourse: course,
          completed: index + 1,
          total: courses.length,
        });
      }

      return results;
    } finally {
      this.cancelled.delete(requestId);
    }
  }

  private async runWithRetry(requestId: string, course: string): Promise<T> {
    const maximumRetries = this.options.maximumRetries ?? 2;
    let retries = 0;

    while (true) {
      this.assertActive(requestId);
      try {
        return await this.options.worker(course);
      } catch (error) {
        if (!(error instanceof RateLimitError) || retries >= maximumRetries) throw error;
        retries += 1;
        await this.options.clock.sleep(Math.max(0, error.retryAfterMs));
      }
    }
  }

  private assertActive(requestId: string): void {
    if (this.cancelled.has(requestId)) {
      throw new Error(`Schedule query ${requestId} was cancelled`);
    }
  }
}
