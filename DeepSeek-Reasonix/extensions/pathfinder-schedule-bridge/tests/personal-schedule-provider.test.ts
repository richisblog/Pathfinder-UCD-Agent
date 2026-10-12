import { afterEach, describe, expect, it, vi } from "vitest";

import { queryPersonalScheduleInPage } from "../src/content/personal-schedule-provider";

afterEach(() => vi.unstubAllGlobals());

describe("personal Schedule Builder provider", () => {
  it("extracts and normalizes Pass 1 and Pass 2 from audited DOM nodes", () => {
    vi.stubGlobal("document", {
      scripts: [],
      querySelector(selector: string) {
        if (selector === "#PassTime1") return { textContent: "Pass 1: May 18, 2026 09:30 AM" };
        if (selector === "#PassTime2") return { textContent: "Pass 2: Aug 20, 2026 02:00 PM" };
        return null;
      },
      documentElement: { innerHTML: "private.student@ucdavis.edu PIDM 7654321" },
    });

    const result = queryPersonalScheduleInPage("202610", ["pass_times"]);

    expect(result.courses).toEqual([]);
    expect(result.passTimes).toEqual([
      {
        pass: 1,
        sourceText: "Pass 1: May 18, 2026 09:30 AM",
        localDateTime: "2026-05-18T09:30:00",
        instant: "2026-05-18T09:30:00-07:00",
        timeZone: "America/Los_Angeles",
        abbreviation: "PDT",
        utcOffset: "-07:00",
      },
      {
        pass: 2,
        sourceText: "Pass 2: Aug 20, 2026 02:00 PM",
        localDateTime: "2026-08-20T14:00:00",
        instant: "2026-08-20T14:00:00-07:00",
        timeZone: "America/Los_Angeles",
        abbreviation: "PDT",
        utcOffset: "-07:00",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/7654321|private\.student@ucdavis\.edu|pidm/i);
  });

  it("uses the audited script assignment when pass-time DOM nodes are absent", () => {
    vi.stubGlobal("document", {
      querySelector: () => null,
      scripts: [{
        textContent: `
          var pass1 = $("#PassTime1");
          var pass2 = $("#PassTime2");
          pass1.html(\`Pass 1: Jan 12, 2026 08:15 AM\`);
          pass2.html(\`Pass 2: Feb 2, 2026 04:45 PM\`);
        `,
      }],
    });

    const result = queryPersonalScheduleInPage("202603", ["pass_times"]);

    expect(result.passTimes).toEqual([
      expect.objectContaining({ pass: 1, abbreviation: "PST", utcOffset: "-08:00" }),
      expect.objectContaining({ pass: 2, abbreviation: "PST", utcOffset: "-08:00" }),
    ]);
  });

  it("does not return pass times unless the category was requested", () => {
    vi.stubGlobal("document", {
      scripts: [],
      querySelector: () => ({ textContent: "Pass 1: May 18, 2026 09:30 AM" }),
    });

    const result = queryPersonalScheduleInPage("202610", ["schedule"]);

    expect(result).not.toHaveProperty("passTimes");
  });

  it("uses the Schedule Builder current term when calendar export requests current", () => {
    vi.stubGlobal("document", {
      scripts: [{ textContent: `var termCode = "202610";` }],
      querySelector: () => null,
    });
    vi.stubGlobal("window", { location: { href: "https://my.ucdavis.edu/schedulebuilder/index.cfm" } });

    const result = queryPersonalScheduleInPage("current", ["schedule", "waitlist", "pass_times"]);

    expect(result.term).toBe("202610");
  });

  it("fails closed when a displayed pass time has an unsupported format", () => {
    vi.stubGlobal("document", {
      scripts: [],
      querySelector(selector: string) {
        return selector === "#PassTime1" ? { textContent: "Pass 1: someday" } : null;
      },
    });

    expect(() => queryPersonalScheduleInPage("202610", ["pass_times"]))
      .toThrow(/SITE_VERSION_UNSUPPORTED/);
  });

  it("extracts registered and waitlisted courses from the page-owned CourseDetails state", () => {
    vi.stubGlobal("document", {
      scripts: [
        {
          textContent: `
            CourseDetails.t12345 = {
              "CRN":"12345",
              "SUBJECT_CODE":"ECS",
              "COURSE_NUMBER":"036A",
              "SECTION_NUMBER":"001",
              "TITLE":"Programming and Problem Solving",
              "UNITS":"4",
              "INSTRUCTORS":[{"FIRST_NAME":"Ada","LAST_NAME":"Lovelace","EMAIL":"private@ucdavis.edu"}],
              "MEETINGS":[{"TYPE":"Lecture","LOCATION":"Wellman 2","WEEKDAYS":"MWF","STARTTIME":new Date(2026,9 - 1,23,14,10,0,0),"ENDTIME":new Date(2026,11 - 1,11,15,0,0,0)}],
              "DROP_DATE":new Date(2026,(10 - 1),6,0,0,0),
              "FINAL_EXAM_STARTDATE":new Date(2026,11,8,13,0,0)
            };
            CourseDetails.t12345.REGISTRATION_STATUS = "Registered";
            CourseDetails.t23456 = {
              "CRN":"23456",
              "SUBJECT_CODE":"MAT",
              "COURSE_NUMBER":"021A",
              "SECTION_NUMBER":"A01",
              "TITLE":"Calculus",
              "UNITS":"4"
            };
            CourseDetails.t23456.REGISTRATION_STATUS = "Waitlisted";
            CourseDetails.t34567 = {"CRN":"34567","SUBJECT_CODE":"CHE","COURSE_NUMBER":"002A","SECTION_NUMBER":"A01"};
            CourseDetails.t34567.REGISTRATION_STATUS = "";
            const PIDM = "7654321";
          `,
        },
      ],
    });

    const result = queryPersonalScheduleInPage("202610", ["schedule", "waitlist"]);

    expect(result.courses).toEqual([
      expect.objectContaining({
        crn: "12345",
        status: "registered",
        course: "ECS 036A",
        section: "001",
        title: "Programming and Problem Solving",
        instructors: ["Ada Lovelace"],
        dropDate: "2026-10-06",
        finalExamStart: "2026-12-08T13:00:00",
        meetings: [expect.objectContaining({
          startDate: "2026-09-23",
          startTime: "14:10:00",
          endDate: "2026-11-11",
          endTime: "15:00:00",
        })],
      }),
      expect.objectContaining({
        crn: "23456",
        status: "waitlisted",
        course: "MAT 021A",
        section: "A01",
        title: "Calculus",
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/7654321|private@ucdavis\.edu|pidm|email/i);
  });

  it("returns only the requested personal category", () => {
    vi.stubGlobal("document", {
      scripts: [{
        textContent: `
          CourseDetails.t12345 = {"CRN":"12345","SUBJECT_CODE":"ECS","COURSE_NUMBER":"036A","SECTION_NUMBER":"001"};
          CourseDetails.t12345.REGISTRATION_STATUS = "Registered";
          CourseDetails.t23456 = {"CRN":"23456","SUBJECT_CODE":"MAT","COURSE_NUMBER":"021A","SECTION_NUMBER":"A01"};
          CourseDetails.t23456.REGISTRATION_STATUS = "Waitlisted";
        `,
      }],
    });

    const result = queryPersonalScheduleInPage("202610", ["waitlist"]);

    expect(result.courses.map((course) => course.crn)).toEqual(["23456"]);
  });

  it("uses the CRN field when Schedule Builder keys a variable-unit course by an opaque ID", () => {
    vi.stubGlobal("document", {
      scripts: [{
        textContent: `
          CourseDetails.t0F933BE34072B581880A62F6EB6BF87F = {
            "ID":"0F933BE34072B581880A62F6EB6BF87F",
            "CRN":"47525",
            "SUBJECT_CODE":"ECS",
            "COURSE_NUMBER":"189G",
            "SECTION_NUMBER":"001",
            "TITLE":"Special Topics in Computer Science: Artificial Intelligence",
            "UNITS":"1"
          };
          CourseDetails.t0F933BE34072B581880A62F6EB6BF87F.REGISTRATION_STATUS = "Registered";
          CourseDetails.t0F933BE34072B581880A62F6EB6BF87F.REGISTERED_UNITS = "4.000";
        `,
      }],
    });

    const result = queryPersonalScheduleInPage("202610", ["schedule"]);

    expect(result.courses).toEqual([
      expect.objectContaining({
        crn: "47525",
        status: "registered",
        course: "ECS 189G",
        section: "001",
        units: "4",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("0F933BE34072B581880A62F6EB6BF87F");
  });
});
