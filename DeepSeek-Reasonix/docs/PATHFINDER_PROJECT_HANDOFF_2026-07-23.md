# Pathfinder UCD 项目转交手册

更新时间：2026-07-23  
项目目录：`/Users/richis/Documents/RMP咨询APP/DeepSeek-Reasonix`  
当前分支：`campus-assistant-desktop`

## 1. 项目现状

Pathfinder UCD 是从 DeepSeek-Reasonix 桌面端改造而来的 UC Davis 学术助理。当前可安装版本已经完成 arm64 macOS 构建、临时签名、运行数据库注入和 DMG 校验。

最终安装包：

- 桌面副本：`/Users/richis/Desktop/PathfinderUCD.dmg`
- 仓库副本：`dist/PathfinderUCD-darwin-arm64.dmg`
- SHA-256：`c82bb88cb8a00a1e806d5001ef0299cc33ee63a8fed761523d938524f64f7574`
- 文件大小：约 52 MB
- 架构：Apple Silicon arm64
- 签名：ad-hoc 本地签名，没有 Apple Developer ID 公证

最后一次交付校验包括：

- Wails production build 成功；
- DMG 可以挂载；
- DMG 内应用通过 `codesign --verify --deep --strict`；
- 主程序为 arm64 Mach-O；
- Applications 快捷方式存在；
- 运行数据库通过打包脚本校验；
- 仓库 DMG 与桌面 DMG 内容一致。

## 2. 已完成的产品改造

### 2.1 Pathfinder 品牌

- 将 Reasonix 品牌替换为 Pathfinder。
- 添加 Pathfinder 图标、符号和文字标识。
- 左侧品牌区域、欢迎页、启动页和 macOS 应用图标均已调整。
- 相关资源：
  - `desktop/frontend/src/assets/pathfinder-logo.png`
  - `desktop/frontend/src/assets/pathfinder-symbol.svg`
  - `desktop/frontend/src/assets/pathfinder-wordmark.svg`
  - `desktop/build/appicon.png`
  - `desktop/build/darwin/icon.icns`

### 2.2 学术助理化界面

- 将原本偏 AI Coding 的桌面界面简化为学术助理界面。
- 左侧栏向 ChatGPT 网页版的信息结构靠拢。
- 课程连接入口从聊天正文移到左侧底部区域，避免持续占用对话空间。
- 聊天输入区、欢迎页、启动页和设置入口已作相应精简。
- 相关文件：
  - `desktop/frontend/src/App.tsx`
  - `desktop/frontend/src/styles.css`
  - `desktop/frontend/src/components/Composer.tsx`
  - `desktop/frontend/src/components/Welcome.tsx`
  - `desktop/frontend/src/components/StartupSplash.tsx`

### 2.3 UC Davis Schedule Builder / Chrome 连接

- 保留并重新布置 Chrome 扩展配对功能。
- 可以生成配对码、打开 Schedule Builder、控制当前会话授权。
- 连接状态放在左侧栏和设置的连接页面，不再常驻聊天主内容区。
- 支持处理配对、登录、授权、限流等可恢复状态。
- Schedule Builder 查询改为接受 UC Davis 六位学期代码，并增加人类可读季度到代码的解析。
- 相关文件：
  - `desktop/frontend/src/components/ScheduleBridgeStatus.tsx`
  - `desktop/frontend/src/components/ScheduleBridgeBanner.css`
  - `extensions/pathfinder-schedule-bridge/`
  - `internal/campus/native/live_schedule_tool.go`
  - `internal/campus/native/term_code.go`

注意：浏览器扩展本身仍需下一位负责人确认最终发布/安装方式，当前 DMG 主要交付桌面应用。

### 2.4 学生记忆系统

设置中的记忆区已改造成学生档案，支持维护：

- 成绩单与课程成绩；
- 简历与经历；
- 个人时间表；
- 课程表；
- 学术与写作风格；
- 专业或意向专业；
- 学院；
- 个人偏好与限制。

