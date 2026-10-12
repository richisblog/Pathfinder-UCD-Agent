package main

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"time"
)

const scheduleCalendarTZID = "America/Los_Angeles"

type scheduleCalendarEvidence struct {
	Term      string                     `json:"term"`
	Courses   []scheduleCalendarCourse   `json:"courses"`
	PassTimes []scheduleCalendarPassTime `json:"passTimes"`
}

type scheduleCalendarCourse struct {
	CRN            string                    `json:"crn"`
	Status         string                    `json:"status"`
	Course         string                    `json:"course"`
	Section        string                    `json:"section"`
	Title          string                    `json:"title"`
	DropDate       string                    `json:"dropDate"`
	FinalExamStart string                    `json:"finalExamStart"`
	Meetings       []scheduleCalendarMeeting `json:"meetings"`
}

type scheduleCalendarMeeting struct {
	Type      string   `json:"type"`
	Days      []string `json:"days"`
	Location  string   `json:"location"`
	StartDate string   `json:"startDate"`
	StartTime string   `json:"startTime"`
	EndDate   string   `json:"endDate"`
	EndTime   string   `json:"endTime"`
}

type scheduleCalendarPassTime struct {
	Pass          int    `json:"pass"`
	SourceText    string `json:"sourceText"`
	LocalDateTime string `json:"localDateTime"`
}

func generateScheduleCalendar(evidence scheduleCalendarEvidence, now time.Time) (string, error) {
	location, err := time.LoadLocation(scheduleCalendarTZID)
	if err != nil {
		return "", fmt.Errorf("load Pacific timezone: %w", err)
	}
	calendar := &icsCalendar{lines: []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"CALSCALE:GREGORIAN",
		"PRODID:-//UCDavis Course Calendar//EN",
		"METHOD:PUBLISH",
		"X-WR-CALNAME:UC Davis Courses",
		"X-WR-CALDESC:UC Davis Course Schedule",
		"X-WR-TIMEZONE:" + scheduleCalendarTZID,
	}, stamp: now.UTC().Format("20060102T150405Z")}
	for _, course := range evidence.Courses {
		for _, meeting := range course.Meetings {
			start, ok := parseCalendarDateTime(meeting.StartDate, meeting.StartTime, location)
			if !ok || strings.TrimSpace(meeting.EndDate) == "" || strings.TrimSpace(meeting.EndTime) == "" {
				continue
			}
			end, ok := parseCalendarDateTime(meeting.StartDate, meeting.EndTime, location)
			if !ok || !end.After(start) {
				continue
			}
			untilDate, err := time.ParseInLocation("2006-01-02", meeting.EndDate, location)
			if err != nil {
				continue
			}
			weekdays := calendarWeekdays(meeting.Days)
			if len(weekdays) == 0 {
				continue
			}
			summary := courseSummary(course, meeting.Type)
			calendar.addTimedEvent(summary, course.Title, start, end, meeting.Location, "FREQ=WEEKLY;BYDAY="+strings.Join(weekdays, ",")+";UNTIL="+untilDate.AddDate(0, 0, 1).Format("20060102T150405"), true)
		}
		if date, err := time.ParseInLocation("2006-01-02", course.DropDate, location); err == nil {
			calendar.addAllDayEvent(courseSummary(course, "Drop Date"), course.Title, date, false)
		}
		if start, ok := parseCalendarLocalDateTime(course.FinalExamStart, location); ok {
			calendar.addTimedEvent("Final Exam for "+courseLabel(course), course.Title, start, start.Add(2*time.Hour), "", "", true)
		}
	}
	for _, passTime := range evidence.PassTimes {
		if passTime.Pass != 1 && passTime.Pass != 2 {
			continue
		}
		if start, ok := parseCalendarLocalDateTime(passTime.LocalDateTime, location); ok {
			calendar.addTimedEvent(fmt.Sprintf("UC Davis Pass %d", passTime.Pass), passTime.SourceText, start, start.Add(time.Hour), "", "", true)
		}
	}
	calendar.lines = append(calendar.lines, "END:VCALENDAR")
	return strings.Join(calendar.lines, "\r\n") + "\r\n", nil
}

type icsCalendar struct {
	lines []string
	stamp string
}

