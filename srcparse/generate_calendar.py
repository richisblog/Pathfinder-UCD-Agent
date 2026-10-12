import os
import re
from bs4 import BeautifulSoup
from icalendar import Calendar, Event, Alarm, vCalAddress, vText
from datetime import datetime, timedelta, time
import pytz
from typing import List, Dict
import hashlib
from encryption import encrypt

# Assuming these functions are defined in the respective files
# For this script, we'll import them (adjust paths if needed)
from parse_crn import extract_registered_crns, extract_waitlisted_crns, extract_schedule_crns, extract_all_schedule_crns
from parse_course_info import (
    get_crn, get_title, get_subject_code, get_course_number, get_section_number,
    get_description, get_units, get_drop_date, get_final_exam_startdate,
    get_meetings, get_instructors, get_ge3credit, get_course_materials_term
)
from parse_personal_info import extract_student_name, extract_student_id

# Timezone
PACIFIC_TZ = pytz.timezone('America/Los_Angeles')

def parse_html_files(directory: str) -> List[str]:
    """Find all HTML files in the directory."""
    html_files = [f for f in os.listdir(directory) if f.endswith('.html')]
    return [os.path.join(directory, f) for f in html_files]

def load_html_content(file_path: str) -> str:
    """Load HTML content from file."""
    with open(file_path, 'r', encoding='utf-8') as file:
        return file.read()

def generate_uid(summary: str, dtstart: datetime) -> str:
    hash_input = f"{summary}{dtstart.isoformat()}"
    md5_hash = hashlib.md5(hash_input.encode('utf-8')).hexdigest()[:30]
    return f"{md5_hash}@ucdavis.edu"

def create_event(cal: Calendar, summary: str, description: str, dtstart: datetime, dtend: datetime, location: str = '', rrule: Dict = None, alarm: bool = True, uid: str = None):
    """Helper to create a VEVENT."""
    event = Event()
    event.add('summary', summary)
    event.add('description', description)
    event.add('dtstart', dtstart)
    event.add('dtend', dtend)
    event.add('dtstamp', datetime.now(PACIFIC_TZ))
    if uid:
        event.add('uid', uid)
    else:
        event.add('uid', generate_uid(summary, dtstart))
    if location:
        event.add('location', location+" UC Davis")
    if rrule:
        event.add('rrule', rrule)
    
    if alarm:
        alarm_comp = Alarm()
        alarm_comp.add('action', 'DISPLAY')
        alarm_comp.add('description', 'Reminder')
        alarm_comp.add('trigger', timedelta(minutes=-30))
        event.add_component(alarm_comp)
    
    cal.add_component(event)

def weekdays_to_rrule_days(weekdays: str) -> List[str]:
    """Convert the weekdays string to a list of RRULE-compatible day abbreviations."""
    day_map = {'M': 'MO', 'T': 'TU', 'W': 'WE', 'R': 'TH', 'F': 'FR', 'S': 'SA', 'U': 'SU'}
    days_list = weekdays.split(',') if ',' in weekdays else list(weekdays)
    return [day_map.get(day.upper(), day.upper()) for day in days_list]

def format_instructors(instructors: List[Dict]) -> str:
    if not instructors:
        return "No instructors listed."
    instructor_strs = [f"{i['first_name']} {i['last_name']} ({i.get('email', 'N/A')})" for i in instructors]
    return "Instructors: " + "; ".join(instructor_strs)

def format_meetings(meetings: List[Dict]) -> str:
    complete_meetings = [
        m for m in meetings if all(key in m for key in ['TYPE', 'WEEKDAYS', 'start_time', 'end_time', 'LOCATION', 'start_date', 'end_date'])
    ]
    if not complete_meetings:
        return "No meetings scheduled."
    return "Meetings:\n" + "\n".join(
        f"- {m['TYPE']}: {m['WEEKDAYS'].replace(',', ', ')} {m['start_time']}-{m['end_time']} at {m['LOCATION']} ({m['start_date']} to {m['end_date']})" 
        for m in complete_meetings
    )

