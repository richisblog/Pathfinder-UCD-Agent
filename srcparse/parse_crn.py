import re
from bs4 import BeautifulSoup

def extract_crns(html_content: str) -> list[str]:
    """
    使用BeautifulSoup解析HTML内容，查找所有<script>标签，然后使用正则表达式提取CourseDetails.t后跟的5位数字CRN代码，使用集合去重，最后排序返回列表。
    """
    soup = BeautifulSoup(html_content, 'html.parser')  # 解析HTML内容
    crns = set()  # 使用集合存储CRN以自动去重
    for script in soup.find_all('script'):  # 遍历所有<script>标签
        matches = re.findall(r'CourseDetails\.t(\d{5})', script.text)  # 使用正则匹配CourseDetails.tXXXXX图案，提取XXXXX
        crns.update(matches)  # 添加到集合中，去重
    return sorted(list(crns))  # 转换为排序列表返回

def extract_registered_crns(html_content: str) -> list[str]:
    """
    使用BeautifulSoup解析HTML内容，查找所有<script>标签，然后使用正则表达式提取CourseDetails.t后跟的5位数字CRN代码，其中REGISTRATION_STATUS为"Registered"，使用集合去重，最后排序返回列表。
    """
    soup = BeautifulSoup(html_content, 'html.parser')  # 解析HTML内容
    crns = set()  # 使用集合存储CRN以自动去重
    for script in soup.find_all('script'):  # 遍历所有<script>标签
        matches = re.findall(r'CourseDetails\.t(\d{5})\.REGISTRATION_STATUS\s*=\s*"Registered";', script.text)  # 使用正则匹配CourseDetails.tXXXXX.REGISTRATION_STATUS = "Registered";
        crns.update(matches)  # 添加到集合中，去重
    return sorted(list(crns))  # 转换为排序列表返回

def extract_waitlisted_crns(html_content: str) -> list[str]:
    """
    使用BeautifulSoup解析HTML内容，查找所有<script>标签，然后使用正则表达式提取CourseDetails.t后跟的5位数字CRN代码，其中REGISTRATION_STATUS为"Waitlisted"，使用集合去重，最后排序返回列表。
    """
    soup = BeautifulSoup(html_content, 'html.parser')  # 解析HTML内容
    crns = set()  # 使用集合存储CRN以自动去重
    for script in soup.find_all('script'):  # 遍历所有<script>标签
        matches = re.findall(r'CourseDetails\.t(\d{5})\.REGISTRATION_STATUS\s*=\s*"Waitlisted";', script.text)  # 使用正则匹配CourseDetails.tXXXXX.REGISTRATION_STATUS = "Waitlisted";
        crns.update(matches)  # 添加到集合中，去重
    return sorted(list(crns))  # 转换为排序列表返回


def extract_schedule_crns(html_content: str) -> dict:
    """
    从 SavedSchedulesListDisplayContainer 中提取所有课程的 CRN，
    包括 Registered、Waitlisted 和未注册的课程。
    
    返回一个字典，包含每个 CRN 的注册状态和计划状态。
    优先使用 CourseDetails 中的 REGISTRATION_STATUS（最新状态）。
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    crns_info = {}
    
    # 首先从 CourseDetails 中提取最新的 REGISTRATION_STATUS
    # 这些是通过 CourseDetails.tXXXXX.REGISTRATION_STATUS = "XXX" 赋值的
    course_details_status = {}
    for script in soup.find_all('script'):
        script_text = script.text
        # 匹配 CourseDetails.tXXXXX.REGISTRATION_STATUS = "XXX";
        status_matches = re.findall(
            r'CourseDetails\.t(\d{5})\.REGISTRATION_STATUS\s*=\s*"([^"]*)"\s*;',
            script_text
        )
        for crn, status in status_matches:
            course_details_status[crn] = status
    
    # 从 Schedules 数组中提取所有 CRN（包括未注册的）
    for script in soup.find_all('script'):
        script_text = script.text
        
        # 匹配 Schedules[...].SelectedList.tXXXXX 模式
        schedule_matches = re.findall(
            r'Schedules\[Schedules\.length\s*-\s*1\]\.SelectedList\.t(\d{5})\s*=\s*\{([^}]+)\}',
            script_text,
            re.DOTALL
        )
        
        for crn, obj_content in schedule_matches:
            if crn not in crns_info:
                # 提取 STORED_REGISTRATION_STATUS（缓存状态，可能是旧的）
                status_match = re.search(r'"STORED_REGISTRATION_STATUS"\s*:\s*"([^"]*)"', obj_content)
                stored_status = status_match.group(1) if status_match else ""
                
                # 提取 PLANNED_STATUS
                planned_match = re.search(r'"PLANNED_STATUS"\s*:\s*"([^"]*)"', obj_content)
                planned_status = planned_match.group(1) if planned_match else ""
                
                # 优先使用 CourseDetails 中的最新状态
                actual_status = course_details_status.get(crn, stored_status)
                
                # 确定显示状态
                is_registered = actual_status == "Registered"
                is_waitlisted = actual_status == "Waitlisted"
                
                if is_registered:
                    display_status = "Registered"
                elif is_waitlisted:
                    display_status = "Waitlisted"
                elif planned_status:
                    display_status = f"Planned ({planned_status})"
                else:
                    display_status = "Not Registered"
                
                crns_info[crn] = {
                    'crn': crn,
                    'stored_registration_status': stored_status,
                    'actual_registration_status': actual_status,
                    'planned_status': planned_status,
                    'display_status': display_status,
                    'is_registered': is_registered,
                    'is_waitlisted': is_waitlisted,
                    'is_planned': bool(planned_status) and not is_registered and not is_waitlisted
                }
    
    return crns_info


def extract_all_schedule_crns(html_content: str) -> list[str]:
    """
    从 SavedSchedulesListDisplayContainer 中提取所有课程的 CRN 列表。
    包括 Registered、Waitlisted 和未注册的课程。
    """
    crns_info = extract_schedule_crns(html_content)
    return sorted(list(crns_info.keys()))


# 示例用法：在脚本底部
if __name__ == "__main__":
    with open("2501.html", "r", encoding="utf-8") as f:  # 打开并读取HTML文件
        html_content = f.read()  # 读取文件内容
    all_crns = extract_crns(html_content)  # 调用函数提取所有CRN
    print("所有唯一的CRN代码（排序后）：", all_crns)  # 打印所有唯一的CRN代码列表
    registered_crns = extract_registered_crns(html_content)  # 调用函数提取已注册的CRN
    print("已注册的CRN代码（排序后）：", registered_crns)  # 打印已注册的CRN代码列表
    waitlisted_crns = extract_waitlisted_crns(html_content)  # 调用函数提取等待列表的CRN
    print("等待列表的CRN代码（排序后）：", waitlisted_crns)  # 打印等待列表的CRN代码列表