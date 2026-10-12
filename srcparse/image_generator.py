import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from typing import Dict, List
import textwrap
from datetime import datetime
import math

class CourseCardGenerator:
    def __init__(self):
        self.base_width = 1800
        self.base_height = 300
        self.background_color = (255, 255, 255)  # 白色背景
        self.primary_color = (0, 46, 93)  # UC Davis 蓝色 #002E5D
        self.accent_color = (255, 191, 0)  # UC Davis 金色 #FFBF00
        self.text_color = (51, 51, 51)  # 深灰色文字 #333
        self.secondary_text_color = (102, 102, 102)  # 浅灰色文字 #666
        self.corner_radius = 12  # 圆角半径，与网页一致
        self.card_padding = 80  # 增加卡片内边距
        self.content_padding = 60  # 内容区域额外内边距
        
    def create_course_card(self, course: Dict) -> Image.Image:
        """创建课程卡片图片"""
        # 计算动态高度
        total_height = self._calculate_required_height(course)
        self.width = self.base_width
        self.height = max(self.base_height, total_height)
        
        # 创建画布
        img = Image.new('RGB', (self.width, self.height), self.background_color)
        draw = ImageDraw.Draw(img)
        
        # 创建圆角遮罩
        mask = self._create_rounded_rectangle_mask(self.width, self.height, self.corner_radius)
        
        # 尝试加载字体，优先使用项目内的字体文件
        def load_font(font_name, size):
            """尝试加载字体，优先使用项目内的字体文件"""
            # 项目内字体文件路径
            font_paths = [
                os.path.join("static", "fonts", font_name),
                os.path.join("static", "fonts", font_name.lower()),
                os.path.join("static", "fonts", font_name.upper()),
                os.path.join("static", "fonts", "DejaVuSans.ttf"),  # Ubuntu默认字体
                os.path.join("static", "fonts", "LiberationSans-Regular.ttf"),  # 另一个常见字体
                os.path.join("static", "fonts", "arial.ttf"),
                os.path.join("static", "fonts", "Arial.ttf"),
                # 系统字体作为备选
                font_name,
                font_name.lower(),
                font_name.upper(),
                "DejaVuSans.ttf",
                "LiberationSans-Regular.ttf",
                "arial.ttf",
                "Arial.ttf"
            ]
            
            for font_path in font_paths:
                try:
                    return ImageFont.truetype(font_path, size)
                except:
                    continue
            
            # 如果所有字体都失败，使用默认字体
            return ImageFont.load_default()
        
        # 与网页字体大小比例保持一致 (网页字体大小 * 40)
        # 优先使用项目内的字体文件
        title_font = load_font("arial.ttf", 56)  # 1.4rem * 40
        subtitle_font = load_font("arial.ttf", 44)  # 1.1rem * 40
        body_font = load_font("arial.ttf", 40)  # 1rem * 40
        small_font = load_font("arial.ttf", 36)  # 0.9rem * 40
        tiny_font = load_font("arial.ttf", 32)  # 0.8rem * 40
        status_font = load_font("arial.ttf", 40)  # 状态标签字体
        # 标题字体 - 更大更粗
        header_font = load_font("arial.ttf", 52)  # 标题字体
        
        # 检查字体加载状态
        if title_font == ImageFont.load_default():
            print("警告：无法加载字体文件，使用默认字体")
            self.font_scale_factor = 1.0
        else:
            print("字体加载成功")
            self.font_scale_factor = 1.0
        
        # 创建透明背景
        img = Image.new('RGBA', (self.width, self.height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 绘制圆角背景
        self._draw_rounded_rectangle(draw, 0, 0, self.width, self.height, self.corner_radius, self.background_color)
        
        # 内容区域起始位置
        y_offset = self.card_padding + self.content_padding
        
        # 课程头部区域
        course_header_y = y_offset
        
        # 课程代码
        course_code = f"{course.get('subject_code', '')} {course.get('course_number', '')} - {course.get('section_number', '')}"
        draw.text((self.card_padding + self.content_padding, course_header_y), course_code, fill=self.primary_color, font=title_font)
        
        # CRN
        crn = f"CRN: {course.get('crn', '')}"
        draw.text((self.card_padding + self.content_padding, course_header_y + 80), crn, fill=self.secondary_text_color, font=small_font)
        
        # 状态标签 - 更大更居中
        status = course.get('status', '')
        status_color = (76, 175, 80) if status == 'Registered' else (255, 152, 0)  # #4CAF50 or #FF9800
        status_width = draw.textlength(status, font=status_font) + 40
        status_height = 60
        status_x = self.width - self.card_padding - self.content_padding - status_width
        status_y = course_header_y + 10
        self._draw_rounded_rectangle(draw, status_x, status_y, self.width - self.card_padding - self.content_padding, status_y + status_height, 8, status_color)
        # 文字居中
        status_text_x = status_x + (status_width - draw.textlength(status, font=status_font)) // 2
        status_text_y = status_y + (status_height - status_font.size) // 2
        draw.text((status_text_x, status_text_y), status, fill=(255, 255, 255), font=status_font)
        
        y_offset = course_header_y + 120
        
        # 课程标题
        title = course.get('title', '')
        draw.text((self.card_padding + self.content_padding, y_offset), title, fill=self.text_color, font=subtitle_font)
        y_offset += 100
        
        # 基本信息区域
        # 学分
        units = course.get('units', '')
        self._draw_detail_item(draw, "Units:", units, y_offset, body_font, small_font)
        y_offset += 60
        
        # GE学分
        ge_credit = course.get('ge3credit', '')
        if ge_credit:
            self._draw_detail_item(draw, "GE Credit:", ge_credit, y_offset, body_font, small_font)
            y_offset += 60
        
        # 退课截止日期
        drop_date = course.get('drop_date', '')
        if drop_date:
            self._draw_detail_item(draw, "Drop Date:", drop_date, y_offset, body_font, small_font)
            y_offset += 60
        
        # 期末考试
        final_exam = course.get('final_exam_startdate', '')
        if final_exam:
            self._draw_detail_item(draw, "Final Exam:", final_exam, y_offset, body_font, small_font)
            y_offset += 80
        
        # 添加分隔虚线
        y_offset += 20
        self._draw_dotted_line(draw, y_offset)
        y_offset += 40
        
        # 教师信息
        instructors = course.get('formatted_instructors', [])
        if instructors:
            draw.text((self.card_padding + self.content_padding, y_offset), "Instructors:", fill=self.primary_color, font=header_font)
            y_offset += 60
            
            for instructor in instructors:
                name = instructor.get('name', '')
                email = instructor.get('email', '')
                instructor_text = f"• {name}"
                if email and email != 'N/A':
                    instructor_text += f" ({email})"
                draw.text((self.card_padding + self.content_padding + 30, y_offset), instructor_text, fill=self.text_color, font=body_font)
                y_offset += 50
            y_offset += 30
            
            # 添加分隔虚线
            y_offset += 20
            self._draw_dotted_line(draw, y_offset)
            y_offset += 40
        
        # 课程安排
        meetings = course.get('formatted_meetings', [])
        if meetings:
            draw.text((self.card_padding + self.content_padding, y_offset), "Schedule:", fill=self.primary_color, font=header_font)
            y_offset += 60
            
            for meeting in meetings:
                meeting_type = meeting.get('type', '')
                days = meeting.get('days', '')
                time = meeting.get('time', '')
                location = meeting.get('location', '')
                dates = meeting.get('dates', '')
                
                # 会议类型
                draw.text((self.card_padding + self.content_padding + 30, y_offset), meeting_type, fill=self.primary_color, font=body_font)
                y_offset += 50
                
                # 星期几和时间
                if days and time:
                    days_time_text = f"{days} {time}"
                    draw.text((self.card_padding + self.content_padding + 60, y_offset), days_time_text, fill=self.text_color, font=small_font)
                    y_offset += 40
                elif time:
                    draw.text((self.card_padding + self.content_padding + 60, y_offset), time, fill=self.text_color, font=small_font)
                    y_offset += 40
                
                # 地点
                if location:
                    draw.text((self.card_padding + self.content_padding + 60, y_offset), location, fill=(0, 123, 255), font=small_font)  # #007bff
                    y_offset += 40
                
                # 日期
                if dates:
                    draw.text((self.card_padding + self.content_padding + 60, y_offset), dates, fill=self.secondary_text_color, font=small_font)
                    y_offset += 50
            y_offset += 30
            
            # 添加分隔虚线
            y_offset += 20
            self._draw_dotted_line(draw, y_offset)
            y_offset += 40
        
        # 课程描述
        description = course.get('description', '')
        if description:
            draw.text((self.card_padding + self.content_padding, y_offset), "Description:", fill=self.primary_color, font=header_font)
            y_offset += 60
            
            # 处理长描述文本
            wrapped_text = textwrap.fill(description, width=60)
            lines = wrapped_text.split('\n')
            for line in lines:  # 显示所有行
                draw.text((self.card_padding + self.content_padding, y_offset), line, fill=self.secondary_text_color, font=small_font)
                y_offset += 40
        
        # 底部标识 - 右下角
        y_offset += 60
        export_text = "Exported from ucd.richis.top"
        export_width = draw.textlength(export_text, font=small_font)
        draw.text((self.width - export_width - self.card_padding - self.content_padding, y_offset), export_text, 
                 fill=self.secondary_text_color, font=small_font)
        
        return img
    
    def _draw_section(self, draw: ImageDraw.Draw, title: str, y: int, body_font, small_font):
        """绘制章节标题"""
        # 绘制章节标题背景
        self._draw_rounded_rectangle(draw, 100, y, 400, y + 60, 15, self.primary_color)
        draw.text((125, y + 15), title, fill=(255, 255, 255), font=small_font)
        
        # 绘制装饰线
        draw.line([100, y + 60, self.width - 100, y + 60], fill=self.accent_color, width=5)
    
    def _draw_detail_item(self, draw: ImageDraw.Draw, label: str, value: str, y: int, body_font, small_font):
        """绘制详情项（标签-值对）"""
        # 绘制标签
        draw.text((self.card_padding + self.content_padding, y), label, fill=self.secondary_text_color, font=body_font)
        
        # 绘制值
        value_width = draw.textlength(value, font=body_font)
        value_x = self.width - self.card_padding - self.content_padding - value_width
        draw.text((value_x, y), value, fill=self.text_color, font=body_font)
    
    def _draw_dotted_line(self, draw: ImageDraw.Draw, y: int):
        """绘制虚线分隔线"""
        line_color = (200, 200, 200)  # 浅灰色
        start_x = self.card_padding + self.content_padding
        end_x = self.width - self.card_padding - self.content_padding
        dash_length = 10
        gap_length = 5
        
        x = start_x
        while x < end_x:
            # 绘制虚线段
            segment_end = min(x + dash_length, end_x)
            draw.line([x, y, segment_end, y], fill=line_color, width=2)
            x += dash_length + gap_length
    
    def _calculate_required_height(self, course: Dict) -> int:
        """计算所需的总高度"""
        base_height = 400  # 基础高度（头部 + 底部 + 额外内边距）
        
        # 课程标题
        base_height += 100
        
        # 基本信息区域
        base_height += 60  # Units
        if course.get('ge3credit'):
            base_height += 60
        if course.get('drop_date'):
            base_height += 60
        if course.get('final_exam_startdate'):
            base_height += 80
        
        # 分隔线
        base_height += 60
        
        # 教师信息区域
        instructors = course.get('formatted_instructors', [])
        if instructors:
            base_height += 60  # 标题
            base_height += len(instructors) * 50
            base_height += 30
            base_height += 60  # 分隔线
        
        # 课程安排区域
        meetings = course.get('formatted_meetings', [])
        if meetings:
            base_height += 60  # 标题
            for meeting in meetings:
                base_height += 50  # 会议类型
                if meeting.get('time'):
                    base_height += 40
                if meeting.get('location'):
                    base_height += 40
                if meeting.get('dates'):
                    base_height += 50
            base_height += 30
            base_height += 60  # 分隔线
        
        # 课程描述区域
        description = course.get('description', '')
        if description:
            base_height += 60  # 标题
            wrapped_text = textwrap.fill(description, width=60)
            lines = wrapped_text.split('\n')
            base_height += len(lines) * 40
        
        # 底部标识
        base_height += 120
        
        return base_height
    
    def _create_rounded_rectangle_mask(self, width: int, height: int, radius: int) -> Image.Image:
        """创建圆角矩形遮罩"""
        mask = Image.new('L', (width, height), 0)
        draw = ImageDraw.Draw(mask)
        
        # 绘制圆角矩形
        draw.rounded_rectangle([0, 0, width, height], radius=radius, fill=255)
        return mask
    
    def _draw_rounded_rectangle(self, draw: ImageDraw.Draw, x1: int, y1: int, x2: int, y2: int, radius: int, fill_color):
        """绘制圆角矩形"""
        # 创建圆角矩形路径
        draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=fill_color)

def generate_course_card_image(course: Dict, output_dir: str = None) -> str:
    """
    生成课程卡片图片
    
    Args:
        course: 课程信息字典
        output_dir: 输出目录
    
    Returns:
        str: 生成的图片文件路径
    """
    generator = CourseCardGenerator()
    img = generator.create_course_card(course)
    
    # 生成文件名
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    course_code = f"{course.get('subject_code', '')}_{course.get('course_number', '')}_{course.get('section_number', '')}"
    filename = f"course_card_{course_code}_{timestamp}.png"
    
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, filename)
    else:
        filepath = filename
    
    # 保存图片
    img.save(filepath, 'PNG', optimize=True)
    
    return filepath 