学生档案会写入用户记忆文档，并供新对话自动读取。它与当前聊天右侧栏的“已知/未知”不同：

- 学生记忆是长期资料；
- 右侧栏的已知/未知只属于当前聊天；
- 当前聊天事实不会自动写入长期记忆。

相关文件：

- `desktop/frontend/src/components/StudentMemoryPanel.tsx`
- `desktop/frontend/src/lib/studentMemory.ts`
- `desktop/frontend/src/components/MemoryPanel.tsx`
- `desktop/frontend/src/__tests__/student-memory.test.tsx`

### 2.5 中英文界面

- 添加简体中文、繁体中文、英文界面支持。
- 右下角设置附近具有语言切换入口。
- Agent 的可见回复、待办、已知和未知条目应匹配用户选择的响应语言。
- 相关文件：
  - `desktop/frontend/src/components/LanguageToggleButton.tsx`
  - `desktop/frontend/src/lib/languageToggle.ts`
  - `desktop/frontend/src/locales/en.ts`
  - `desktop/frontend/src/locales/zh.ts`
  - `desktop/frontend/src/locales/zh-TW.ts`

### 2.6 API Key 设置恢复

- 恢复了设置中的 “Models & API / 模型与 API” 页面。
- 恢复命令面板进入模型/API 设置的入口。
- 用户可以重新配置、更新或清除 Provider API Key。
- 相关文件：
  - `desktop/frontend/src/components/SettingsPanel.tsx`
  - `desktop/frontend/src/App.tsx`
  - `desktop/settings_app_test.go`

设计和实施计划：

- `docs/superpowers/specs/2026-07-22-pathfinder-api-key-settings-design.md`
- `docs/superpowers/plans/2026-07-22-pathfinder-api-key-settings.md`

### 2.7 右侧“待办 / 已知内容 / 未知内容”

这是最后一轮完成并已经按功能拆分提交到 Git 的主要改造。

右侧栏现在固定分为：

1. 待办：实时显示 `pending`、`in_progress`、`completed`；
2. 已知内容：当前聊天中用户明确提供或成功工具证据确认的事实；
3. 未知内容：根据已知事实、用户答案、工具结果和未完成待办实时维护的关键缺口。

行为规则：

- 用户回答未知项后，从未知中移除；如相关且可靠，转为已知；
- 成功工具证据可进入已知；
- 空结果、失败结果、推测和一般经验不能进入已知；
- 登录、配对或数据访问问题可以概括为未知条件；
- 三块内容由一次完整的 `todo_write` 快照驱动；
- 主机自动推进待办、历史恢复和重启不会丢失已知/未知；
- 旧版只有 `todos` 的历史仍然兼容；
- 失败、取消、损坏、嵌套或子 Agent 的快照不能覆盖主聊天状态；
- 完成后可以自动收起，但重新展开仍能看到已知/未知；
- 每块独立滚动，并有双语标题、数量和空状态；
- Todo 状态有可访问性文本。

核心结构：

```json
{
  "todos": [
    {
      "content": "核验课程先修要求",
      "status": "in_progress"
    }
  ],
  "known": [
    "学生计划在 2026 Spring 选课"
  ],
  "unknown": [
    "尚未确认学生已完成的先修课程"
  ]
}
```

限制：

- 最多 8 个 Todo；
- 最多一个 `in_progress`；
- Known 最多 10 项；
- Unknown 最多 10 项；
- 所有条目必须为非空字符串；
- 前后端都执行损坏快照校验。

相关文件：

- `internal/evidence/evidence.go`
- `internal/campus/native/progress_tool.go`
- `internal/campus/native/tools.go`
- `internal/agent/agent.go`
- `desktop/app.go`
- `desktop/frontend/src/lib/tools.ts`
- `desktop/frontend/src/lib/todoSnapshot.ts`
- `desktop/frontend/src/lib/todoVisibility.ts`
- `desktop/frontend/src/components/TodoRail.tsx`
- `desktop/frontend/src/App.tsx`
- `desktop/frontend/src/styles.css`