func (calendar *icsCalendar) addTimedEvent(summary, description string, start, end time.Time, location, rrule string, alarm bool) {
	calendar.lines = append(calendar.lines,
		"BEGIN:VEVENT",
		"UID:"+calendarEventUID(summary, start),
		"DTSTAMP:"+calendar.stamp,
		"SUMMARY:"+escapeICSText(summary),
		"DESCRIPTION:"+escapeICSText(description),
		"DTSTART;TZID="+scheduleCalendarTZID+":"+start.Format("20060102T150405"),
		"DTEND;TZID="+scheduleCalendarTZID+":"+end.Format("20060102T150405"),
	)
	if strings.TrimSpace(location) != "" {
		calendar.lines = append(calendar.lines, "LOCATION:"+escapeICSText(location+" UC Davis"))
	}
	if rrule != "" {
		calendar.lines = append(calendar.lines, "RRULE:"+rrule)
	}
	if alarm {
		calendar.lines = append(calendar.lines, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT30M", "END:VALARM")
	}
	calendar.lines = append(calendar.lines, "END:VEVENT")
}

func (calendar *icsCalendar) addAllDayEvent(summary, description string, date time.Time, alarm bool) {
	calendar.lines = append(calendar.lines,
		"BEGIN:VEVENT",
		"UID:"+calendarEventUID(summary, date),
		"DTSTAMP:"+calendar.stamp,
		"SUMMARY:"+escapeICSText(summary),
		"DESCRIPTION:"+escapeICSText(description),
		"DTSTART;VALUE=DATE:"+date.Format("20060102"),
		"DTEND;VALUE=DATE:"+date.AddDate(0, 0, 1).Format("20060102"),
	)
	if alarm {
		calendar.lines = append(calendar.lines, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT30M", "END:VALARM")
	}
	calendar.lines = append(calendar.lines, "END:VEVENT")
}

func parseCalendarDateTime(date, clock string, location *time.Location) (time.Time, bool) {
	value, err := time.ParseInLocation("2006-01-02T15:04:05", strings.TrimSpace(date)+"T"+strings.TrimSpace(clock), location)
	return value, err == nil
}

func parseCalendarLocalDateTime(value string, location *time.Location) (time.Time, bool) {
	parsed, err := time.ParseInLocation("2006-01-02T15:04:05", strings.TrimSpace(value), location)
	return parsed, err == nil
}

func courseLabel(course scheduleCalendarCourse) string {
	parts := []string{strings.TrimSpace(course.Course), strings.TrimSpace(course.Section)}
	label := strings.TrimSpace(strings.Join(parts, " "))
	if label == "" {
		label = strings.TrimSpace(course.CRN)
	}
	if strings.TrimSpace(course.CRN) != "" {
		label += " (" + strings.TrimSpace(course.CRN) + ")"
	}
	return label
}

func courseSummary(course scheduleCalendarCourse, meetingType string) string {
	prefix := ""
	if strings.EqualFold(strings.TrimSpace(course.Status), "waitlisted") {
		prefix = "(WL) "
	}
	parts := []string{strings.TrimSpace(course.Course), strings.TrimSpace(course.Section)}
	label := strings.TrimSpace(strings.Join(parts, " "))
	if label == "" {
		label = strings.TrimSpace(course.CRN)
	}
	summary := prefix + label + " - " + strings.TrimSpace(meetingType)
	if strings.TrimSpace(course.CRN) != "" {
		summary += " (" + strings.TrimSpace(course.CRN) + ")"
	}
	return summary
}

func calendarWeekdays(days []string) []string {
	mapping := map[string]string{"M": "MO", "T": "TU", "W": "WE", "R": "TH", "F": "FR", "S": "SA", "U": "SU"}
	seen := make(map[string]bool)
	result := make([]string, 0, len(days))
	for _, day := range days {
		if mapped := mapping[strings.ToUpper(strings.TrimSpace(day))]; mapped != "" && !seen[mapped] {
			seen[mapped] = true
			result = append(result, mapped)
		}
	}
	return result
}

func calendarEventUID(summary string, start time.Time) string {
	sum := sha256.Sum256([]byte(summary + "|" + start.Format(time.RFC3339Nano)))
	return fmt.Sprintf("%x@ucdavis.edu", sum[:15])
}

func escapeICSText(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, ";", "\\;")
	value = strings.ReplaceAll(value, ",", "\\,")
	value = strings.ReplaceAll(value, "\r\n", "\\n")
	value = strings.ReplaceAll(value, "\n", "\\n")
	return strings.ReplaceAll(value, "\r", "\\n")
}
