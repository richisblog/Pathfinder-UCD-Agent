import { describe, expect, it } from "vitest";

import {
  QueryQueue,
  RateLimitError,
  type QueueClock,
  type QueueProgress,
} from "../src/background/query-queue";

class FakeClock implements QueueClock {
  nowMs = 0;
  readonly sleeps: number[] = [];

  now(): number {
    return this.nowMs;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.nowMs += ms;
  }
}

describe("QueryQueue", () => {
  it("processes more than eight courses sequentially with one active worker", async () => {
    const clock = new FakeClock();
    let active = 0;
    let maximumActive = 0;
    const seen: string[] = [];
    const progress: QueueProgress[] = [];
    const queue = new QueryQueue({
      clock,
      minimumDelayMs: 3000,
      jitterMs: 0,
      random: () => 0,
      worker: async (course) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        seen.push(course);
        active -= 1;
        return { course };
      },
      onProgress: (value) => progress.push(value),
    });
    const courses = Array.from({ length: 12 }, (_, index) => `ECS ${index}`);

    const results = await queue.enqueue("req_many_courses", courses);

    expect(results).toHaveLength(12);
    expect(seen).toEqual(courses);
    expect(maximumActive).toBe(1);
    expect(clock.sleeps).toEqual(Array.from({ length: 11 }, () => 3000));
    expect(progress.at(-1)).toMatchObject({ completed: 12, total: 12 });
  });

  it("honors retry-after before retrying the same course", async () => {
    const clock = new FakeClock();
    let attempts = 0;
    const queue = new QueryQueue({
      clock,
      minimumDelayMs: 3000,
      jitterMs: 0,
      random: () => 0,
      maximumRetries: 2,
      worker: async (course) => {
        attempts += 1;
        if (attempts === 1) throw new RateLimitError(9000);
        return { course };
      },
    });

    await expect(queue.enqueue("req_rate_limit", ["ECS 150"])).resolves.toEqual([{ course: "ECS 150" }]);
    expect(attempts).toBe(2);
    expect(clock.sleeps).toEqual([9000]);
  });

  it("cancels the remaining courses before the next provider call", async () => {
    const clock = new FakeClock();
    const seen: string[] = [];
    let queue!: QueryQueue<{ course: string }>;
    queue = new QueryQueue({
      clock,
      minimumDelayMs: 3000,
      jitterMs: 0,
      random: () => 0,
      worker: async (course) => {
        seen.push(course);
        queue.cancel("req_cancel");
        return { course };
      },
    });

    await expect(queue.enqueue("req_cancel", ["ECS 1", "ECS 2"])).rejects.toThrow(/cancelled/i);
    expect(seen).toEqual(["ECS 1"]);
  });
});
