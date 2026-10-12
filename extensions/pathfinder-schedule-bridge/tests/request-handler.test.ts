import { describe, expect, it } from "vitest";

import { createRequestHandler, type ScheduleTabLocator } from "../src/background/request-handler";
import type { BridgeRequest } from "../src/protocol/messages";

const searchRequest: BridgeRequest = {
  protocol: 1,
  id: "req_search_01",
  type: "request",
  method: "schedule.search",
  params: { term: "2026-fall", courses: ["ECS 036A"] },
};

describe("schedule request handler", () => {
  it("asks for the browser instead of hanging when Schedule Builder is absent", async () => {
    const locator: ScheduleTabLocator = { find: async () => undefined };
    await expect(createRequestHandler(locator)(searchRequest)).resolves.toMatchObject({ status: "BROWSER_REQUIRED" });
  });

  it("fails closed while the authenticated read contract is not audited", async () => {
    const locator: ScheduleTabLocator = { find: async () => ({ id: 7, url: "https://my.ucdavis.edu/schedulebuilder/" }) };
    await expect(createRequestHandler(locator)(searchRequest)).resolves.toMatchObject({ status: "SITE_VERSION_UNSUPPORTED" });
  });
});
