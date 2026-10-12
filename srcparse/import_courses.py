import json
import sqlite3
from database import Database
import os

def import_courses_from_json(json_file, db_path='courses.db'):
    """从JSON文件导入课程数据到数据库"""
    
    # 检查JSON文件是否存在
    if not os.path.exists(json_file):
        print(f"错误: 文件 {json_file} 不存在")
        return
    
    # 读取JSON数据
    with open(json_file, 'r', encoding='utf-8') as f:
        courses_data = json.load(f)
    
    print(f"从 {json_file} 读取到 {len(courses_data)} 门课程")
    
    # 初始化数据库
    db = Database(db_path)
    
    # 统计信息
    imported_count = 0
    skipped_count = 0
    error_count = 0
    
    for i, course in enumerate(courses_data, 1):
        try:
            # 构造符合数据库格式的课程数据
            db_course = {
                'crn': f"SCRAPED_{course['subject_code']}_{course['course_number']}_{i}",  # 生成唯一CRN
                'subject_code': course.get('subject_code', ''),
                'course_number': course.get('course_number', ''),
                'section_number': '001',  # 默认section
                'title': course.get('title', ''),
                'description': course.get('description', ''),
                'units': course.get('units', ''),
                'ge3credit': course.get('ge3credit', ''),
                'drop_date': '',  # 采集数据中没有这些字段
                'final_exam_startdate': '',
                'term': 'Catalog',  # 标记为目录数据
                'formatted_instructors': [],  # 采集数据中没有教师信息
                'formatted_meetings': []  # 采集数据中没有会议信息
            }
            
            # 尝试插入数据库
            try:
                db.insert_course(db_course)
                imported_count += 1
                if imported_count % 100 == 0:
                    print(f"已导入 {imported_count} 门课程...")
            except sqlite3.IntegrityError:
                # 如果课程已存在，跳过
                skipped_count += 1
                
        except Exception as e:
            print(f"导入课程 {course.get('subject_code', '')} {course.get('course_number', '')} 时出错: {e}")
            error_count += 1
    
    print(f"\n=== 导入完成 ===")
    print(f"成功导入: {imported_count} 门课程")
    print(f"跳过重复: {skipped_count} 门课程")
    print(f"导入失败: {error_count} 门课程")
    print(f"总计处理: {len(courses_data)} 门课程")

def import_courses_from_csv(csv_file, db_path='courses.db'):
    """从CSV文件导入课程数据到数据库"""
    import csv
    
    # 检查CSV文件是否存在
    if not os.path.exists(csv_file):
        print(f"错误: 文件 {csv_file} 不存在")
        return
    
    # 初始化数据库
    db = Database(db_path)
    
    # 统计信息
    imported_count = 0
    skipped_count = 0
    error_count = 0
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for i, row in enumerate(reader, 1):
            try:
                # 构造符合数据库格式的课程数据
                db_course = {
                    'crn': f"SCRAPED_{row['subject_code']}_{row['course_number']}_{i}",
                    'subject_code': row.get('subject_code', ''),
                    'course_number': row.get('course_number', ''),
                    'section_number': '001',
                    'title': row.get('title', ''),
                    'description': row.get('description', ''),
                    'units': row.get('units', ''),
                    'ge3credit': row.get('ge3credit', ''),
                    'drop_date': '',
                    'final_exam_startdate': '',
                    'term': 'Catalog',
                    'formatted_instructors': [],
                    'formatted_meetings': []
                }
                
                # 尝试插入数据库
                try:
                    db.insert_course(db_course)
                    imported_count += 1
                    if imported_count % 100 == 0:
                        print(f"已导入 {imported_count} 门课程...")
                except sqlite3.IntegrityError:
                    skipped_count += 1
                    
            except Exception as e:
                print(f"导入课程 {row.get('subject_code', '')} {row.get('course_number', '')} 时出错: {e}")
                error_count += 1
    
    print(f"\n=== 导入完成 ===")
    print(f"成功导入: {imported_count} 门课程")
    print(f"跳过重复: {skipped_count} 门课程")
    print(f"导入失败: {error_count} 门课程")

def main():
    print("UC Davis课程数据导入工具")
    print("=" * 40)
    
    # 检查是否有采集到的数据文件
    json_file = 'ucdavis_courses.json'
    csv_file = 'ucdavis_courses.csv'
    
    if os.path.exists(json_file):
        print(f"发现JSON文件: {json_file}")
        choice = input("是否导入JSON文件? (y/n): ").lower()
        if choice == 'y':
            import_courses_from_json(json_file)
    
    if os.path.exists(csv_file):
        print(f"发现CSV文件: {csv_file}")
        choice = input("是否导入CSV文件? (y/n): ").lower()
        if choice == 'y':
            import_courses_from_csv(csv_file)
    
    if not os.path.exists(json_file) and not os.path.exists(csv_file):
        print("未找到采集数据文件，请先运行 course_scraper.py 采集数据")

if __name__ == "__main__":
    main() 