设计和计划：

- `docs/superpowers/specs/2026-07-22-pathfinder-consultation-knowledge-rail-design.md`
- `docs/superpowers/plans/2026-07-22-pathfinder-consultation-knowledge-rail.md`

## 3. 数据库和打包修复

此前所有本地数据库报 `unable to open database file (14)`，主要原因是应用包没有稳定携带运行数据，或运行时路径解析不一致。

已完成：

- 增加统一的 Pathfinder 数据目录解析；
- 打包时注入并校验必要数据库；
- 支持从应用 Resources/data 读取数据库；
- 增加六位 UC Davis term code 处理；
- DMG 打包脚本会验证数据、签名、架构和挂载内容。

默认数据源：

`desktop/PathfinderUCD.app/Contents/Resources/data`

当前打包白名单包含：

- `rmp.db`
- `courses.db`
- `majors.db`
- `changemajor.db`
- `ucdavis_calendar.db`

相关脚本：

- `desktop/scripts/stage-runtime-data.sh`
- `desktop/scripts/stage-runtime-data_test.sh`
- `desktop/scripts/package-local-dmg.sh`

设计和计划：

- `docs/superpowers/specs/2026-07-22-pathfinder-data-packaging-term-codes-design.md`
- `docs/superpowers/plans/2026-07-22-pathfinder-data-packaging-term-codes.md`

## 4. Git 提交情况

右侧咨询状态栏相关提交已经进入当前分支：

```text
6cd2033f fix: harden consultation snapshot validation
14af4342 feat: add known and unknown consultation rail
5ea3c080 fix: reject malformed consultation todo snapshots
80e9916a feat: synchronize consultation snapshots in the frontend
89f79ba7 fix: refresh consultation state after empty results
a2c2776c fix: require complete consultation snapshots
252f8089 feat: maintain live academic knowledge gaps
80ca30ba fix: validate live consultation updates
a32524c8 fix: reject malformed consultation snapshots
3cf760da fix: harden consultation history replay
3aca215a fix: preserve consultation knowledge during progress updates
51a4f0c2 fix: require todo snapshot array
fc3ae59d feat: add structured consultation snapshots
```

对应设计/计划提交：

```text
da25927b docs: plan consultation knowledge rail
2f7479a7 docs: specify consultation knowledge rail
ca77a7e2 docs: plan API key settings restoration
7e9ae16d docs: specify API key settings restoration
598e2b50 docs: plan Pathfinder data packaging fixes
6531d862 docs: specify Pathfinder data packaging and term codes
```

## 5. 非常重要：当前工作区不是干净状态

最终 DMG 是从当前工作区构建的，而不是只从已提交 commit 构建。

较早完成的品牌、侧栏、学生记忆、语言、Schedule Bridge、API 设置、数据库路径等大量改动目前仍然是 modified 或 untracked。它们已经进入最终 DMG，但没有全部被整理成 Git 提交。

下一位负责人接手后的第一条规则：

> 不要运行 `git reset --hard`、`git checkout -- .`、`git clean -fd`，也不要用新的干净 checkout 覆盖当前目录。

否则可能丢失：

- Pathfinder Logo 和图标；
- 侧栏及欢迎页改造；
- 学生记忆组件；
- 语言切换组件；
- Schedule Bridge 状态组件；
- 打包脚本；
- term code 文件；
- 相关测试；
- 最终 DMG 所依赖的未提交实现。

建议接手者先：

1. 备份整个项目目录；
2. 保存一份 `git status --short`；
3. 按功能逐组审查和提交现有改动；
4. 每组提交后重新跑对应测试；
5. 最后从纯 Git 状态重建一次 DMG，确认可复现。

## 6. 已验证的测试和构建

最终一轮已通过：