def get_status_prefix(html_content: str, crn: str) -> str:
    """根据课程状态返回前缀：(WL) 或 (NR)，Registered 返回空字符串"""
    try:
        # 使用文件顶部已导入的函数，避免重复导入
        # 首先检查是否是已注册或等待列表
        registered_crns = extract_registered_crns(html_content)
        waitlisted_crns = extract_waitlisted_crns(html_content)
        
        if crn in registered_crns:
            return ""
        elif crn in waitlisted_crns:
            return "(WL) "
        else:
            # 检查是否在 schedule 中（可能是未注册的）
            schedule_crns_info = extract_schedule_crns(html_content)
            if crn in schedule_crns_info:
                crn_info = schedule_crns_info[crn]
                if crn_info.get('is_waitlisted', False):
                    return "(WL) "
                elif not crn_info.get('is_registered', False):
                    return "(NR) "
            return "(NR) "
    except Exception as e:
        # 如果出现错误，返回默认值（空字符串，表示已注册）
        print(f"Error in get_status_prefix for CRN {crn}: {str(e)}")
        return ""

def add_meeting_events(cal: Calendar, html_content: str, crn: str, status_prefix: str = None):
    """Add VEVENTs for each meeting of the course."""
    if status_prefix is None:
        status_prefix = get_status_prefix(html_content, crn)
    
    course_number = get_course_number(html_content, crn)
    desc = get_description(html_content, crn)
    desc = re.sub(r'\\+', '', desc)
    instructors = get_instructors(html_content, crn)
    meetings_list = get_meetings(html_content, crn)
    formatted_instructors = format_instructors(instructors)
    ge3credit = get_ge3credit(html_content, crn)
    clean_desc = desc.replace('\n', '; ')
    if ge3credit:
        clean_desc = f"GE: {ge3credit}\n{formatted_instructors}\n{clean_desc}"
    description = f"{clean_desc}"
    
    for meeting in meetings_list:
        if 'start_date' not in meeting or 'end_date' not in meeting or 'start_time' not in meeting or 'end_time' not in meeting or 'WEEKDAYS' not in meeting:
            continue
        start_date = datetime.fromisoformat(meeting['start_date'])
        end_date = datetime.fromisoformat(meeting['end_date'])
        # 解析时间字符串 (格式: HH:MM:SS)
        start_time_parts = meeting['start_time'].split(':')
        end_time_parts = meeting['end_time'].split(':')
        start_time = time(int(start_time_parts[0]), int(start_time_parts[1]), int(start_time_parts[2]))
        end_time = time(int(end_time_parts[0]), int(end_time_parts[1]), int(end_time_parts[2]))
        #(start_date, end_date, start_time, end_time)
        
        dtstart = PACIFIC_TZ.localize(datetime.combine(start_date, start_time))
        dtend = PACIFIC_TZ.localize(datetime.combine(start_date, end_time))  # Assuming same day, adjust if not
        
        # For repeating events
        rrule = {
            'freq': 'weekly',
            'until': PACIFIC_TZ.localize(end_date)+timedelta(days=1),
            'byday': weekdays_to_rrule_days(meeting['WEEKDAYS'])
        }
        
        summary = f"{status_prefix}{get_subject_code(html_content, crn)} {get_course_number(html_content, crn)} {get_section_number(html_content, crn)} - {meeting['TYPE']} ({crn})"
        uid = generate_uid(summary, dtstart)
        create_event(cal, summary, description, dtstart, dtend, location=meeting['LOCATION'], rrule=rrule, uid=uid)

