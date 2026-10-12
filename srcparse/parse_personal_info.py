from bs4 import BeautifulSoup

def extract_student_name(html_content: str) -> str:
    """
    使用BeautifulSoup解析HTML内容，查找id为'student_name_id'的div标签，提取文本并分割获取学生名字。
    """
    soup = BeautifulSoup(html_content, 'html.parser')  # 解析HTML内容
    div = soup.find(id='student_name_id')  # 查找指定id的div
    if div:
        text = div.text.strip()  # 获取并清理文本
        name = text.split(' - ')[0] if ' - ' in text else ''  # 分割文本获取名字部分
        return name
    return ''  # 如果未找到，返回空字符串

def extract_student_id(html_content: str) -> str:
    """
    使用BeautifulSoup解析HTML内容，查找id为'student_name_id'的div标签，提取文本并分割获取学生学号。
    """
    soup = BeautifulSoup(html_content, 'html.parser')  # 解析HTML内容
    div = soup.find(id='student_name_id')  # 查找指定id的div
    if div:
        text = div.text.strip()  # 获取并清理文本
        student_id = text.split(' - ')[1] if ' - ' in text and len(text.split(' - ')) > 1 else ''  # 分割文本获取学号部分
        return student_id
    return ''  # 如果未找到，返回空字符串

# 示例用法：在脚本底部
if __name__ == "__main__":
    with open("2501.html", "r", encoding="utf-8") as f:  # 打开并读取HTML文件（假设使用当前打开的文件）
        html_content = f.read()  # 读取文件内容
    name = extract_student_name(html_content)  # 提取学生名字
    print("学生名字：", name)  # 打印学生名字
    student_id = extract_student_id(html_content)  # 提取学生学号
    print("学生学号：", student_id)  # 打印学生学号 