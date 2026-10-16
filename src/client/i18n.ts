import { useSyncExternalStore } from 'react'
export type Language = 'en' | 'zh'
export type LanguagePreference = Language | 'auto'
const KEY = 'pathfinder.ui-language'
let systemLanguage: Language =
  typeof document !== 'undefined' && document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'
const listeners = new Set<() => void>()
export function getLanguagePreference(): LanguagePreference {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'en' || value === 'zh' ? value : 'auto'
  } catch {
    return 'auto'
  }
}
export function getLanguage(): Language {
  const pref = getLanguagePreference()
  return pref === 'auto' ? systemLanguage : pref
}
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function emit(): void {
  for (const listener of listeners) listener()
}
export function setSystemLanguage(value: string): void {
  systemLanguage = value.startsWith('zh') ? 'zh' : 'en'
  emit()
}
export function setLanguagePreference(value: LanguagePreference): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {}
  emit()
}
export function useLanguage(): Language {
  useSyncExternalStore(
    subscribeLanguage,
    () => `${getLanguagePreference()}:${getLanguage()}`,
    () => 'auto:en',
  )
  return getLanguage()
}
export const english: Record<string, string> = {
  咨询工作台: 'Consultation workbench',
  'Pathfinder 咨询工作台': 'Pathfinder consultation workbench',
  '研究计划、结论、下一步追问与待核实事项':
    'Research plans, findings, follow-ups and uncertainties',
  '研究计划、结论、追问与存疑项': 'Research plans, findings, follow-ups and uncertainties',
  '当前会话还未就绪，请稍后重试': 'This session is not ready yet. Try again shortly.',
  等待咨询: 'Ready to help',
  制定计划: 'Planning',
  等待你补充信息: 'Waiting for your input',
  检索证据: 'Gathering evidence',
  整理结论: 'Synthesizing findings',
  计划已完成: 'Plan complete',
  有待核实: 'Needs verification',
  等待继续: 'Paused',
  向学生澄清: 'Student clarification',
  课程与教授检索: 'Course and instructor search',
  课程信息: 'Course information',
  课程教授比较: 'Instructor comparison',
  教授档案: 'Instructor profile',
  教授关联课程: 'Instructor courses',
  教授评价: 'Instructor reviews',
  评价关键词: 'Review keywords',
  课程评价统计: 'Course review statistics',
  官方课程目录: 'Official course catalog',
  转专业检索: 'Major-change search',
  分学位转专业要求: 'Degree-specific major-change requirements',
  教授检索: 'Instructor search',
  课程授课关联: 'Course–instructor links',
  评价数据库: 'Review records',
  课程目录: 'Course catalog',
  专业目录: 'Major catalog',
  转专业要求: 'Major-change requirements',
  专业要求比较: 'Requirements comparison',
  校历: 'Academic calendar',
  政策资料: 'Policy sources',
  校园查询: 'Campus lookup',
  查看证据: 'View evidence',
  历史证据: 'Historical evidence',
  此证据不在最近记录中: 'This evidence is outside the recent window',
  计划: 'Plan',
  结论: 'Findings',
  追问: 'Follow-ups',
  存疑: 'Uncertainties',
  当前研究问题: 'Current research question',
  '从一个选课、教授或专业问题开始': 'Start with a course, instructor or major question',
  研究进度: 'Research progress',
  已完成研究步骤: 'Completed research steps',
  先明确咨询方向: 'Clarifying your direction',
  尚未制定计划: 'No plan yet',
  '等待你的回答，再确定研究方向': 'Waiting for your answer before choosing a research direction',
  正在查询: 'Looking up',
  下一步: 'Next step',
  '研究计划已完成；存疑项仍独立保留': 'Plan complete; uncertainties remain visible',
  '计划、证据和结论会随对话更新':
    'Plans, evidence and findings update as the conversation develops',
  咨询产物: 'Consultation artifacts',
  '等待你的回答，': 'Waiting for your answer; ',
  '研究问题已变化，': 'The research question changed; ',
  '新证据已到达，': 'New evidence arrived; ',
  随后复核: 'then reviewing ',
  'Agent 正在更新': 'the agent is updating ',
  '待 Agent 更新': 'the agent will update ',
  研究计划: 'research plan',
  后续问题: 'follow-up questions',
  存疑项: 'uncertainties',
  待进行: 'Pending',
  进行中: 'In progress',
  已完成: 'Completed',
  受阻: 'Blocked',
  先补充影响决策的信息: 'Clarify the information that affects your decision',
  先把问题拆成可验证的步骤: 'Break the question into verifiable steps',
  '请回答对话中的澄清问题。Agent 会根据你的回答制定下一步，不会先猜一组课程。':
    'Answer the clarification in the conversation. The agent will use your answer to choose the next step.',
  '复杂咨询会先制定研究计划，再逐步查询证据。完成状态以实际查询结果为依据。':
    'Complex consultations start with a plan, then gather evidence. Completion is based on actual query results.',
  有证据支持: 'Supported by evidence',
  暂定判断: 'Tentative',
  结论会留在这里: 'Your findings will appear here',
  '每条结论区分证据支持与暂定判断，并保留可追溯的查询来源。':
    'Each finding distinguishes evidence from interpretation and retains traceable sources.',
  '根据当前研究进展预测的延伸问题，由你决定是否继续。':
    'Suggested follow-ups based on the research so far. You decide whether to continue.',
  可能的下一问: 'Possible next question',
  '填入当前会话输入框，不会自动发送': 'Fill the current draft without sending it',
  无法填入输入框: 'Could not fill the draft',
  '填入追问 ↗': 'Add to draft ↗',
  留出继续探索的空间: 'Keep exploring',
  '整理完结论后，这里会出现贴合你的问题的下一步建议。':
    'After the findings are organized, relevant next steps will appear here.',
  待核实结论: 'Claim to verify',
  已核实: 'Verified',
  待核实: 'Unverified',
  核实方式: 'How to verify',
  让不确定性保持可见: 'Keep uncertainty visible',
  '资料缺失、结果冲突或匹配不明确时，会在这里说明原因和具体核实方式。暂无记录不代表所有结论都已验证。':
    'Missing sources, conflicting results and ambiguous matches are explained here with verification steps. An empty list does not mean every finding is verified.',
  最近查询证据: 'Recent evidence',
  未取得可用来源: 'No source available',
  '还没有校园查询记录。': 'No campus queries yet.',
  '仅当前会话 · 来源见查询证据': 'This session only · Sources in query evidence',
  正在同步咨询产物: 'Updating artifacts',
  等待同步咨询产物: 'Artifact update pending',
  已同步当前内容: 'Current content synchronized',
  查询证据: 'Query evidence',
  假设演示: 'Assumed scenario',
  '假设：': 'Assumptions: ',
  核对数据与配置: 'Inspect data and configuration',
  '来源引用：': 'Evidence references: ',
  当前咨询产物或已注明假设: 'Current artifacts or stated assumptions',
  无法显示此图表: 'Could not render this chart',
  '查询失败，保留现有证据并等待核实':
    'The query failed. Existing evidence is preserved for verification.',
  '咨询产物未通过证据校验，保留此前版本':
    'Artifact validation failed. The previous version is preserved.',
  '学生本轮回答（未经官方核验）': 'Student response (not independently verified)',
  语言: 'Language',
  '跟随 Harness': 'Follow Harness',
  顶部咨询概览: 'Consultation overview',
}
export function t(text: string, language: Language): string {
  if (language === 'zh') return text
  if (english[text]) return english[text]!
  return text
    .replace(
      /^CourseScope 返回 (\d+) 条记录（还有下一页）$/,
      'CourseScope returned $1 records (more pages available)',
    )
    .replace(/^CourseScope 返回 (\d+) 条记录$/, 'CourseScope returned $1 records')
    .replace(/^学生自述：/, 'Student reported: ')
    .replace(/^返回 (\d+) 条记录（结果有截断）$/, 'Returned $1 records (truncated)')
    .replace(/^返回 (\d+) 条记录$/, 'Returned $1 records')
}