def add_drop_date_event(cal: Calendar, html_content: str, crn: str, status_prefix: str = None):
    """Add full-day event for drop date."""
    if status_prefix is None:
        status_prefix = get_status_prefix(html_content, crn)
    
    course_number = get_course_number(html_content, crn)
    desc = get_description(html_content, crn)
    desc = re.sub(r'\+', '', desc)
    instructors = get_instructors(html_content, crn)
    meetings_list = get_meetings(html_content, crn)
    formatted_instructors = format_instructors(instructors)
    ge3credit = get_ge3credit(html_content, crn)
    description = ""
    if ge3credit:
        description += f"GE: {ge3credit}\n "
    if formatted_instructors:
        description += f"{formatted_instructors}\n "
    drop_date_str = get_drop_date(html_content, crn)
    if drop_date_str:
        try:
            drop_date = datetime.fromisoformat(drop_date_str).date()
            dtstart = drop_date
            dtend = drop_date + timedelta(days=1)
            summary = f"{status_prefix}{get_subject_code(html_content, crn)} {get_course_number(html_content, crn)} {get_section_number(html_content, crn)} - Drop Date ({crn})"
            uid = generate_uid(summary, dtstart)
            create_event(cal, summary, description, dtstart, dtend, uid=uid, alarm=False)
        except ValueError:
            print(f"Invalid drop date format for CRN {crn}: {drop_date_str}")

def add_final_exam_event(cal: Calendar, html_content: str, crn: str, status_prefix: str = None):
    """Add full-day event for final exam with details in description."""
    if status_prefix is None:
        status_prefix = get_status_prefix(html_content, crn)
    
    course_number = get_course_number(html_content, crn)
    desc = get_description(html_content, crn)
    desc = re.sub(r'\\+', '', desc)
    instructors = get_instructors(html_content, crn)
    meetings_list = get_meetings(html_content, crn)
    formatted_instructors = format_instructors(instructors)
    ge3credit = get_ge3credit(html_content, crn)
    clean_desc = desc.replace('\n', '; ')
    if ge3credit:
        clean_desc += f"; GE3 Credit: {ge3credit}"
    description = f"{clean_desc}; {formatted_instructors}"
    
    final_start_str = get_final_exam_startdate(html_content, crn)
    if final_start_str:
        # 解析日期时间字符串 (格式: YYYY-MM-DD HH:MM:SS)
        dtstart = datetime.strptime(final_start_str, '%Y-%m-%d %H:%M:%S')
        dtstart = PACIFIC_TZ.localize(dtstart) if not dtstart.tzinfo else dtstart
        dtend = dtstart + timedelta(hours=2)
        
        summary = f"Final Exam for {status_prefix}{get_subject_code(html_content, crn)} {get_course_number(html_content, crn)} {get_section_number(html_content, crn)} ({crn})"
        description = f"{desc}\n{formatted_instructors}"
        uid = generate_uid(summary, dtstart)
        create_event(cal, summary, description, dtstart, dtend, alarm=True, uid=uid)

def generate_ics(directory: str = '.'):
    """Main function to generate ICS file."""
    cal = Calendar()
    cal.add('prodid', '-//UCDavis Course Calendar//EN')
    cal.add('version', '2.0')
    
    html_files = parse_html_files(directory)
    if not html_files:
        print("No HTML files found.")
        return
    
    # Compute output_file using first HTML
    first_html_path = html_files[0]
    html_content = load_html_content(first_html_path)
    student_name = extract_student_name(html_content)
    student_id = extract_student_id(html_content)
    registered_crns = extract_registered_crns(html_content)
    waitlisted_crns = extract_waitlisted_crns(html_content)
    all_crns = registered_crns + waitlisted_crns
    term = ""
    if all_crns:
        first_crn = all_crns[0]
        term = get_course_materials_term(html_content, first_crn) or ""
    
    combined = student_name + student_id + term
    encrypted = encrypt(combined, "Goodluck")
    output_file = f"{encrypted}.ics"
    
    # Process all HTML files
    for html_path in html_files:
        html_content = load_html_content(html_path)
        
        registered_crns = extract_registered_crns(html_content)
        waitlisted_crns = extract_waitlisted_crns(html_content)
        all_crns = set(registered_crns + waitlisted_crns)
        
        for crn in all_crns:
            add_meeting_events(cal, html_content, crn)
            add_drop_date_event(cal, html_content, crn)
            add_final_exam_event(cal, html_content, crn)
    
    ics_content = cal.to_ical().decode('utf-8')
    lines = ics_content.splitlines()
    new_lines = []
    for line in lines:
        if line.startswith('BEGIN:VEVENT'):
            new_lines.append('')
        new_lines.append(line)
    # ICS 标准要求使用 CRLF 作为行尾
    ics_content = '\r\n'.join(new_lines).encode('utf-8')
    with open(output_file, 'wb') as f:
        f.write(ics_content)
    print(f"ICS file generated: {output_file}")

