package main

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateScheduleCalendarMatchesScheduleBuilderExportContract(t *testing.T) {
	ics, err := generateScheduleCalendar(scheduleCalendarEvidence{
		Term: "202610",
		Courses: []scheduleCalendarCourse{
			{
				CRN: "12345", Status: "registered", Course: "ECS 036A", Section: "001", Title: "Programming, Problem Solving",
				DropDate: "2026-10-06", FinalExamStart: "2026-12-08T13:00:00",
				Meetings: []scheduleCalendarMeeting{{Type: "Lecture", Days: []string{"M", "W", "F"}, Location: "Wellman 2", StartDate: "2026-09-23", StartTime: "14:10:00", EndDate: "2026-12-11", EndTime: "15:00:00"}},
			},
			{
				CRN: "23456", Status: "waitlisted", Course: "MAT 021A", Section: "A01",
				Meetings: []scheduleCalendarMeeting{{Type: "Discussion", Days: []string{"R"}, Location: "Roessler 66", StartDate: "2026-09-24", StartTime: "09:00:00", EndDate: "2026-12-10", EndTime: "09:50:00"}},
			},
		},
		PassTimes: []scheduleCalendarPassTime{
			{Pass: 1, SourceText: "Pass 1: May 18, 2026 09:30 AM", LocalDateTime: "2026-05-18T09:30:00"},
			{Pass: 2, SourceText: "Pass 2: Aug 20, 2026 02:00 PM", LocalDateTime: "2026-08-20T14:00:00"},
		},
	}, time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ics, "\n") && strings.Contains(strings.ReplaceAll(ics, "\r\n", ""), "\n") {
		t.Fatalf("ICS must use CRLF only: %q", ics)
	}
	for _, want := range []string{
		"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nCALSCALE:GREGORIAN",
		"X-WR-TIMEZONE:America/Los_Angeles",
		"SUMMARY:ECS 036A 001 - Lecture (12345)",
		"SUMMARY:(WL) MAT 021A A01 - Discussion (23456)",
		"DTSTART;TZID=America/Los_Angeles:20260923T141000",
		"RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261212T000000",
		"DTSTART;VALUE=DATE:20261006",
		"SUMMARY:Final Exam for ECS 036A 001 (12345)",
		"DTEND;TZID=America/Los_Angeles:20261208T150000",
		"SUMMARY:UC Davis Pass 1",
		"SUMMARY:UC Davis Pass 2",
		"DESCRIPTION:Pass 1: May 18\\, 2026 09:30 AM",
		"TRIGGER:-PT30M",
	} {
		if !strings.Contains(ics, want) {
			t.Errorf("ICS missing %q\n%s", want, ics)
		}
	}
	if strings.Contains(strings.ToLower(ics), "private@") || strings.Contains(strings.ToLower(ics), "pidm") {
		t.Fatalf("ICS contains identity data: %s", ics)
	}
}

func TestGenerateScheduleCalendarSkipsMalformedMeetings(t *testing.T) {
	ics, err := generateScheduleCalendar(scheduleCalendarEvidence{
		Term:    "202610",
		Courses: []scheduleCalendarCourse{{CRN: "12345", Status: "registered", Course: "ECS 036A", Meetings: []scheduleCalendarMeeting{{Days: []string{"M"}, StartDate: "bad-date", StartTime: "14:00:00"}}}},
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ics, "RRULE:") {
		t.Fatalf("malformed meeting entered calendar: %s", ics)
	}
}
