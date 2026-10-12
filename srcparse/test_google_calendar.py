#!/usr/bin/env python3
"""
Google Calendar功能测试脚本
用于验证Google Calendar API集成是否正常工作
"""

import os
import sys
from google_calendar import setup_google_calendar, get_user_calendars, import_courses_to_google_calendar

def test_google_calendar_setup():
    """测试Google Calendar设置"""
    print("🔐 测试Google Calendar设置...")
    
    try:
        # 检查凭据文件
        if not os.path.exists('credentials.json'):
            print("❌ credentials.json文件不存在")
            print("请按照docs/GOOGLE_CALENDAR_SETUP.md中的说明设置Google Calendar API")
            return False
        
        # 测试认证
        success = setup_google_calendar()
        if success:
            print("✅ Google Calendar认证成功")
            return True
        else:
            print("❌ Google Calendar认证失败")
            return False
            
    except Exception as e:
        print(f"❌ 设置过程中出错: {e}")
        return False

def test_get_calendars():
    """测试获取用户日历列表"""
    print("\n📅 测试获取用户日历列表...")
    
    try:
        calendars = get_user_calendars()
        if calendars:
            print(f"✅ 成功获取 {len(calendars)} 个日历")
            for calendar in calendars[:3]:  # 只显示前3个
                print(f"   - {calendar.get('summary', 'Unknown')} ({calendar.get('id', 'Unknown')})")
            if len(calendars) > 3:
                print(f"   ... 还有 {len(calendars) - 3} 个日历")
            return True
        else:
            print("❌ 无法获取日历列表")
            return False
            
    except Exception as e:
        print(f"❌ 获取日历时出错: {e}")
        return False

def test_import_sample():
    """测试导入示例ICS内容"""
    print("\n📝 测试导入示例ICS内容...")
    
    # 创建一个简单的示例ICS内容
    sample_ics = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//UC Davis Course Exporter//Test//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:test-event-1@ucdavis.edu
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
SUMMARY:Test Course - MAT 21A
DESCRIPTION:Test course for Google Calendar integration
LOCATION:Test Building Room 101
END:VEVENT
END:VCALENDAR"""
    
    try:
        result = import_courses_to_google_calendar(sample_ics, calendar_name="Test Calendar")
        if result['success']:
            print(f"✅ 成功导入 {result['imported_count']} 个事件到测试日历")
            print(f"   日历URL: {result.get('calendar_url', 'N/A')}")
            return True
        else:
            print(f"❌ 导入失败: {result.get('error', '未知错误')}")
            return False
            
    except Exception as e:
        print(f"❌ 导入测试时出错: {e}")
        return False

def main():
    """主测试函数"""
    print("🚀 开始Google Calendar功能测试\n")
    
    # 测试设置
    if not test_google_calendar_setup():
        print("\n❌ 设置测试失败，请检查配置")
        return False
    
    # 测试获取日历
    if not test_get_calendars():
        print("\n❌ 获取日历测试失败")
        return False
    
    # 测试导入
    if not test_import_sample():
        print("\n❌ 导入测试失败")
        return False
    
    print("\n✅ 所有测试通过！Google Calendar功能正常工作")
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 