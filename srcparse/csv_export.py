import csv
import os
import uuid
from typing import List, Dict
from datetime import datetime

def export_courses_to_csv(courses_info: List[Dict], output_dir: str = None) -> str:
    """
    将课程信息导出为CSV格式
    
    Args:
        courses_info: 课程信息列表
        output_dir: 输出目录，如果为None则使用当前目录
    
    Returns:
        str: 生成的CSV文件路径
    """
    if not courses_info:
        raise ValueError("没有课程信息可导出")
    
    # 生成唯一的文件名
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"ucdavis_courses_{timestamp}.csv"
    
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, filename)
    else:
        filepath = filename
    
    # 定义CSV列头
    fieldnames = [
        'CRN',
        'Status',
        'Subject Code',
        'Course Number',
        'Section Number',
        'Course Title',
        'Units',
        'Description',
        'Instructor Name',
        'Instructor Email',
        'Meeting Type',
        'Meeting Days',
        'Meeting Time',
        'Meeting Location',
        'Meeting Dates',
        'Drop Date',
        'Final Exam Date',
        'GE Credits',
        'Course Materials Term'
    ]
    
    with open(filepath, 'w', newline='', encoding='utf-8-sig') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        for course in courses_info:
            # 处理教师信息
            instructor_names = []
            instructor_emails = []
            if course.get('formatted_instructors'):
                for instructor in course['formatted_instructors']:
                    instructor_names.append(instructor.get('name', ''))
                    instructor_emails.append(instructor.get('email', ''))
            
            # 处理会议信息
            meeting_types = []
            meeting_days = []
            meeting_times = []
            meeting_locations = []
            meeting_dates = []
            if course.get('formatted_meetings'):
                for meeting in course['formatted_meetings']:
                    meeting_types.append(meeting.get('type', ''))
                    meeting_days.append(meeting.get('days', ''))
                    meeting_times.append(meeting.get('time', ''))
                    meeting_locations.append(meeting.get('location', ''))
                    meeting_dates.append(meeting.get('dates', ''))
            
            # 写入课程信息
            row = {
                'CRN': course.get('crn', ''),
                'Status': course.get('status', ''),
                'Subject Code': course.get('subject_code', ''),
                'Course Number': course.get('course_number', ''),
                'Section Number': course.get('section_number', ''),
                'Course Title': course.get('title', ''),
                'Units': course.get('units', ''),
                'Description': course.get('description', '').replace('\n', ' ').replace('\r', ' '),
                'Instructor Name': '; '.join(instructor_names),
                'Instructor Email': '; '.join(instructor_emails),
                'Meeting Type': '; '.join(meeting_types),
                'Meeting Days': '; '.join(meeting_days),
                'Meeting Time': '; '.join(meeting_times),
                'Meeting Location': '; '.join(meeting_locations),
                'Meeting Dates': '; '.join(meeting_dates),
                'Drop Date': course.get('drop_date', ''),
                'Final Exam Date': course.get('final_exam_startdate', ''),
                'GE Credits': course.get('ge3credit', ''),
                'Course Materials Term': course.get('course_materials_term', '')
            }
            
            writer.writerow(row)
    
    return filepath

def export_detailed_courses_to_csv(courses_info: List[Dict], output_dir: str = None) -> str:
    """
    将课程信息导出为详细的CSV格式，每个会议单独一行
    
    Args:
        courses_info: 课程信息列表
        output_dir: 输出目录，如果为None则使用当前目录
    
    Returns:
        str: 生成的CSV文件路径
    """
    if not courses_info:
        raise ValueError("没有课程信息可导出")
    
    # 生成唯一的文件名
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"ucdavis_courses_detailed_{timestamp}.csv"
    
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, filename)
    else:
        filepath = filename
    
    # 定义CSV列头
    fieldnames = [
        'CRN',
        'Status',
        'Subject Code',
        'Course Number',
        'Section Number',
        'Course Title',
        'Units',
        'Description',
        'Instructor Name',
        'Instructor Email',
        'Meeting Type',
        'Meeting Days',
        'Meeting Time',
        'Meeting Location',
        'Meeting Dates',
        'Drop Date',
        'Final Exam Date',
        'GE Credits',
        'Course Materials Term'
    ]
    
    with open(filepath, 'w', newline='', encoding='utf-8-sig') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        for course in courses_info:
            # 处理教师信息
            instructor_names = []
            instructor_emails = []
            if course.get('formatted_instructors'):
                for instructor in course['formatted_instructors']:
                    instructor_names.append(instructor.get('name', ''))
                    instructor_emails.append(instructor.get('email', ''))
            
            # 如果没有会议信息，至少写入一行课程基本信息
            if not course.get('formatted_meetings'):
                row = {
                    'CRN': course.get('crn', ''),
                    'Status': course.get('status', ''),
                    'Subject Code': course.get('subject_code', ''),
                    'Course Number': course.get('course_number', ''),
                    'Section Number': course.get('section_number', ''),
                    'Course Title': course.get('title', ''),
                    'Units': course.get('units', ''),
                    'Description': course.get('description', '').replace('\n', ' ').replace('\r', ' '),
                    'Instructor Name': '; '.join(instructor_names),
                    'Instructor Email': '; '.join(instructor_emails),
                    'Meeting Type': '',
                    'Meeting Days': '',
                    'Meeting Time': '',
                    'Meeting Location': '',
                    'Meeting Dates': '',
                    'Drop Date': course.get('drop_date', ''),
                    'Final Exam Date': course.get('final_exam_startdate', ''),
                    'GE Credits': course.get('ge3credit', ''),
                    'Course Materials Term': course.get('course_materials_term', '')
                }
                writer.writerow(row)
            else:
                # 为每个会议写入一行
                for meeting in course['formatted_meetings']:
                    row = {
                        'CRN': course.get('crn', ''),
                        'Status': course.get('status', ''),
                        'Subject Code': course.get('subject_code', ''),
                        'Course Number': course.get('course_number', ''),
                        'Section Number': course.get('section_number', ''),
                        'Course Title': course.get('title', ''),
                        'Units': course.get('units', ''),
                        'Description': course.get('description', '').replace('\n', ' ').replace('\r', ' '),
                        'Instructor Name': '; '.join(instructor_names),
                        'Instructor Email': '; '.join(instructor_emails),
                        'Meeting Type': meeting.get('type', ''),
                        'Meeting Days': meeting.get('days', ''),
                        'Meeting Time': meeting.get('time', ''),
                        'Meeting Location': meeting.get('location', ''),
                        'Meeting Dates': meeting.get('dates', ''),
                        'Drop Date': course.get('drop_date', ''),
                        'Final Exam Date': course.get('final_exam_startdate', ''),
                        'GE Credits': course.get('ge3credit', ''),
                        'Course Materials Term': course.get('course_materials_term', '')
                    }
                    writer.writerow(row)
    
    return filepath

