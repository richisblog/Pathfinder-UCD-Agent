import re
from datetime import date
from datetime import datetime
from datetime import timedelta

def extract_value(html_content, crn, key):
    """
    从HTML文件中提取指定CRN的课程详细信息中的特定键值。
    使用正则表达式匹配CourseDetails.t + CRN的对象，并提取指定键的值。
    对于DROP_DATE，特殊处理日期格式。
    """
    text = html_content  # 使用传入的HTML内容
    
    pattern = r'CourseDetails\.t' + re.escape(str(crn)) + r'\s*=\s*\{(.*?)\}\s*;'  # 定义匹配CourseDetails.tXXXXX的正则模式
    match = re.search(pattern, text, re.DOTALL)  # 使用正则搜索匹配内容
    if not match:
        return None
    content = match.group(1)  # 获取匹配的内容
    
    if key == "DROP_DATE":
        date_match = re.search(r'"DROP_DATE":new Date\((\d+),\((\d+) - 1\),(\d+),0,0,0\)', content)  # 特殊匹配日期格式
        if date_match:
            year = int(date_match.group(1))
            month = int(date_match.group(2))
            day = int(date_match.group(3))
            return date(year, month, day).isoformat()  # 返回ISO格式的日期 'YYYY-MM-DD'
        return None
    elif key == "FINAL_EXAM_STARTDATE":
        date_match = re.search(r'"FINAL_EXAM_STARTDATE":new Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)', content)  # 特殊匹配期末考试日期和时间格式
        if date_match:
            year = int(date_match.group(1))
            month_index = int(date_match.group(2))
            day = int(date_match.group(3))
            hour = int(date_match.group(4))
            minute = int(date_match.group(5))
            second = int(date_match.group(6))
            dt = datetime(year, month_index + 1, day, hour, minute, second)
            return dt.strftime('%Y-%m-%d %H:%M:%S')  # 返回友好的日期时间格式 'YYYY-MM-DD HH:MM:SS'
        return None
    else:
        value_match = re.search(r'"' + re.escape(key) + r'":"(.*?)"', content, re.DOTALL)  # 匹配指定键的值
        if value_match:
            return value_match.group(1)  # 返回提取的值
        return None

def get_crn(html_content, crn):
    """
    返回课程的CRN。
    """
    return extract_value(html_content, crn, "CRN")  # 调用提取函数获取CRN

def get_title(html_content, crn):
    """
    返回课程的标题。
    """
    return extract_value(html_content, crn, "TITLE")  # 调用提取函数获取标题

def get_subject_code(html_content, crn):
    """
    返回课程的学科代码。
    """
    return extract_value(html_content, crn, "SUBJECT_CODE")  # 调用提取函数获取学科代码

def get_course_number(html_content, crn):
    """
    返回课程编号。
    """
    return extract_value(html_content, crn, "COURSE_NUMBER")  # 调用提取函数获取课程编号

def get_section_number(html_content, crn):
    """
    返回课程的部分编号。
    """
    return extract_value(html_content, crn, "SECTION_NUMBER")  # 调用提取函数获取部分编号

def get_description(html_content, crn):
    """
    返回课程描述。
    """
    return extract_value(html_content, crn, "DESCRIPTION")  # 调用提取函数获取描述

def get_units(html_content, crn):
    """
    返回课程学分。
    """
    return extract_value(html_content, crn, "UNITS")  # 调用提取函数获取学分

def get_course_materials_term(html_content, crn):
    """
    返回课程材料学期。
    """
    return extract_value(html_content, crn, "COURSE_MATERIALS_TERM")  # 调用提取函数获取材料学期

def get_drop_date(html_content, crn):
    """
    返回课程的最后退课日期。
    """
    return extract_value(html_content, crn, "DROP_DATE")  # 调用提取函数获取退课日期

def get_ge3credit(html_content, crn):
    """
    返回GE3学分信息。
    """
    return extract_value(html_content, crn, "GE3CREDIT")  # 调用提取函数获取GE3学分