- `internal/evidence` 测试；
- `internal/campus/native` 测试；
- Agent 的咨询快照、实时更新和历史重建相关测试；
- desktop 历史恢复相关测试；
- Todo snapshot 前端测试；
- Todo visibility 测试；
- consultation rail 测试；
- Pathfinder 双语测试；
- TypeScript typecheck；
- CSS syntax 与 z-index 检查；
- 前端 `test:all`；
- 前端 production build；
- Wails macOS arm64 production build；
- DMG 挂载、签名、数据和架构校验。

前端常用命令：

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm run test:consultation-rail
/opt/homebrew/bin/pnpm run test:pathfinder
/opt/homebrew/bin/pnpm run typecheck
/opt/homebrew/bin/pnpm run check:css
/opt/homebrew/bin/pnpm run test:all
/opt/homebrew/bin/pnpm run build
```

后端关键测试：

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/evidence ./internal/campus/native -count=1
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/agent -run 'Test(LiveTodoWrite.*|RebuildConsultationSnapshotPreservesKnowledge|RebuildTodoState.*)$' -count=1

cd desktop
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test . -run 'TestHistory.*' -count=1
```

## 7. 已知问题和风险

### 7.1 根目录完整 Go 测试目前不通过

`go test ./...` 或过宽的 Agent 测试选择会因许多 `internal/tool/builtin` 文件被删除而失败，例如：

- `todo.go`
- `completestep.go`
- `bash.go`
- `writefile.go`
- `editfile.go`
- 其他 Coding 工具文件

表现包括：

```text
todo_write builtin not registered
complete_step builtin not registered
```

这些删除看起来与“去除 AI Coding 功能、保留学术助理功能”的产品方向有关，但当前没有被整理为一个可审计的独立提交。

下一位负责人必须决定：

- 如果删除是刻意的：同步删除或改写依赖这些工具的旧测试和注册逻辑；
- 如果删除是误操作：从正确的上游版本恢复必要文件；
- 不要在未确认产品方向前直接全部恢复，否则可能把已移除的 Coding 功能重新带回界面和运行时。

### 7.2 浏览器扩展交付尚未完成闭环

桌面端连接功能存在，但仍需确认：

- Chrome 扩展是否有正式打包产物；
- 用户从哪里安装扩展；
- 扩展 ID 和配对权限是否稳定；
- Schedule Builder 域名、登录状态和 CSP 是否在目标机器正常；
- 微信连接是否实际存在；当前更明确的是 Telegram/消息渠道与 Chrome Schedule Bridge。

### 7.3 DMG 没有 Apple 公证

当前应用使用 ad-hoc 签名。其他 Mac 首次打开可能出现 Gatekeeper 提示。

正式分发需要：

- Apple Developer ID Application 证书；
- `codesign --options runtime`；
- Apple notarization；
- stapling；
- 在另一台干净 Mac 上测试。

### 7.4 数据更新机制仍是静态打包

当前数据库从 `desktop/PathfinderUCD.app/Contents/Resources/data` 注入。课程、教授评分、日历数据更新时，需要重新生成或替换数据并重新打包。

建议后续增加：

- 数据版本文件；
- 启动时版本显示；
- 可控的数据更新机制；
- 数据库 schema/完整性检查；
- 旧版本回滚。

### 7.5 最终版本未完成全面人工 UI 验收

已完成自动化测试和 DMG 技术校验，但仍建议在安装后的真实应用中人工检查：

- 三块右侧栏在长列表、空列表和窄窗口下的视觉效果；
- 已知/未知随真实 Agent 对话实时迁移；
- 切换语言后 Agent 新回复及三块列表语言一致；
- 关闭和重新打开历史聊天后的恢复；
- API Key 保存后真实模型请求；
- Chrome 配对、登录和 Schedule Builder 查询；
- 学生记忆保存、重启和新聊天读取；
- 深色/浅色主题；
- Logo 在 Retina 和不同缩放比例下的清晰度。

### 7.6 有少量遗留死代码

旧的 `TodoPanel.tsx` 和 `todobar__*` CSS 可能已经不再使用。此前审查将其视为非阻塞清理项。