def export_student_info_to_csv(student_name: str, student_id: str, courses_info: List[Dict], output_dir: str = None) -> str:
    """
    导出学生信息和课程摘要到CSV
    
    Args:
        student_name: 学生姓名
        student_id: 学生ID
        courses_info: 课程信息列表
        output_dir: 输出目录
    
    Returns:
        str: 生成的CSV文件路径
    """
    # 生成唯一的文件名
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"student_summary_{timestamp}.csv"
    
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, filename)
    else:
        filepath = filename
    
    # 计算统计信息
    total_courses = len(courses_info)
    registered_courses = len([c for c in courses_info if c.get('status') == 'Registered'])
    waitlisted_courses = len([c for c in courses_info if c.get('status') == 'Waitlisted'])
    total_units = sum(float(c.get('units', 0)) for c in courses_info if c.get('units'))
    
    # 按学科分组
    subject_groups = {}
    for course in courses_info:
        subject = course.get('subject_code', 'Unknown')
        if subject not in subject_groups:
            subject_groups[subject] = []
        subject_groups[subject].append(course)
    
    with open(filepath, 'w', newline='', encoding='utf-8-sig') as csvfile:
        # 写入学生信息
        csvfile.write("Student Information Summary\n")
        csvfile.write(f"Name,{student_name}\n")
        csvfile.write(f"Student ID,{student_id}\n")
        csvfile.write(f"Export Time,{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        csvfile.write("\n")
        
        # 写入统计信息
        csvfile.write("Course Statistics\n")
        csvfile.write(f"Total Courses,{total_courses}\n")
        csvfile.write(f"Registered Courses,{registered_courses}\n")
        csvfile.write(f"Waitlisted Courses,{waitlisted_courses}\n")
        csvfile.write(f"Total Units,{total_units}\n")
        csvfile.write("\n")
        
        # 写入学科分组信息
        csvfile.write("By Subject Group\n")
        csvfile.write("Subject Code,Course Count\n")
        for subject, courses in subject_groups.items():
            csvfile.write(f"{subject},{len(courses)}\n")
        csvfile.write("\n")
        
        # 写入详细课程信息
        csvfile.write("Detailed Course Information\n")
        fieldnames = [
            'CRN',
            'Status',
            'Subject Code',
            'Course Number',
            'Section Number',
            'Course Title',
            'Units',
            'Instructor Name',
            'Meeting Time',
            'Meeting Location'
        ]
        
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        for course in courses_info:
            # 处理教师信息
            instructor_names = []
            if course.get('formatted_instructors'):
                for instructor in course['formatted_instructors']:
                    instructor_names.append(instructor.get('name', ''))
            
            # 处理会议信息
            meeting_times = []
            meeting_locations = []
            if course.get('formatted_meetings'):
                for meeting in course['formatted_meetings']:
                    meeting_times.append(meeting.get('time', ''))
                    meeting_locations.append(meeting.get('location', ''))
            
            row = {
                'CRN': course.get('crn', ''),
                'Status': course.get('status', ''),
                'Subject Code': course.get('subject_code', ''),
                'Course Number': course.get('course_number', ''),
                'Section Number': course.get('section_number', ''),
                'Course Title': course.get('title', ''),
                'Units': course.get('units', ''),
                'Instructor Name': '; '.join(instructor_names),
                'Meeting Time': '; '.join(meeting_times),
                'Meeting Location': '; '.join(meeting_locations)
            }
            
            writer.writerow(row)
    
    return filepath 