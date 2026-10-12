import { describe, expect, it } from "vitest";

import {
  ReadOnlyRouter,
  type PageExecutor,
  type ReadOperation,
} from "../src/content/schedule-builder-adapter";

class RecordingPageExecutor implements PageExecutor {
  readonly calls: ReadOperation[] = [];

  async execute(operation: ReadOperation): Promise<unknown> {
    this.calls.push(operation);
    return { ok: true };
  }
}

describe("ReadOnlyRouter", () => {
  it("allows a validated course search", async () => {
    const page = new RecordingPageExecutor();
    const router = new ReadOnlyRouter();
    await expect(router.execute({ kind: "courseSearch", term: "2026-fall", course: "ECS 036A" }, page)).resolves.toEqual({ ok: true });
    expect(page.calls).toEqual([{ kind: "courseSearch", term: "2026-fall", course: "ECS 036A" }]);
  });

  for (const operation of ["register", "drop", "swap", "saveSchedule", "updatePreferences"]) {
    it(`denies ${operation} before page execution`, async () => {
      const page = new RecordingPageExecutor();
      const router = new ReadOnlyRouter();
      await expect(router.execute({ kind: operation }, page)).rejects.toThrow(/read-only/i);
      expect(page.calls).toHaveLength(0);
    });
  }

  it("rejects arbitrary URL fields before page execution", async () => {
    const page = new RecordingPageExecutor();
    const router = new ReadOnlyRouter();
    await expect(router.execute({ kind: "courseSearch", term: "2026-fall", course: "ECS 036A", url: "https://example.com" }, page)).rejects.toThrow(/unknown field/i);
    expect(page.calls).toHaveLength(0);
  });
});