清理前必须先用 `rg` 确认没有其他入口引用。

## 8. 构建与打包方法

### 8.1 前端构建

```bash
cd /Users/richis/Documents/RMP咨询APP/DeepSeek-Reasonix/desktop/frontend
/opt/homebrew/bin/pnpm run build
```

### 8.2 Wails 构建

```bash
cd /Users/richis/Documents/RMP咨询APP/DeepSeek-Reasonix/desktop
PATH="/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin:/Users/richis/go/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin" \
  /Users/richis/go/bin/wails build -platform darwin/arm64 -clean
```

如果出现：

```text
resource fork, Finder information, or similar detritus not allowed
```

可执行：

```bash
xattr -cr build/bin/pathfinder-ucd.app
codesign --force --deep -s - build/bin/pathfinder-ucd.app
codesign --verify --deep --strict build/bin/pathfinder-ucd.app
```

### 8.3 生成 DMG

```bash
cd /Users/richis/Documents/RMP咨询APP/DeepSeek-Reasonix
zsh desktop/scripts/package-local-dmg.sh
```

脚本会：

1. 复制应用并移除扩展属性；
2. 注入运行数据；
3. ad-hoc 签名；
4. 创建 DMG；
5. 挂载并校验；
6. 检查 arm64；
7. 复制到仓库 `dist` 和用户桌面；
8. 输出 SHA-256。

## 9. 建议的后续任务顺序

### P0：保护和固化当前成果

1. 完整备份项目目录和 DMG；
2. 审核所有未提交改动；
3. 按品牌、记忆、语言、Schedule Bridge、API 设置、数据打包分组提交；
4. 在纯 Git checkout 中重建应用和 DMG；
5. 对比新 DMG 与当前功能。

### P1：人工验收核心用户流程

1. 安装最终 DMG；
2. 配置 API Key；
3. 新建中英文聊天；
4. 触发多步骤选课咨询；
5. 检查待办/已知/未知实时更新；
6. 保存学生资料并开启新聊天；
7. 配对 Chrome 并查询真实 Schedule Builder；
8. 重启和恢复历史聊天。

### P1：处理 Coding 工具删除造成的测试债务

确认被删除的 `internal/tool/builtin` 文件是否属于正式产品裁剪，然后让代码、工具注册和测试保持一致。

### P2：正式发布

1. 构建 Chrome 扩展安装包；
2. 配置 Developer ID；
3. 公证和 stapling；
4. 在干净 Apple Silicon Mac 上安装测试；
5. 编写用户安装说明和隐私说明；
6. 建立版本号和更新机制。

## 10. 接手者快速检查清单

```text
[ ] 已备份整个 DeepSeek-Reasonix 目录
[ ] 已保存当前 git status
[ ] 没有执行 reset/clean/checkout 覆盖工作区
[ ] 可以打开 /Users/richis/Desktop/PathfinderUCD.dmg
[ ] 记录当前 SHA-256
[ ] API Key 设置可见并可保存
[ ] 学生记忆八类字段可编辑
[ ] 中英文切换正常
[ ] 右侧待办/已知/未知出现并实时更新
[ ] 历史聊天恢复三块状态
[ ] Chrome 扩展可以配对
[ ] Schedule Builder 查询真实可用
[ ] 已决定 Coding builtin 删除策略
[ ] 未提交改动已按功能整理
[ ] 可以从干净 Git 状态重建 DMG
```

## 11. 最重要的交接结论

当前 DMG 是可安装、经过技术校验的阶段性成果；右侧咨询状态系统已经形成较完整、已提交和有测试的实现。

最大的工程风险不是右侧栏本身，而是：

1. 最终 DMG 依赖大量尚未提交的早期工作区改动；
2. Coding builtin 的删除与旧测试尚未完成一致性清理；
3. 浏览器扩展和 Apple 正式签名尚未形成发布闭环；
4. 仍需要一次安装后的完整人工业务验收。

接手者应先保护现状、整理 Git，再继续开发。
