import os
import json
import requests
from datetime import datetime, timedelta
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

# Google Calendar API配置
SCOPES = ['https://www.googleapis.com/auth/calendar']
TOKEN_FILE = 'token.json'
CREDENTIALS_FILE = 'credentials.json'

class GoogleCalendarManager:
    def __init__(self):
        self.creds = None
        self.service = None
        
    def authenticate(self):
        """进行OAuth 2.0认证"""
        # 检查是否有有效的token
        if os.path.exists(TOKEN_FILE):
            self.creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
        
        # 如果没有有效的凭据，让用户登录
        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                if not os.path.exists(CREDENTIALS_FILE):
                    raise Exception("credentials.json文件不存在。请在Google Cloud Console中创建OAuth 2.0凭据。")
                
                flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
                self.creds = flow.run_local_server(port=0)
            
            # 保存凭据以供下次运行使用
            with open(TOKEN_FILE, 'w') as token:
                token.write(self.creds.to_json())
        
        # 构建服务
        self.service = build('calendar', 'v3', credentials=self.creds)
        return True
    
    def get_calendars(self):
        """获取用户的所有日历"""
        if not self.service:
            self.authenticate()
        
        try:
            calendar_list = self.service.calendarList().list().execute()
            calendars = calendar_list.get('items', [])
            return calendars
        except HttpError as error:
            print(f'获取日历列表时出错: {error}')
            return []
    
    def create_calendar(self, summary, description=""):
        """创建新日历"""
        if not self.service:
            self.authenticate()
        
        try:
            calendar = {
                'summary': summary,
                'description': description,
                'timeZone': 'America/Los_Angeles'
            }
            
            created_calendar = self.service.calendars().insert(body=calendar).execute()
            return created_calendar
        except HttpError as error:
            print(f'创建日历时出错: {error}')
            return None
    
    def import_ics_to_calendar(self, ics_content, calendar_id='primary', calendar_name=None):
        """将ICS内容导入到Google Calendar"""
        if not self.service:
            self.authenticate()
        
        try:
            # 如果提供了日历名称，创建新日历
            if calendar_name:
                calendar = self.create_calendar(calendar_name, "UC Davis课程日历")
                if calendar:
                    calendar_id = calendar['id']
                else:
                    calendar_id = 'primary'
            
            # 解析ICS内容并创建事件
            from icalendar import Calendar
            from datetime import datetime
            import pytz
            
            cal = Calendar.from_ical(ics_content)
            imported_events = []
            
            for component in cal.walk():
                if component.name == "VEVENT":
                    event = {
                        'summary': str(component.get('summary', '')),
                        'description': str(component.get('description', '')),
                        'location': str(component.get('location', '')),
                    }
                    
                    # 处理开始时间
                    start = component.get('dtstart')
                    if start:
                        if hasattr(start.dt, 'date'):  # 全天事件
                            event['start'] = {
                                'date': start.dt.strftime('%Y-%m-%d'),
                                'timeZone': 'America/Los_Angeles',
                            }
                        else:  # 有时间的事件
                            event['start'] = {
                                'dateTime': start.dt.isoformat(),
                                'timeZone': 'America/Los_Angeles',
                            }
                    
                    # 处理结束时间
                    end = component.get('dtend')
                    if end:
                        if hasattr(end.dt, 'date'):  # 全天事件
                            event['end'] = {
                                'date': end.dt.strftime('%Y-%m-%d'),
                                'timeZone': 'America/Los_Angeles',
                            }
                        else:  # 有时间的事件
                            event['end'] = {
                                'dateTime': end.dt.isoformat(),
                                'timeZone': 'America/Los_Angeles',
                            }
                    
                    # 处理重复规则
                    rrule = component.get('rrule')
                    if rrule:
                        rrule_str = str(rrule)
                        # 转换RRULE格式为Google Calendar格式
                        if 'FREQ=WEEKLY' in rrule_str:
                            event['recurrence'] = [rrule_str]
                    
                    # 创建事件
                    try:
                        created_event = self.service.events().insert(
                            calendarId=calendar_id,
                            body=event
                        ).execute()
                        imported_events.append(created_event)
                    except HttpError as error:
                        print(f'创建事件时出错: {error}')
                        continue
            
            return {
                'success': True,
                'calendar_id': calendar_id,
                'imported_count': len(imported_events),
                'events': imported_events
            }
            
        except Exception as error:
            print(f'导入ICS时出错: {error}')
            return {
                'success': False,
                'error': str(error)
            }
    
    def get_calendar_url(self, calendar_id):
        """获取日历的公开URL"""
        return f"https://calendar.google.com/calendar/embed?src={calendar_id}"
    
    def share_calendar(self, calendar_id, email, role='reader'):
        """分享日历给其他用户"""
        if not self.service:
            self.authenticate()
        
        try:
            rule = {
                'scope': {
                    'type': 'user',
                    'value': email,
                },
                'role': role,
            }
            
            created_rule = self.service.acl().insert(
                calendarId=calendar_id,
                body=rule
            ).execute()
            
            return created_rule
        except HttpError as error:
            print(f'分享日历时出错: {error}')
            return None

# 全局实例
calendar_manager = GoogleCalendarManager()

def setup_google_calendar():
    """设置Google Calendar认证"""
    try:
        return calendar_manager.authenticate()
    except Exception as e:
        print(f"Google Calendar认证失败: {e}")
        return False

def import_courses_to_google_calendar(ics_content, calendar_name=None, calendar_id='primary'):
    """将课程导入到Google Calendar"""
    try:
        if calendar_name:
            result = calendar_manager.import_ics_to_calendar(ics_content, calendar_name=calendar_name)
        else:
            result = calendar_manager.import_ics_to_calendar(ics_content, calendar_id=calendar_id)
        
        if result['success']:
            calendar_url = calendar_manager.get_calendar_url(result['calendar_id'])
            result['calendar_url'] = calendar_url
        return result
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def get_user_calendars():
    """获取用户的日历列表"""
    try:
        return calendar_manager.get_calendars()
    except Exception as e:
        print(f"获取用户日历时出错: {e}")
        return [] 