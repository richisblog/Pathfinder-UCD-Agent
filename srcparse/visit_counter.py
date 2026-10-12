import json
import os
from datetime import datetime, timedelta

class VisitCounter:
    def __init__(self, data_file="visit_data.json"):
        self.data_file = data_file
        self.ensure_data_file()
    
    def ensure_data_file(self):
        """确保数据文件存在"""
        if not os.path.exists(self.data_file):
            initial_data = {
                "total_visits": 0,
                "unique_visits": 0,
                "last_visit": None,
                "visit_history": []
            }
            self.save_data(initial_data)
    
    def load_data(self):
        """加载访问数据"""
        try:
            with open(self.data_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {
                "total_visits": 0,
                "unique_visits": 0,
                "last_visit": None,
                "visit_history": []
            }
    
    def save_data(self, data):
        """保存访问数据"""
        with open(self.data_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    def _get_device_type(self, user_agent):
        """从User-Agent中提取设备类型"""
        if not user_agent:
            return "unknown"
        
        user_agent_lower = user_agent.lower()
        
        # 移动设备检测
        if any(keyword in user_agent_lower for keyword in ['iOS&iPadOS', 'ipad', 'ipod']):
            return "ios"
        elif 'android' in user_agent_lower:
            return "android"
        elif any(keyword in user_agent_lower for keyword in ['mobile', 'phone', 'tablet']):
            return "mobile"
        
        # 桌面设备检测
        elif any(keyword in user_agent_lower for keyword in ['windows', 'macintosh', 'linux']):
            return "desktop"
        
        # 浏览器检测
        elif any(keyword in user_agent_lower for keyword in ['chrome', 'firefox', 'safari', 'edge']):
            return "desktop"
        
        else:
            return "unknown"
    
    def record_visit(self, ip_address=None, user_agent=None):
        """记录一次访问"""
        data = self.load_data()
        current_time = datetime.now()
        current_time_str = current_time.isoformat()
        
        # 检查同一IP+设备类型是否在5分钟内已经访问过
        if ip_address and user_agent:
            # 获取5分钟前的时间
            five_minutes_ago = current_time - timedelta(minutes=1)
            
            # 提取设备类型（简化版）
            device_type = self._get_device_type(user_agent)
            
            # 检查访问历史中是否有同一IP+设备类型在5分钟内的访问记录
            recent_visits = [
                visit for visit in data["visit_history"]
                if visit["ip"] == ip_address and 
                visit.get("device_type") == device_type and
                datetime.fromisoformat(visit["timestamp"]) > five_minutes_ago
            ]
            
            # 如果同一IP+设备类型在5分钟内已经访问过，不增加计数
            if recent_visits:
                return data["total_visits"]
        
        # 增加总访问次数
        data["total_visits"] += 1
        data["last_visit"] = current_time_str
        
        # 记录访问历史
        visit_record = {
            "timestamp": current_time_str,
            "ip": ip_address,
            "user_agent": user_agent,
            "device_type": self._get_device_type(user_agent) if user_agent else "unknown"
        }
        data["visit_history"].append(visit_record)
        
        # 保持历史记录在合理范围内（最近30000次访问）
        if len(data["visit_history"]) > 30000:
            data["visit_history"] = data["visit_history"][-30000:]
        
        self.save_data(data)
        return data["total_visits"]
        
        # 增加总访问次数
        data["total_visits"] += 1
        data["last_visit"] = current_time_str
        
        # 记录访问历史
        visit_record = {
            "timestamp": current_time_str,
            "ip": ip_address,
            "user_agent": user_agent
        }
        data["visit_history"].append(visit_record)
        
        # 保持历史记录在合理范围内（最近30000次访问）
        if len(data["visit_history"]) > 30000:
            data["visit_history"] = data["visit_history"][-30000:]
        
        self.save_data(data)
        return data["total_visits"]
    
    def get_stats(self):
        """获取访问统计"""
        data = self.load_data()
        
        # 计算去重后的访问次数（基于IP地址）
        unique_ips = set()
        device_stats = {"desktop": 0, "mobile": 0, "ios": 0, "android": 0, "unknown": 0}
        
        for visit in data["visit_history"]:
            if visit["ip"]:
                unique_ips.add(visit["ip"])
            
            # 统计设备类型
            device_type = visit.get("device_type", "unknown")
            if device_type in device_stats:
                device_stats[device_type] += 1
        
        return {
            "total_visits": data["total_visits"],
            "last_visit": data["last_visit"],
            "visit_history_count": len(data["visit_history"]),
            "unique_visitors": len(unique_ips),
            "device_stats": device_stats
        }
    
    def reset_counter(self):
        """重置计数器（管理员功能）"""
        data = {
            "total_visits": 0,
            "unique_visits": 0,
            "last_visit": None,
            "visit_history": []
        }
        self.save_data(data)
        return data

# 创建全局计数器实例
visit_counter = VisitCounter()