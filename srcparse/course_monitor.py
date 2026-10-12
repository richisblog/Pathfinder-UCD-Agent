import os
import time
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Set, Dict, Any
import threading

from parse_crn import extract_crns
from parse_course_info import (
    get_crn, get_title, get_subject_code, get_course_number, 
    get_section_number, get_description, get_units, get_ge3credit,
    get_drop_date, get_final_exam_startdate, get_meetings, get_instructors
)
from database import Database

class CourseMonitor:
    def __init__(self, uploads_dir: str = "uploads", db_path: str = "courses.db"):
        """
        初始化课程监控器
        
        Args:
            uploads_dir: uploads文件夹路径
            db_path: 数据库文件路径
        """
        self.uploads_dir = Path(uploads_dir)
        self.db = Database(db_path)
        self.processed_files: Set[str] = set()
        self.running = False
        self.monitor_thread = None
        
        # 设置日志
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('course_monitor.log', encoding='utf-8'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # 确保uploads目录存在
        self.uploads_dir.mkdir(exist_ok=True)
        
        # 初始化已处理文件列表
        self._load_processed_files()
    
    def _load_processed_files(self):
        """加载已处理文件列表"""
        processed_file = Path("processed_files.json")
        if processed_file.exists():
            try:
                with open(processed_file, 'r', encoding='utf-8') as f:
                    self.processed_files = set(json.load(f))
                self.logger.info(f"加载了 {len(self.processed_files)} 个已处理文件")
            except Exception as e:
                self.logger.error(f"加载已处理文件列表失败: {e}")
                self.processed_files = set()
    
    def _save_processed_files(self):
        """保存已处理文件列表"""
        try:
            with open("processed_files.json", 'w', encoding='utf-8') as f:
                json.dump(list(self.processed_files), f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.logger.error(f"保存已处理文件列表失败: {e}")
    
    def _extract_term_from_filename(self, filename: str) -> str:
        """从文件名中提取学期信息"""
        filename_lower = filename.lower()
        if "fall" in filename_lower:
            return "Fall"
        elif "winter" in filename_lower:
            return "Winter"
        elif "spring" in filename_lower:
            return "Spring"
        elif "summer" in filename_lower:
            return "Summer"
        else:
            return "Unknown"
    
    def _parse_course_data(self, html_content: str, crn: str, term: str) -> Dict[str, Any]:
        """解析单个课程的详细信息"""
        try:
            # 获取基本信息
            course_data = {
                'crn': get_crn(html_content, crn),
                'title': get_title(html_content, crn),
                'subject_code': get_subject_code(html_content, crn),
                'course_number': get_course_number(html_content, crn),
                'section_number': get_section_number(html_content, crn),
                'description': get_description(html_content, crn),
                'units': get_units(html_content, crn),
                'ge3credit': get_ge3credit(html_content, crn),
                'drop_date': get_drop_date(html_content, crn),
                'final_exam_startdate': get_final_exam_startdate(html_content, crn),
                'term': term
            }
            
            # 获取会议信息
            meetings = get_meetings(html_content, crn)
            course_data['formatted_meetings'] = meetings
            
            # 获取教师信息
            instructors = get_instructors(html_content, crn)
            course_data['formatted_instructors'] = instructors
            
            return course_data
            
        except Exception as e:
            self.logger.error(f"解析课程 {crn} 数据失败: {e}")
            return None
    
    def _process_html_file(self, file_path: Path) -> bool:
        """处理单个HTML文件"""
        try:
            self.logger.info(f"开始处理文件: {file_path.name}")
            
            # 读取HTML内容
            with open(file_path, 'r', encoding='utf-8') as f:
                html_content = f.read()
            
            # 提取所有CRN
            crns = extract_crns(html_content)
            if not crns:
                self.logger.warning(f"文件 {file_path.name} 中没有找到任何CRN")
                return False
            
            self.logger.info(f"在文件 {file_path.name} 中找到 {len(crns)} 个CRN")
            
            # 从文件名提取学期信息
            term = self._extract_term_from_filename(file_path.name)
            
            # 解析每个课程的详细信息
            processed_count = 0
            skipped_count = 0
            failed_count = 0
            
            for crn in crns:
                try:
                    course_data = self._parse_course_data(html_content, crn, term)
                    if course_data:
                        # 插入数据库
                        result = self.db.insert_course(course_data)
                        if result is not None:
                            processed_count += 1
                            self.logger.debug(f"成功处理课程 CRN: {crn}")
                        else:
                            skipped_count += 1
                            self.logger.info(f"跳过重复课程 CRN: {crn}")
                    else:
                        failed_count += 1
                        self.logger.warning(f"课程 CRN: {crn} 数据解析失败")
                except Exception as e:
                    failed_count += 1
                    self.logger.error(f"处理课程 CRN: {crn} 时出错: {e}")
            
            self.logger.info(f"文件 {file_path.name} 处理完成: 成功 {processed_count} 个, 跳过 {skipped_count} 个, 失败 {failed_count} 个")
            # 如果所有课程都被处理了（包括跳过的重复课程），就认为文件处理成功
            return True
            
        except Exception as e:
            self.logger.error(f"处理文件 {file_path.name} 失败: {e}")
            return False
    
    def _scan_and_process_files(self):
        """扫描并处理新文件"""
        try:
            # 获取uploads目录中的所有HTML文件
            html_files = list(self.uploads_dir.glob("*.html"))
            
            # 过滤出未处理的文件
            new_files = [f for f in html_files if f.name not in self.processed_files]
            
            if new_files:
                self.logger.info(f"发现 {len(new_files)} 个新文件需要处理")
                
                for file_path in new_files:
                    try:
                        if self._process_html_file(file_path):
                            # 标记文件为已处理
                            self.processed_files.add(file_path.name)
                            self._save_processed_files()
                            self.logger.info(f"文件 {file_path.name} 处理完成并标记为已处理")
                        else:
                            self.logger.warning(f"文件 {file_path.name} 处理失败，将稍后重试")
                    except Exception as e:
                        self.logger.error(f"处理文件 {file_path.name} 时发生异常: {e}")
            else:
                self.logger.debug("没有发现新文件")
                
        except Exception as e:
            self.logger.error(f"扫描文件时发生异常: {e}")
    
    def _monitor_loop(self):
        """监控循环"""
        self.logger.info("开始课程监控循环")
        while self.running:
            try:
                self._scan_and_process_files()
                # 等待30秒
                time.sleep(30)
            except Exception as e:
                self.logger.error(f"监控循环中发生异常: {e}")
                time.sleep(30)  # 即使出错也等待30秒
    
    def start(self):
        """启动监控器"""
        if self.running:
            self.logger.warning("监控器已经在运行")
            return
        
        self.running = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        self.logger.info("课程监控器已启动")
    
    def stop(self):
        """停止监控器"""
        if not self.running:
            self.logger.warning("监控器未在运行")
            return
        
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)
        self.logger.info("课程监控器已停止")
    
    def process_all_files(self):
        """一次性处理所有未处理的文件"""
        self.logger.info("开始一次性处理所有文件")
        self._scan_and_process_files()
        self.logger.info("一次性处理完成")
    
    def get_status(self) -> Dict[str, Any]:
        """获取监控器状态"""
        return {
            'running': self.running,
            'processed_files_count': len(self.processed_files),
            'uploads_dir': str(self.uploads_dir),
            'database_path': self.db.db_path
        }

def main():
    """主函数，用于独立运行监控器"""
    import signal
    import sys
    
    def signal_handler(signum, frame):
        print("\n收到停止信号，正在关闭监控器...")
        monitor.stop()
        sys.exit(0)
    
    # 注册信号处理器
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 创建并启动监控器
    monitor = CourseMonitor()
    
    print("课程监控器启动中...")
    print(f"监控目录: {monitor.uploads_dir}")
    print(f"数据库路径: {monitor.db.db_path}")
    print("按 Ctrl+C 停止监控器")
    
    try:
        monitor.start()
        
        # 保持主线程运行
        while monitor.running:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n收到键盘中断，正在关闭监控器...")
    finally:
        monitor.stop()
        print("监控器已关闭")

if __name__ == "__main__":
    main() 