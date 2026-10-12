# 宝塔面板部署 Pathfinder UCD

## 1. 服务器准备

建议环境：

- Linux + 宝塔面板 / aaPanel
- Nginx
- Python 3.10 或 3.11
- 只开放公网 `80/443`，不要开放 Flask/Gunicorn 内部端口 `5050`

代码和数据分开处理：

- 代码：从 GitHub clone 到 `/www/wwwroot/pathfinder_ucd_modern`
- 数据：手动上传 `data/sqlite/*.db` 和 `data/txt/*` 到 `/www/wwwroot/pathfinder_ucd_modern/data/`
- 日志：自动写到 `/www/wwwroot/pathfinder_ucd_modern/logs/`，不要提交 Git

## 2. 环境变量

公网部署必须设置：

```bash
APP_ENV=production
FLASK_DEBUG=0
TRUST_PROXY=1
WEB_HOST=127.0.0.1
WEB_PORT=5050
LLM_API_KEY=你的私有LLM密钥
LLM_BASE_URL=你的OpenAI兼容API地址
LLM_MODEL=你的模型名
ALLOWED_ORIGINS=https://你的域名
```

可选限流参数：

```bash
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=120
CHAT_RATE_LIMIT_MAX_REQUESTS=12
MAX_MESSAGE_CHARS=4000
MAX_HISTORY_MESSAGES=20
MAX_HISTORY_CHARS=30000
BLOCK_BOT_USER_AGENTS=1
AUDIT_LOG_ENABLED=1
```

旧提交里曾经出现过第三方模型 API key。上线前请在服务商后台轮换旧 key，并只把新 key 放进服务器环境变量。

## 3. 宝塔 Python 项目管理器

在宝塔里安装：

1. `Nginx`
2. `Python项目管理器` 或新版 `Python Project`
3. Python `3.10+`

添加项目时填写：

```text
项目路径: /www/wwwroot/pathfinder_ucd_modern
启动方式: gunicorn
启动文件/模块: wsgi.py
应用变量: app
端口: 5050
```

如果宝塔允许自定义启动命令，用：

```bash
gunicorn -w 2 -k gthread --threads 4 -b 127.0.0.1:5050 wsgi:app
```

如果宝塔要求先安装依赖，项目根目录已经有：

```text
requirements.txt
```

## 4. 网站反向代理

在宝塔 `网站` 中绑定你的域名并开启 SSL，然后添加反向代理到：

```text
http://127.0.0.1:5050
```

Nginx 配置建议参考：

```text
deploy/nginx_pathfinder.conf
```

重点是 `/api/chat/stream` 必须关闭 `proxy_buffering`，否则流式回答可能会卡住，等模型全部生成完才一次性返回。

## 5. 防攻击建议

应用内已经做了：

- 同源/CORS 白名单
- API 频率限制
- 最大请求体、最大消息、最大历史长度限制
- 常见 bot/crawler User-Agent 拦截
- `robots.txt` 全站禁止爬取
- `X-Robots-Tag: noindex`
- CSP、X-Frame-Options、nosniff 等安全响应头
- 审计日志记录用户问题、工具调用、工具结果和最终回复
- system prompt 明确忽略工具结果/网页文本里的提示词注入指令

服务器侧还建议：

- 宝塔安全里只放行 `80/443/SSH`，不要放行 `5050`
- 开启 HTTPS
- 开启宝塔 Nginx 网站防火墙或同类 WAF
- 如果用 Cloudflare/CDN，开启 Bot Fight Mode 或等效 bot 防护
- 对 `/api/chat` 设置更严格的 Nginx/CDN 限流
- 定期备份 `logs/`，但不要把日志公开下载