def get_final_exam_startdate(html_content, crn):
    """
    返回课程的期末考试开始日期和时间。
    """
    return extract_value(html_content, crn, "FINAL_EXAM_STARTDATE")  # 调用提取函数获取期末考试开始日期
 
def get_meetings(html_content, crn):
    """
    返回课程的所有会议信息列表，每个会议是一个字典，包含类型、位置、周几、开始日期、开始时间、结束日期、结束时间（ISO格式）。
    """
    text = html_content  # 使用传入的HTML内容
    
    pattern = r'CourseDetails\.t' + re.escape(str(crn)) + r'\s*=\s*\{(.*?)\}\s*;'  # 定义匹配CourseDetails.tXXXXX的正则模式
    match = re.search(pattern, text, re.DOTALL)  # 使用正则搜索匹配内容
    if not match:
        return []
    content = match.group(1)
    
    meetings_pattern = r'"MEETINGS":\[(.*?)\]'  # 匹配MEETINGS数组
    meetings_match = re.search(meetings_pattern, content, re.DOTALL)
    if not meetings_match:
        return []
    meetings_str = meetings_match.group(1).strip()
    
    # 使用findall提取每个{...}对象的内容
    meeting_contents = re.findall(r'\{(.*?)\}', meetings_str, re.DOTALL)
    meetings = []
    for obj in meeting_contents:
        obj = obj.strip().strip('{').strip('}').strip()  # 清理
        if not obj:
            continue
        meeting = {}
        # 提取键值
        type_match = re.search(r'"TYPE":"(.*?)"', obj)
        if type_match:
            meeting['TYPE'] = type_match.group(1)
        location_match = re.search(r'"LOCATION":"(.*?)"', obj)
        if location_match:
            meeting['LOCATION'] = location_match.group(1)
        weekdays_match = re.search(r'"WEEKDAYS":"(.*?)"', obj)
        if weekdays_match:
            meeting['WEEKDAYS'] = weekdays_match.group(1)
        # 解析STARTTIME
        start_match = re.search(r'"STARTTIME":new Date\((\d+),(\d+) - 1,(\d+),(\d+),(\d+),(\d+),(\d+)\)', obj)
        if start_match:
            year, month, day, hour, minute, second, _ = map(int, start_match.groups())
            start_dt = datetime(year, int(month), day, hour, minute, second)
            meeting['start_date'] = start_dt.date().isoformat()
            meeting['start_time'] = start_dt.strftime('%H:%M:%S')  # 使用友好的时间格式
        # 解析ENDTIME
        end_match = re.search(r'"ENDTIME":new Date\((\d+),(\d+) - 1,(\d+),(\d+),(\d+),(\d+),(\d+)\)', obj)
        if end_match:
            year, month, day, hour, minute, second, _ = map(int, end_match.groups())
            end_dt = datetime(year, int(month), day, hour, minute, second)
            meeting['end_date'] = end_dt.date().isoformat()
            meeting['end_time'] = end_dt.strftime('%H:%M:%S')  # 使用友好的时间格式
        # 计算实际第一节和最后一节课日期
        if 'WEEKDAYS' in meeting and meeting['WEEKDAYS'] and 'start_date' in meeting and 'end_date' in meeting:
            weekdays = meeting['WEEKDAYS']
            days_list = weekdays.split(',') if ',' in weekdays else list(weekdays)
            weekday_to_int = {'M': 0, 'T': 1, 'W': 2, 'R': 3, 'F': 4, 'S': 5, 'U': 6}
            target_weekdays = set(weekday_to_int.get(day, -1) for day in days_list if weekday_to_int.get(day, -1) != -1)
            if target_weekdays:
                # 计算实际start_date
                start_date = datetime.fromisoformat(meeting['start_date'])
                for i in range(8):
                    if start_date.weekday() in target_weekdays:
                        meeting['start_date'] = start_date.date().isoformat()
                        break
                    start_date += timedelta(days=1)
                # 计算实际end_date
                end_date = datetime.fromisoformat(meeting['end_date'])
        meetings.append(meeting)
    return meetings
 