def generate_ics_from_html_content(html_content: str) -> str:
    """从HTML内容直接生成ICS文件内容"""
    cal = Calendar()
    cal.add('prodid', '-//UCDavis Course Calendar//EN')
    cal.add('version', '2.0')
    
    try:
        # 提取学生信息
        student_name = extract_student_name(html_content)
        student_id = extract_student_id(html_content)
        
        # 提取课程信息
        registered_crns = extract_registered_crns(html_content)
        waitlisted_crns = extract_waitlisted_crns(html_content)
        all_crns = registered_crns + waitlisted_crns
        
        if not all_crns:
            return None
        
        # 获取学期信息
        term = ""
        if all_crns:
            first_crn = all_crns[0]
            term = get_course_materials_term(html_content, first_crn) or ""
        
        # 为每个CRN添加事件
        for crn in all_crns:
            add_meeting_events(cal, html_content, crn)
            add_drop_date_event(cal, html_content, crn)
            add_final_exam_event(cal, html_content, crn)
        
        # 生成ICS内容
        ics_content = cal.to_ical().decode('utf-8')
        # ICS 标准要求使用 CRLF 作为行尾
        # icalendar 库已经使用 CRLF，但 splitlines() 会移除行尾
        # 我们需要确保使用 CRLF 重新组合
        lines = ics_content.splitlines()
        new_lines = []
        for line in lines:
            if line.startswith('BEGIN:VEVENT'):
                new_lines.append('')
            new_lines.append(line)
        ics_content = '\r\n'.join(new_lines)
        
        return ics_content
        
    except Exception as e:
        print(f"生成ICS文件时发生错误: {str(e)}")
        return None

