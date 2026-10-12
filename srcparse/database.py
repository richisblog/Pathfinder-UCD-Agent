import sqlite3
import os
from datetime import datetime
import json

class Database:
    def __init__(self, db_path='courses.db'):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """初始化数据库，创建表结构"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 创建课程信息表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                crn TEXT UNIQUE NOT NULL,
                subject_code TEXT,
                course_number TEXT,
                section_number TEXT,
                title TEXT,
                description TEXT,
                units TEXT,
                ge3credit TEXT,
                drop_date TEXT,
                final_exam_startdate TEXT,
                term TEXT,  -- 学期信息
                instructors TEXT,  -- JSON格式存储教师信息
                meetings TEXT,     -- JSON格式存储会议信息
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # 创建索引以提高搜索性能
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_crn ON courses(crn)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_subject_code ON courses(subject_code)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_course_number ON courses(course_number)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_title ON courses(title)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_instructors ON courses(instructors)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ge3credit ON courses(ge3credit)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_term ON courses(term)')
        
        conn.commit()
        conn.close()
    
    def insert_course(self, course_data):
        """插入课程数据"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 将教师和会议信息转换为JSON字符串
            instructors_json = json.dumps(course_data.get('formatted_instructors', []), ensure_ascii=False)
            meetings_json = json.dumps(course_data.get('formatted_meetings', []), ensure_ascii=False)
            
            # 检查是否已存在相同的课程（除了CRN、时间和地点之外的其他字段都相同）
            cursor.execute('''
                SELECT id, crn FROM courses WHERE 
                    subject_code = ? AND course_number = ? AND section_number = ? AND 
                    title = ? AND description = ? AND units = ? AND ge3credit = ? AND 
                    drop_date = ? AND final_exam_startdate = ? AND term = ? AND 
                    instructors = ?
            ''', (
                course_data.get('subject_code'),
                course_data.get('course_number'),
                course_data.get('section_number'),
                course_data.get('title'),
                course_data.get('description'),
                course_data.get('units'),
                course_data.get('ge3credit'),
                course_data.get('drop_date'),
                course_data.get('final_exam_startdate'),
                course_data.get('term'),
                instructors_json
            ))
            
            existing_course = cursor.fetchone()
            
            if existing_course:
                # 如果存在除了CRN、时间和地点之外其他都相同的课程，直接跳过
                print(f"跳过重复课程: {course_data.get('crn')} (与现有课程 {existing_course[1]} 相同，仅时间和地点不同)")
                return None
            else:
                # 检查CRN是否已存在
                cursor.execute('SELECT id FROM courses WHERE crn = ?', (course_data.get('crn'),))
                if cursor.fetchone():
                    # CRN已存在，跳过
                    print(f"跳过重复CRN: {course_data.get('crn')}")
                    return None
                
                # 如果不存在相同的课程，插入新记录
                cursor.execute('''
                    INSERT INTO courses (
                        crn, subject_code, course_number, section_number, title, description,
                        units, ge3credit, drop_date, final_exam_startdate, term,
                        instructors, meetings
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    course_data.get('crn'),
                    course_data.get('subject_code'),
                    course_data.get('course_number'),
                    course_data.get('section_number'),
                    course_data.get('title'),
                    course_data.get('description'),
                    course_data.get('units'),
                    course_data.get('ge3credit'),
                    course_data.get('drop_date'),
                    course_data.get('final_exam_startdate'),
                    course_data.get('term'),
                    instructors_json,
                    meetings_json
                ))
            
            conn.commit()
            return cursor.lastrowid
        except Exception as e:
            print(f"插入课程数据时出错: {e}")
            conn.rollback()
            return None
        finally:
            conn.close()
    
    def search_courses(self, search_term=None, subject_code=None, 
                      instructor=None, ge3credit=None, term=None, limit=50):
        """搜索课程"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        query = "SELECT * FROM courses WHERE 1=1"
        params = []
        
        if search_term:
            query += " AND (title LIKE ? OR subject_code LIKE ? OR course_number LIKE ? OR crn LIKE ?)"
            search_pattern = f"%{search_term}%"
            params.extend([search_pattern, search_pattern, search_pattern, search_pattern])
        
        if subject_code:
            query += " AND subject_code LIKE ?"
            params.append(f"%{subject_code}%")
        

        
        if instructor:
            query += " AND instructors LIKE ?"
            params.append(f"%{instructor}%")
        
        if ge3credit and isinstance(ge3credit, list) and len(ge3credit) > 0:
            # 支持多个GE筛选，使用AND连接（课程必须满足所有选中的GE要求）
            for ge in ge3credit:
                query += " AND ge3credit LIKE ?"
                params.append(f"%{ge}%")
        elif ge3credit and not isinstance(ge3credit, list):
            # 向后兼容单个GE筛选
            query += " AND ge3credit LIKE ?"
            params.append(f"%{ge3credit}%")
        
        if term:
            query += " AND term LIKE ?"
            params.append(f"%{term}%")
        
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        # 获取列名
        columns = [description[0] for description in cursor.description]
        
        # 转换为字典列表
        courses = []
        for row in rows:
            course_dict = dict(zip(columns, row))
            # 解析JSON字段
            try:
                course_dict['formatted_instructors'] = json.loads(course_dict['instructors']) if course_dict['instructors'] else []
                course_dict['formatted_meetings'] = json.loads(course_dict['meetings']) if course_dict['meetings'] else []
            except json.JSONDecodeError:
                course_dict['formatted_instructors'] = []
                course_dict['formatted_meetings'] = []
            courses.append(course_dict)
        
        conn.close()
        return courses

    def search_courses_grouped(self, search_term=None, subject_code=None, 
                              instructor=None, ge3credit=None, term=None, limit=50):
        """搜索课程并按显示信息分组，合并学期信息，并生成tags（不含教授名，crn特殊处理）"""
        # 获取所有匹配的课程
        all_courses = self.search_courses(search_term, subject_code, instructor, ge3credit, term, limit=1000)
        
        # 按显示信息分组（课程代码、标题、描述、学分、GE）
        course_groups = {}
        for course in all_courses:
            # 使用显示信息作为分组键
            display_key = f"{course['subject_code']}_{course['course_number']}_{course['title']}_{course['description']}_{course['units']}_{course['ge3credit']}"
            
            if display_key not in course_groups:
                course_groups[display_key] = {
                    'subject_code': course['subject_code'],
                    'course_number': course['course_number'],
                    'title': course['title'],
                    'description': course['description'],
                    'units': course['units'],
                    'ge3credit': course['ge3credit'],
                    'terms': [],
                    'crns': [],
                    'sections': [],
                    'instructors': set(),
                    'meetings': set(),
                    'tags': set(),
                    'crn_tags': set()
                }
            
            # 添加学期信息
            if course['term'] and course['term'] not in course_groups[display_key]['terms']:
                course_groups[display_key]['terms'].append(course['term'])
            
            # 添加CRN和Section信息
            if course['crn'] not in course_groups[display_key]['crns']:
                course_groups[display_key]['crns'].append(course['crn'])
                # 额外收集crn_tags
                if course['crn'] and len(str(course['crn'])) == 5 and str(course['crn']).isdigit():
                    course_groups[display_key]['crn_tags'].add(str(course['crn']))
            
            if course['section_number'] and course['section_number'] not in course_groups[display_key]['sections']:
                course_groups[display_key]['sections'].append(course['section_number'])
            
            # 添加教师信息（不显示，但收集用于内部使用）
            for instructor in course.get('formatted_instructors', []):
                name = instructor.get('name', '')
                if name:
                    course_groups[display_key]['instructors'].add(name)
            
            # 添加会议信息（不显示，但收集用于内部使用）
            for meeting in course.get('formatted_meetings', []):
                meeting_key = f"{meeting.get('type', '')}_{meeting.get('days', '')}_{meeting.get('time', '')}_{meeting.get('location', '')}"
                course_groups[display_key]['meetings'].add(meeting_key)
        
        # 转换为列表并排序
        grouped_courses = []
        for display_key, course_data in course_groups.items():
            # 将set转换为list
            course_data['instructors'] = list(course_data['instructors'])
            course_data['meetings'] = list(course_data['meetings'])
            
            # 排序学期
            course_data['terms'].sort()
            
            # 生成tags（不含教授名）
            tags = set()
            if course_data['subject_code']:
                tags.add(course_data['subject_code'])
            if course_data['course_number']:
                tags.add(course_data['course_number'])
            if course_data['title']:
                # 将课程名字拆分成单词
                title_words = course_data['title'].replace('-', ' ').replace('_', ' ').split()
                for word in title_words:
                    # 清理单词（去除标点符号，转小写）
                    clean_word = ''.join(c for c in word if c.isalnum()).lower()
                    if clean_word and len(clean_word) > 1:  # 只添加长度大于1的单词
                        tags.add(clean_word)
            if course_data['units']:
                # 添加Units作为tag
                tags.add(course_data['units'])
            if course_data['ge3credit']:
                for ge in str(course_data['ge3credit']).replace('，', ',').replace(';', ',').split(','):
                    ge = ge.strip()
                    if ge:
                        tags.add(ge)
            for t in course_data['terms']:
                if t:
                    tags.add(t)
            
            course_data['tags'] = sorted(tags)
            course_data['crn_tags'] = list(course_data['crn_tags'])
            grouped_courses.append(course_data)
        
        # 按课程代码排序
        grouped_courses.sort(key=lambda x: (x['subject_code'], x['course_number']))
        
        return grouped_courses[:limit]
    
    def get_course_by_crn(self, crn):
        """根据CRN获取课程"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM courses WHERE crn = ?', (crn,))
        row = cursor.fetchone()
        
        if row:
            columns = [description[0] for description in cursor.description]
            course_dict = dict(zip(columns, row))
            try:
                course_dict['formatted_instructors'] = json.loads(course_dict['instructors']) if course_dict['instructors'] else []
                course_dict['formatted_meetings'] = json.loads(course_dict['meetings']) if course_dict['meetings'] else []
            except json.JSONDecodeError:
                course_dict['formatted_instructors'] = []
                course_dict['formatted_meetings'] = []
            conn.close()
            return course_dict
        
        conn.close()
        return None
    
    def get_all_subject_codes(self):
        """获取所有学科代码"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT DISTINCT subject_code FROM courses WHERE subject_code IS NOT NULL ORDER BY subject_code')
        subject_codes = [row[0] for row in cursor.fetchall()]
        
        conn.close()
        return subject_codes
    
    def get_all_ge_credits(self):
        """获取所有GE学分类型"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT DISTINCT ge3credit FROM courses WHERE ge3credit IS NOT NULL AND ge3credit != "" ORDER BY ge3credit')
        ge_credits = [row[0] for row in cursor.fetchall()]
        
        conn.close()
        return ge_credits
    
    def get_all_terms(self):
        """获取所有学期"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT DISTINCT term FROM courses WHERE term IS NOT NULL AND term != "" ORDER BY term')
        terms = [row[0] for row in cursor.fetchall()]
        
        conn.close()
        return terms
    
    def get_course_count(self):
        """获取课程总数"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM courses')
        count = cursor.fetchone()[0]
        
        conn.close()
        return count
    
    def delete_old_courses(self, days=30):
        """删除指定天数前的课程数据"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cutoff_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff_date = cutoff_date.replace(day=cutoff_date.day - days)
        
        cursor.execute('DELETE FROM courses WHERE created_at < ?', (cutoff_date.isoformat(),))
        deleted_count = cursor.rowcount
        
        conn.commit()
        conn.close()
        
        return deleted_count 