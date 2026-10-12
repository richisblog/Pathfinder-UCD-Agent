import type { RequestHandler, RequestHandlerResult } from "./bridge-client";
import { ScheduleCache } from "./cache";
import { QueryQueue, RateLimitError, type QueueClock } from "./query-queue";
import type { BridgeRequest, PersonalParams, SearchParams } from "../protocol/messages";
import type { NormalizedCourseEvidence } from "../normalize/schedule";
import type { PersonalScheduleEvidence } from "../content/personal-schedule-provider";

const SCHEDULE_BUILDER_PATTERNS = [
  "https://my.ucdavis.edu/schedulebuilder/*",
  "https://my.ucdavis.edu/schedulebuilder",
] as const;

export interface ScheduleBuilderTab {
  id: number;
  url?: string;
}

export interface ScheduleTabLocator {
  find(): Promise<ScheduleBuilderTab | undefined>;
}

export interface ScheduleProvider {
  source: "ucd_schedule_builder" | "ucd_class_search";
  version: string;
  sourceUrl: string;
  searchCourse(term: string, course: string): Promise<NormalizedCourseEvidence>;
  readPersonal?(term: string, categories: PersonalParams["categories"]): Promise<PersonalScheduleEvidence>;
}

export interface RequestHandlerOptions {
  providerForTab?: (tab: ScheduleBuilderTab) => Promise<ScheduleProvider>;
  cache?: ScheduleCache;
  clock?: QueueClock;
  minimumDelayMs?: number;
  jitterMs?: number;
  random?: () => number;
}

export class ChromeScheduleTabLocator implements ScheduleTabLocator {
  async find(): Promise<ScheduleBuilderTab | undefined> {
    const tabs = await chrome.tabs.query({ url: [...SCHEDULE_BUILDER_PATTERNS] });
    const tab = tabs.find((candidate) => typeof candidate.id === "number");
    return tab?.id === undefined ? undefined : { id: tab.id, url: tab.url };
  }
}

class BrowserClock implements QueueClock {
  now(): number { return Date.now(); }
  sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
}

export function createRequestHandler(locator: ScheduleTabLocator, options: RequestHandlerOptions = {}): RequestHandler {
  const cache = options.cache ?? new ScheduleCache();
  const clock = options.clock ?? new BrowserClock();
  const activeQueues = new Map<string, QueryQueue<NormalizedCourseEvidence>>();

  return async (request: BridgeRequest): Promise<RequestHandlerResult> => {
    if (request.method === "request.cancel") {
      const requestId = (request.params as { request_id: string }).request_id;
      activeQueues.get(requestId)?.cancel(requestId);
      return { status: "OK", message: "Cancellation was accepted." };
    }

    const tab = await locator.find();
    if (request.method === "bridge.status") {
      return tab
        ? { status: "OK", message: "Schedule Builder is open." }
        : { status: "BROWSER_REQUIRED", message: "Open UC Davis Schedule Builder in Chrome." };
    }
    if (!tab) {
      return { status: "BROWSER_REQUIRED", message: "Open UC Davis Schedule Builder in Chrome and sign in." };
    }

    if (request.method === "schedule.search" && options.providerForTab) {
      const provider = await options.providerForTab(tab);
      const params = request.params as SearchParams;
      const queue = new QueryQueue<NormalizedCourseEvidence>({
        clock,
        minimumDelayMs: options.minimumDelayMs ?? 3000,
        jitterMs: options.jitterMs ?? 2000,
        random: options.random ?? Math.random,
        worker: async (rawCourse) => {
          const course = rawCourse.trim().toUpperCase().replace(/\s+/g, " ");
          const key = `${provider.source}|${params.term}|${course}`;
          const cached = cache.getPublic<NormalizedCourseEvidence>(key);
          if (cached?.availabilityLive) return cached.data;
          const evidence = await provider.searchCourse(params.term, course);
          cache.putPublic(key, evidence);
          return evidence;
        },
      });
      activeQueues.set(request.id, queue);
      try {
        const courses = await queue.enqueue(request.id, params.courses);
        if (params.include_personal_context && !provider.readPersonal) {
          return {
            status: "SITE_VERSION_UNSUPPORTED",
            message: "This provider cannot read personal Schedule Builder data.",
          };
        }
        let personal: PersonalScheduleEvidence | undefined;
        if (params.include_personal_context) {
          try {
            personal = await provider.readPersonal!(params.term, ["schedule", "waitlist", "pass_times"]);
          } catch {
            return personalFormatChangedResult();
          }
        }
        const latest = courses.reduce((value, course) => value > course.fetchedAt ? value : course.fetchedAt, "");
        return {
          status: "OK",
          evidence: {
            source: provider.source,
            source_url: provider.sourceUrl,
            provider_version: provider.version,
            fetched_at: latest || new Date(clock.now()).toISOString(),
            term: params.term,
            freshness: "live",
            authenticated: provider.source === "ucd_schedule_builder",
            courses,
            ...(personal ? { personal } : {}),
          },
        };
      } catch (error) {
        if (error instanceof RateLimitError) {
          return { status: "RATE_LIMITED", retry_after_ms: error.retryAfterMs, message: error.message };
        }
        if (error instanceof Error && /cancelled/i.test(error.message)) {
          return { status: "CANCELLED", message: error.message };
        }
        throw error;
      } finally {
        activeQueues.delete(request.id);
      }
    }

    if (request.method === "schedule.personal" && options.providerForTab) {
      const provider = await options.providerForTab(tab);
      const params = request.params as PersonalParams;
      const unsupported = params.categories.filter(
        (category) => category !== "schedule" && category !== "waitlist" && category !== "pass_times",
      );
      if (unsupported.length > 0) {
        return {
          status: "SITE_VERSION_UNSUPPORTED",
          message: `Personal categories not supported by this extension build: ${unsupported.join(", ")}.`,
        };
      }
      if (!provider.readPersonal) {
        return {
          status: "SITE_VERSION_UNSUPPORTED",
          message: "This provider cannot read personal Schedule Builder data.",
        };
      }
      let personal: PersonalScheduleEvidence;
      try {
        personal = await provider.readPersonal(params.term, params.categories);
      } catch {
        return personalFormatChangedResult();
      }
      return {
        status: "OK",
        evidence: {
          source: provider.source,
          source_url: provider.sourceUrl,
          provider_version: provider.version,
          fetched_at: personal.fetchedAt,
          term: params.term,
          freshness: "live",
          authenticated: true,
          personal,
        },
      };
    }

    // Fail closed until the exact authenticated read endpoints and response
    // shapes have been captured and sanitized from a user-controlled session.
    // This prevents a site redesign from turning an assumed read into a write.
    return {
      status: "SITE_VERSION_UNSUPPORTED",
      message: "Schedule Builder is open, but this extension build has not audited the current read-only site contract yet.",
    };
  };
}

function personalFormatChangedResult(): RequestHandlerResult {
  return {
    status: "SITE_VERSION_UNSUPPORTED",
    message: "Schedule Builder personal-data format changed. Update the Pathfinder extension.",
  };
}
