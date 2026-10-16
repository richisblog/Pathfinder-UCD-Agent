# Pathfinder UCD for DeepSeek Harness

[English](README.md) | **简体中文**

纯 **TypeScript** 插件，按 Harness 官方 Cordis 生命周期和 `defineTool` 接口实现。校园数据全部通过 [CourseScope](https://rmp.richis.top) 的只读 JSON API v1 获取；不读取本地数据库，不设本地数据回退。

提供教授/课程评价、评论关键词搜索与统计、官方课程目录、分学位转专业要求，以及实时咨询工作台。**不接入课表导入、账户或论坛。**

已验证 Harness **0.2.0-rc.2**；依赖固定在 `package-lock.json`。插件版本 **0.2.3**，网站接口契约核对日期 **2026-10-14**。

## 安装与启动

要求 Node.js **24+**、可用的 Harness 模型配置，以及连接 `https://rmp.richis.top` 的网络。不需要数据目录、Go 或 Pathfinder 桌面端。

```sh
git clone https://github.com/richisblog/Pathfinder-UCD-Agent.git
cd Pathfinder-UCD-Agent
npm ci
npm run build
npm run prepare-overlay
npx @deepseek-ai/dsh@0.2.0-rc.2 web --patch "$PWD/cordis.local.yml"
```

向已有 Harness overlay 加入：

```yaml
- insert:
    - id: pathfinder-ucd
      name: '/绝对路径/Pathfinder-UCD-Agent/dist/host.js'
      config:
        timeoutMs: 30000
```

插件入口需使用绝对路径。默认请求超时 30 秒，`timeoutMs` 范围 100–120000 毫秒。旧 `dataRoot` / `PATHFINDER_DATA_ROOT` 配置不再使用。桌面端将插件节点加入现有 overlay 后重启；不要覆盖模型或其他插件配置。重启 Harness 后 Host 加载新版本。历史会话保留已有产物与来源，但新查询全部访问网站；旧证据不自动升级为最新证据。

## 中英文与顶部滚动

工作台右上角可选择 **English / 中文 / 跟随 Harness**，偏好保存在当前浏览器中。固定界面文字、状态、证据说明、工具名称和可视化检查控件均支持两种语言。没有已知界面语言时默认英文；跟随模式实时响应 Harness 语言变化。

顶部概览包含标题、当前问题与研究进度，最大高度为 **320 px 或面板高度的 40%（取较小值）**，超出后可滚动，也可通过键盘聚焦后滚动。四个标签页、产物内容区和底栏在概览之外，分别保持可见和独立滚动。

语言切换不会修改学生原话、官方来源或已保存的 Agent 产物。新回复、四区文字和图表标签遵循学生指定语言，未指定时跟随学生提问语言；需要英文产物时直接要求 Agent 使用英文。数据配置与官方原文仍可核对，不自动改写证据。

## 网站工具

与 [OpenAPI](https://rmp.richis.top/openapi.json) 的 11 个 GET 端点一一对应；另外提供 `pathfinder_update_consultation` 更新右侧产物，以及 `pathfinder_assess_request` 做缺口评估和原生学生提问。

| 工具                                     | 用途                                                |
| ---------------------------------------- | --------------------------------------------------- |
| `pathfinder_search`                      | 解析中英文课程/教授名称，获取正式课程 key / 教授 ID |
| `pathfinder_get_course`                  | 课程信息与关联查询入口                              |
| `pathfinder_get_course_professors`       | 排序/筛选课程关联教授及课程评价统计                 |
| `pathfinder_get_professor`               | 教授身份与跨课程 RMP 总体指标                       |
| `pathfinder_get_professor_courses`       | 教授关联课程与课程统计                              |
| `pathfinder_get_professor_reviews`       | 教授完整评价，可限定课程、日期、置信度和游标        |
| `pathfinder_search_review_comments`      | FTS5 评论关键词/短语检索，重复 term，any/all 匹配   |
| `pathfinder_get_professor_course_stats`  | 单课程/教授的去重统计、分布与描述性趋势             |
| `pathfinder_get_official_catalog_course` | 官方课程名称、学分、先修和 GE 快照                  |
| `pathfinder_search_major_requirements`   | 按正式英文名称、OASIS 专业代码或学院查找转专业记录  |
| `pathfinder_get_major_requirements`      | 按 major_code 查询 AB / BS 独立要求原文             |

示例：“用 Pathfinder 比较 Ty Feng 的 ECS 20 和 ECS 140A，注明样本量与来源。”“查 MAT21C 学分、先修与 GE。”“比较 Mathematics AB 和 BS 的转专业要求，保留原文条件。”

旧本地工具已退役；没有任意 SQL、文件读取或任意 URL 请求工具。网站当前未提供校历、通用专业培养目录或政策文本接口，插件会明确说明该范围，不能用本地资料补齐。

网站使用规范已作为插件原生 system-prompt section 注入，包括 [AI 指南](https://rmp.richis.top/ai-guide?lang=zh)、[提示词](https://rmp.richis.top/ai-prompt.txt?lang=en)、[转专业指南](https://rmp.richis.top/major-guide.txt) 的实体解析、证据和统计规则。未采用其全局永久记忆指令；配置只影响本插件。

## 实时咨询工作台

对话顶部的“咨询工作台”按钮打开 Harness 原生右侧标签页。出现研究计划或查询证据后会自动打开；页面可按 Harness 的分栏、浮窗和全屏方式查看。

- **计划**：步骤、完成数量、当前动作、受阻项和对应证据。
- **结论**：区分证据支持与暂定判断，保留查询来源。
- **追问**：预测的延伸问题及理由；“填入追问”只替换输入草稿，不自动发送。
- **存疑**：未确认的判断、疑点原因、下一步核实方式和解决状态。

每次新问题或工具结果提交，Host 会话投影都会推动更新；客户端通过 Harness `useProjection` 订阅服务接收更新，不需要手动刷新。四个区域各自记录已同步的咨询版本。未复核的新内容显示“正在同步”或“等待同步”，已有产物继续保留。

这也是工具执行约束：Agent 必须先发布计划，查询后必须同步所有未更新区域，才能继续校园查询。未完成同步时准备结束回答，会得到最多两次补齐请求。同步拦截提示不是查询证据，不增加证据版本，也不被显示为 API 查询失败。每次成功查询结果还会附带原生延迟上下文，指明下一步更新哪些产物及如何使用 `reviewed_sections`。模型调用失败或取消时，界面保留待同步标记，不把旧内容伪装为已更新。非校园聊天不会触发这一流程。

`pathfinder_update_consultation` 支持部分更新。`reviewed_sections` 可确认已经复核但没有内容变化的区域，避免反复复制全文；`base_revision` 可拒绝过期写入。产物、来源及可视化配置随 Harness 会话日志保存，重开会话、历史回放和分支能恢复；不同会话互相隔离。仍在使用的历史证据会保留，不会仅因最近查询窗口滚动而丢失。

## 先澄清再研究

`pathfinder_assess_request` 区分已知学生信息和影响下一步决策的缺口。`needs_input` 调用 Harness 原生 `userQuestions.ask`，显示一个问题并等待真实回答；`ready` 表示当前研究步骤已有足够条件。学生回答单独记录为自述证据，不混同于官方目录或政策。回答后必须重新评估；仍有关键缺口就继续问一个问题，不要求一次填完个人资料。

“下学期我该选什么课？想选点有用的，别太难”这类请求在评估前会被查询 guard 阻止；不能用“通用本科生”假设绕过。问题出现时工作台显示“等待你补充信息”，普通课程名称/学分/先修事实查询不用收集个人背景。原生交互服务未就绪时不会注册该工具，模糊请求仍被阻止；模型应在对话中明确提问，不能继续猜选课方案。

右侧“追问”仍表示用户可以继续研究的延伸话题；它不替代当前决策所需的澄清问题。缺口评估仍由模型根据语义判断，执行规则提供兜底，不能保证识别所有自然语言表达。

## Agent 自主可视化

四个区域分别接受可视化配置，Agent 根据内容自行选择形式，也可保持原生列表。

| 形式       | 输入与交互                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------- |
| ECharts    | 标准 JSON `option`，支持柱状、折线、饼图、桑基、关系图、雷达、地图等；tooltip、图例与缩放由配置控制 |
| HTML / SVG | 自定义结构、流程、标注、表格与卡片；可用脚本进行点击、筛选                                          |
| Canvas     | 使用明确的 `data` 和绘制脚本进行自定义交互演示                                                      |

ECharts 随本地客户端 bundle 提供，无需 CDN。数值、坐标轴、标签与原始配置可在“核对数据与配置”中检查。配置只接受 JSON，不接受 ECharts 函数回调；关系图使用明确坐标或 circular 布局，地图需要嵌入 GeoJSON。脚本不允许直接随机绘图；复杂互动应基于声明的数据计算。

HTML/SVG/Canvas 使用独立 `allow-scripts` frame，脚本可读 `PATHFINDER_DATA` 和 `PATHFINDER_THEME`，可操作自己的展示内容；不授予宿主 DOM、账号或网络权限。主题、字号和原生按钮/标签/分段导航沿用 Harness；ECharts 数据更新使用 `setOption`，容器调整会 resize，卸载时 dispose。

每个配置注明 `origin`（查询证据、咨询产物或假设演示）、选择理由和来源引用。假设演示必须说明假设；引用查询证据的图表必须关联成功且非空的查询。原生文字和证据说明始终保留，便于复核图表。

## 查询行为与来源

- 请求固定发往 `https://rmp.richis.top/api/v1/`，仅 GET；不发送账号凭据，不自动跟随重定向。参数先经过 Harness DSL 校验，再验证端点白名单、数值范围、日期和标识符。
- 原始 API 内容保留在 `data`；`source.api_url` 是实际完整请求链接，`source.requested_at` 是 HTTP 请求时间，不能当作源数据采集时间或政策生效日。读取返回的 `fetched_at` / `as_of` 判断快照时点。网站服务独立于 UC Davis 与 RMP。
- 评价完整 `comment`、`course_raw` 与推断链接置信度保留。按课程比较用 `course_stats.overall.rating_mean` 和 `rating_n`，不能把跨课程教授均值当成本课程均值。近期评论活动不证明当前授课；学生自报成绩不是官方成绩分布。
- FTS5 是字面 token/短语匹配，必须读全文判断正反含义。小样本及自选择偏差仍需提示；趋势和区间不能被解释为因果或代表性证明。
- 列表 limit 最大 100。分页结果保留 `next_cursor`，由 Agent 按需继续请求，并保持筛选参数完全一致；插件不自动翻页或重试。不带游标的端点不假定有分页能力。
- 转专业 AB / BS 分别返回和引用。`not_displayed` 表示未显示要求文本，不能解释为没有要求；原文 AND/OR、成绩/GPA、计划与咨询条件保持不变。选项名称不是独立核实的选项要求，表单上下文与目录年份可能影响记录。不能根据不完整文本保证资格或录取。
- HTTP 错误、网络失败、超时、非 JSON 或超过 8 MiB 的响应明确失败；不会用旧本地数据库替代。超大查询请缩小 limit/范围，接受的文本不静默截断。

## 生命周期与范围

工具经 `ctx.tools.register(defineTool(...))` 注册，随 Cordis 卸载移除。原生异步 `fetch` 不阻塞 Host；用户取消、超时及卸载会中止请求，卸载等待在途请求收尾。不需要 SQLite 或 Worker。

进度感知、会话投影、实时更新约束和自主可视化沿用 Harness 原生接口。不会读取用户账号、论坛、课表或其他本地业务数据库。

## 验证与源码

```sh
npm test
npm run format:check
npm run test:live
```

离线回归检查真实 Harness 工具注册/执行、全部 API 路由、重复关键词与游标、参数/日期边界、空结果证据、错误/超时/取消/卸载，以及四区同步、历史回放、会话隔离和 ECharts/HTML/SVG/Canvas。`test:live` 通过原生 Harness 工具向网站发起实际 GET，覆盖全部 11 个查询工具，并独立核对 Mathematics AB / BS；结果保存至 `live-api-verification.json`，不保存评论全文或账号信息。

可视化层已完成带模型桌面对话检查，覆盖 SVG/ECharts/HTML 产物。网站版本已在本机完成 MAT21C 带模型桌面对话验证（24 秒）：仅一次成功目录请求，回答引用实际 API URL 与 fetched_at；四区分别产生计划、结论、追问和存疑并完成同步。初次越过计划的调用被 guard 阻止，模型补齐计划后继续。全部接口的实际请求验证见上述报告。

| 文件                           | 职责                                            |
| ------------------------------ | ----------------------------------------------- |
| `src/host.ts`                  | 原生 Host 配置、工具注册、请求生命周期          |
| `src/api-contract.ts`          | 已核对的官方 GET 端点与参数契约                 |
| `src/runtime.ts`               | 参数约束、只读 HTTP、来源、取消、超时与响应边界 |
| `src/protocol.ts`              | 经核对的 CourseScope Agent 使用规范             |
| `src/progress.ts`              | 实时进度上下文、执行约束、产物更新工具          |
| `src/consultation.ts`          | 会话投影、证据校验与独立同步版本                |
| `src/client/Workbench.tsx`     | Harness 原生咨询侧栏                            |
| `src/client/Visualization.tsx` | ECharts 与 HTML/SVG/Canvas 展示                 |
| `src/visualization.ts`         | 可视化结构、确定性与来源校验                    |
| `src/prepare-overlay.ts`       | 生成无需本地数据库的安装配置                    |

官方参考：[插件入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)、[工具定义](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md)、[工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)。

## 从旧版本迁移

仓库从 v0.2.2 起以 Harness 原生 TypeScript 插件为主体，替代之前基于 DeepSeek-Reasonix 的 Go/Wails 应用。迁移说明见 [docs/MIGRATION.md](docs/MIGRATION.md)。旧版本保留在 Git 历史和历史发布中；旧 DMG 不包含本插件的新功能。