def get_meeting_count(html_content, crn):
    """
    返回课程的会议数量。
    """
    return len(get_meetings(html_content, crn))  # 返回会议列表的长度
 
def get_meeting(html_content, crn, index):
    """
    返回指定索引的会议信息字典，如果索引无效则返回None。
    """
    meetings = get_meetings(html_content, crn)
    if 0 <= index < len(meetings):
        return meetings[index]
    return None
 
def get_instructors(html_content, crn):
    """
    返回课程的所有教授信息列表，每个教授是一个字典，包含名、姓和邮箱。
    """
    text = html_content  # 使用传入的HTML内容
    
    pattern = r'CourseDetails\.t' + re.escape(str(crn)) + r'\s*=\s*\{(.*?)\}\s*;'  # 定义匹配CourseDetails.tXXXXX的正则模式
    match = re.search(pattern, text, re.DOTALL)  # 使用正则搜索匹配内容
    if not match:
        return []
    content = match.group(1)
    
    instructors_pattern = r'"INSTRUCTORS":\[(.*?)\]'  # 匹配INSTRUCTORS数组
    instructors_match = re.search(instructors_pattern, content, re.DOTALL)
    if not instructors_match:
        return []
    instructors_str = instructors_match.group(1).strip()
    
    # 使用findall提取每个{...}对象的内容
    instructor_contents = re.findall(r'\{(.*?)\}', instructors_str, re.DOTALL)
    instructors = []
    for obj in instructor_contents:
        obj = obj.strip()  # 清理
        if not obj:
            continue
        instructor = {}
        # 提取键值
        first_name_match = re.search(r'"FIRST_NAME":"(.*?)"', obj)
        if first_name_match:
            instructor['first_name'] = first_name_match.group(1)
        last_name_match = re.search(r'"LAST_NAME":"(.*?)"', obj)
        if last_name_match:
            instructor['last_name'] = last_name_match.group(1)
        email_match = re.search(r'"EMAIL":"(.*?)"', obj)
        if email_match:
            instructor['email'] = email_match.group(1)
        instructors.append(instructor)
    return instructors
 
def get_instructor_count(html_content, crn):
    """
    返回课程的教授数量。
    """
    return len(get_instructors(html_content, crn))  # 返回教授列表的长度

# 示例用法：在脚本底部
if __name__ == "__main__":
    with open("2410.html", "r", encoding="utf-8") as f:
        html_content = f.read()
    example_crn = "28091"  # 示例CRN，基于提供的HTML片段
    print("CRN:", get_crn(html_content, example_crn))  # 打印CRN
    print("标题:", get_title(html_content, example_crn))  # 打印标题
    print("学科代码:", get_subject_code(html_content, example_crn))  # 打印学科代码
    print("课程编号:", get_course_number(html_content, example_crn))  # 打印课程编号
    print("部分编号:", get_section_number(html_content, example_crn))  # 打印部分编号
    print("描述:", get_description(html_content, example_crn))  # 打印描述
    print("学分:", get_units(html_content, example_crn))  # 打印学分
    print("材料学期:", get_course_materials_term(html_content, example_crn))  # 打印材料学期
    print("退课日期:", get_drop_date(html_content, example_crn))  # 打印退课日期
    print("GE3学分:", get_ge3credit(html_content, example_crn))  # 打印GE3学分
    print("期末考试开始日期:", get_final_exam_startdate(html_content, example_crn))  # 打印期末考试开始日期
    print("会议数量:", get_meeting_count(html_content, example_crn))  # 打印会议数量
    print("所有会议:", get_meetings(html_content, example_crn))  # 打印所有会议信息
    print("教授数量:", get_instructor_count(html_content, example_crn))  # 打印教授数量
    print("所有教授:", get_instructors(html_content, example_crn))  # 打印所有教授信息 