def parse_courses_info(html_content: str, include_all: bool = False) -> List[Dict]:
    """
    Parse HTML content and return structured course information.
    This function extracts course details without generating ICS content.
    
    Args:
        html_content: The HTML content to parse
        include_all: If True, include all courses in SavedSchedulesListDisplayContainer
                    (including not registered courses). If False, only include 
                    registered and waitlisted courses.
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Extract registered and waitlisted CRNs
        registered_crns = extract_registered_crns(html_content)
        waitlisted_crns = extract_waitlisted_crns(html_content)
        
        if include_all:
            # 获取所有在 Schedule 中的课程（包括未注册的）
            schedule_crns_info = extract_schedule_crns(html_content)
            all_crns = list(schedule_crns_info.keys())
        else:
            # 只获取已注册和等待列表的课程
            all_crns = registered_crns + waitlisted_crns
            schedule_crns_info = {}
        
        courses_info = []
        
        for crn in all_crns:
            try:
                # 确定课程状态
                if include_all and crn in schedule_crns_info:
                    # 使用 schedule_crns_info 中的状态信息
                    crn_info = schedule_crns_info[crn]
                    status = crn_info.get('display_status', 'Not Registered')
                    is_registered = crn_info.get('is_registered', False)
                    is_waitlisted = crn_info.get('is_waitlisted', False)
                    is_planned = crn_info.get('is_planned', False)
                    planned_status = crn_info.get('planned_status', '')
                else:
                    # 使用传统方法
                    if crn in registered_crns:
                        status = 'Registered'
                        is_registered = True
                        is_waitlisted = False
                    elif crn in waitlisted_crns:
                        status = 'Waitlisted'
                        is_registered = False
                        is_waitlisted = True
                    else:
                        status = 'Not Registered'
                        is_registered = False
                        is_waitlisted = False
                    is_planned = False
                    planned_status = ''
                
                # Extract course information
                course_info = {
                    'crn': crn,
                    'status': status,
                    'is_registered': is_registered,
                    'is_waitlisted': is_waitlisted,
                    'is_planned': is_planned,
                    'planned_status': planned_status,
                    'subject_code': get_subject_code(html_content, crn),
                    'course_number': get_course_number(html_content, crn),
                    'section_number': get_section_number(html_content, crn),
                    'title': get_title(html_content, crn),
                    'description': get_description(html_content, crn),
                    'units': get_units(html_content, crn),
                    'instructors': get_instructors(html_content, crn),
                    'meetings': get_meetings(html_content, crn),
                    'drop_date': get_drop_date(html_content, crn),
                    'final_exam_startdate': get_final_exam_startdate(html_content, crn),
                    'ge3credit': get_ge3credit(html_content, crn),
                    'course_materials_term': get_course_materials_term(html_content, crn)
                }
                
                # Format meetings for display
                if course_info['meetings']:
                    formatted_meetings = []
                    for meeting in course_info['meetings']:
                        if all(key in meeting for key in ['TYPE', 'WEEKDAYS', 'start_time', 'end_time', 'LOCATION', 'start_date', 'end_date']):
                            formatted_meeting = {
                                'type': meeting['TYPE'],
                                'days': meeting['WEEKDAYS'].replace(',', ', '),
                                'time': f"{meeting['start_time'][:-3]}-{meeting['end_time'][:-3]}",
                                'location': meeting['LOCATION'],
                                'dates': f"{meeting['start_date']} to {meeting['end_date']}"
                            }
                            formatted_meetings.append(formatted_meeting)
                    course_info['formatted_meetings'] = formatted_meetings
                else:
                    course_info['formatted_meetings'] = []
                
                # Format instructors for display
                if course_info['instructors']:
                    formatted_instructors = []
                    for instructor in course_info['instructors']:
                        formatted_instructor = {
                            'name': f"{instructor.get('first_name', '')} {instructor.get('last_name', '')}",
                            'email': instructor.get('email', 'N/A')
                        }
                        formatted_instructors.append(formatted_instructor)
                    course_info['formatted_instructors'] = formatted_instructors
                else:
                    course_info['formatted_instructors'] = []
                
                courses_info.append(course_info)
                
            except Exception as e:
                print(f"Error parsing course {crn}: {str(e)}")
                continue
        
        # 按状态排序：Registered > Waitlisted > Planned > Not Registered
        status_order = {'Registered': 0, 'Waitlisted': 1}
        courses_info.sort(key=lambda x: (
            status_order.get(x['status'], 2 if 'Planned' in x['status'] else 3),
            x['subject_code'],
            x['course_number']
        ))
        
        return courses_info
        
    except Exception as e:
        print(f"Error parsing HTML content: {str(e)}")
        return []

def generate_ics_for_course(html_content: str, crn: str) -> str:
    """
    Generate ICS content for a specific course.
    """
    try:
        cal = Calendar()
        cal.add('prodid', '-//Richis//EN')
        cal.add('version', '2.0')
        cal.add('calscale', 'GREGORIAN')
        cal.add('method', 'PUBLISH')
        cal.add('x-wr-calname', 'UC Davis Courses')
        cal.add('x-wr-caldesc', 'UC Davis Course Schedule')
        cal.add('x-wr-timezone', 'America/Los_Angeles')
        
        # Add events for this specific course
        add_meeting_events(cal, html_content, crn)
        add_drop_date_event(cal, html_content, crn)
        add_final_exam_event(cal, html_content, crn)
        
        # ICS 标准要求使用 CRLF 作为行尾
        ics_content = cal.to_ical().decode('utf-8')
        # 确保使用 CRLF 行尾
        ics_content = ics_content.replace('\r\n', '\n').replace('\n', '\r\n')
        return ics_content
        
    except Exception as e:
        print(f"Error generating ICS for course {crn}: {str(e)}")
        return ""

if __name__ == "__main__":
    generate_ics(directory='.') 