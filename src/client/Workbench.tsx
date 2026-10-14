import { useEffect, useId, useState } from 'react'
import { Button, Tag, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConsultationBoard, Evidence } from '../consultation.js'
import { Visualization } from './Visualization.js'

export type WorkbenchProps = PropsRuntime<'sidebar.right.pane.tab'> & {
  fillQuestion: (
    sessionId: PropsRuntime<'sidebar.right.pane.tab'>['sessionId'],
    question: string,
  ) => void
}
const empty: ConsultationBoard = {
  visualizations: {},
  active: false,
  update_cause: 'question',
  goal: '',
  plan: [],
  conclusions: [],
  questions: [],
  uncertainties: [],
  evidence: [],
  pending: {},
  phase: 'idle',
  running: false,
  evidence_revision: 0,
  section_revisions: { plan: 0, conclusions: 0, questions: 0, uncertainties: 0 },
  revision: 0,
  last_seq: -1,
  error: '',
}
const phaseLabels = {
  idle: '等待咨询',
  planning: '制定计划',
  clarifying: '等待你补充信息',
  researching: '检索证据',
  synthesizing: '整理结论',
  complete: '计划已完成',
  attention: '有待核实',
  paused: '等待继续',
}
const tools: Record<string, string> = {
  assess_request: '向学生澄清',
  search: '课程与教授检索',
  get_course: '课程信息',
  get_course_professors: '课程教授比较',
  get_professor: '教授档案',
  get_professor_courses: '教授关联课程',
  get_professor_reviews: '教授评价',
  search_review_comments: '评价关键词',
  get_professor_course_stats: '课程评价统计',
  get_official_catalog_course: '官方课程目录',
  search_major_requirements: '转专业检索',
  get_major_requirements: '分学位转专业要求',
  // Older session logs retain their original tool labels.

  search_professors: '教授检索',
  professors_for_course: '课程授课关联',
  professor_reviews: '教授评价',
  search_reviews_by_keywords: '评价关键词',
  query_rmp_table: '评价数据库',
  query_course_db: '课程目录',
  query_major_catalog: '专业目录',
  query_change_major: '转专业要求',
  compare_change_major_requirements: '专业要求比较',
  query_ucdavis_calendar: '校历',
  search_txt_context: '政策资料',
}
function toolLabel(name: string): string {
  return tools[name.replace('pathfinder_', '')] || '校园查询'
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="pfw-empty">
      <span className="pfw-empty-mark" aria-hidden="true">
        ◇
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  )
}
function Sources({ ids, evidence }: { ids: readonly string[]; evidence: readonly Evidence[] }) {
  if (!ids.length) return null
  return (
    <details className="pfw-sources">
      <summary>查看证据 · {ids.length}</summary>
      {ids.map((id) => {
        const source = evidence.find((x) => x.id === id)
        return (
          <div className="pfw-source" key={id}>
            <strong>{source ? toolLabel(source.tool) : '历史证据'}</strong>
            <span>{source?.summary || '此证据不在最近记录中'}</span>
            <small>
              {source?.source} · {id.slice(0, 12)}
            </small>
          </div>
        )
      })}
    </details>
  )
}
export function Workbench(props: WorkbenchProps) {
  const board = props.useProjection('pathfinder.consultation') || empty
  const [section, setSection] = useState<'plan' | 'conclusions' | 'questions' | 'uncertainties'>(
    'plan',
  )
  const [error, setError] = useState('')
  const prefix = useId()
  const done = board.plan.filter((x) => x.status === 'completed').length
  const total = board.plan.length
  const unresolved = board.uncertainties.filter((x) => x.status === 'open').length
  const current =
    board.plan.find((x) => x.status === 'in_progress') ||
    board.plan.find((x) => x.status === 'pending')
  const recent = board.evidence.slice(-5).reverse()
  const tabs = [
    {
      value: 'plan' as const,
      label: `计划 ${total || ''}`,
      id: `${prefix}-plan`,
      panelId: `${prefix}-body`,
    },
    {
      value: 'conclusions' as const,
      label: `结论 ${board.conclusions.length || ''}`,
      id: `${prefix}-conclusions`,
      panelId: `${prefix}-body`,
    },
    {
      value: 'questions' as const,
      label: `追问 ${board.questions.length || ''}`,
      id: `${prefix}-questions`,
      panelId: `${prefix}-body`,
    },
    {
      value: 'uncertainties' as const,
      label: `存疑 ${unresolved || ''}`,
      id: `${prefix}-uncertainties`,
      panelId: `${prefix}-body`,
    },
  ] as const
  return (
    <div className="pfw-workbench">
      <header className="pfw-header">
        <div>
          <span className="pfw-brand">PATHFINDER</span>
          <h2>咨询工作台</h2>
        </div>
        <Tag tone={board.running ? 'info' : unresolved ? 'warning' : 'neutral'}>
          {phaseLabels[board.phase]}
        </Tag>
      </header>
      <div className="pfw-goal">
        <span className="pfw-eyebrow">当前研究问题</span>
        <p>{board.goal || '从一个选课、教授或专业问题开始'}</p>
      </div>
      <section className="pfw-progress" aria-label="研究进度">
        <div className="pfw-line">
          <strong>研究进度</strong>
          <span>
            {total
              ? `${done} / ${total} 步已完成`
              : board.phase === 'clarifying'
                ? '先明确咨询方向'
                : '尚未制定计划'}
          </span>
        </div>
        <div
          className="pfw-progress-track"
          role="progressbar"
          aria-label="已完成研究步骤"
          aria-valuemin={0}
          aria-valuemax={Math.max(total, 1)}
          aria-valuenow={done}
        >
          <span style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
        </div>
        <div className="pfw-progress-next">
          <span className={board.running ? 'pfw-live-dot' : 'pfw-dot'} />
          {board.phase === 'clarifying'
            ? '等待你的回答，再确定研究方向'
            : Object.values(board.pending)[0]
              ? `正在查询 · ${toolLabel(Object.values(board.pending)[0]!.name)}`
              : current
                ? `下一步 · ${current.title}`
                : total && done === total
                  ? '研究计划已完成；存疑项仍独立保留'
                  : '计划、证据和结论会随对话更新'}
        </div>
      </section>
      {board.error && board.phase !== 'clarifying' && (
        <div className="pfw-notice" role="status">
          {board.error}
        </div>
      )}
      <div className="pfw-tabbar">
        <SegmentedTabs items={tabs} value={section} onChange={setSection} label="咨询产物" />
      </div>
      <div
        className="pfw-scroll"
        id={`${prefix}-body`}
        role="tabpanel"
        aria-labelledby={`${prefix}-${section}`}
      >
        {board.active && board.section_revisions[section] < board.evidence_revision && (
          <div className="pfw-sync" role="status">
            {board.phase === 'clarifying'
              ? '等待你的回答，'
              : board.update_cause === 'question'
                ? '研究问题已变化，'
                : '新证据已到达，'}
            {board.phase === 'clarifying'
              ? '随后复核'
              : board.running
                ? 'Agent 正在更新'
                : '待 Agent 更新'}
            {
              {
                plan: '研究计划',
                conclusions: '结论',
                questions: '后续问题',
                uncertainties: '存疑项',
              }[section]
            }
            …
          </div>
        )}
        {board.visualizations[section] && <Visualization spec={board.visualizations[section]!} />}
        {section === 'plan' &&
          (total ? (
            <ol className="pfw-plan">
              {board.plan.map((step, index) => (
                <li key={step.id} className={`pfw-step pfw-step-${step.status}`}>
                  <span className="pfw-step-number">
                    {step.status === 'completed' ? '✓' : index + 1}
                  </span>
                  <div>
                    <div className="pfw-line">
                      <h3>{step.title}</h3>
                      <Tag
                        tone={
                          step.status === 'completed'
                            ? 'success'
                            : step.status === 'in_progress'
                              ? 'info'
                              : step.status === 'blocked'
                                ? 'warning'
                                : 'quiet'
                        }
                      >
                        {
                          {
                            pending: '待进行',
                            in_progress: '进行中',
                            completed: '已完成',
                            blocked: '受阻',
                          }[step.status]
                        }
                      </Tag>
                    </div>
                    {step.note && <p>{step.note}</p>}
                    <Sources ids={step.evidence_ids} evidence={board.evidence} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty
              title={
                board.phase === 'clarifying' ? '先补充影响决策的信息' : '先把问题拆成可验证的步骤'
              }
              detail={
                board.phase === 'clarifying'
                  ? '请回答对话中的澄清问题。Agent 会根据你的回答制定下一步，不会先猜一组课程。'
                  : '复杂咨询会先制定研究计划，再逐步查询证据。完成状态以实际查询结果为依据。'
              }
            />
          ))}
        {section === 'conclusions' &&
          (board.conclusions.length ? (
            <div className="pfw-items">
              {board.conclusions.map((item, index) => (
                <article className="pfw-item" key={item.id}>
                  <div className="pfw-line">
                    <span className="pfw-eyebrow">结论 {String(index + 1).padStart(2, '0')}</span>
                    <Tag tone={item.confidence === 'supported' ? 'success' : 'warning'}>
                      {item.confidence === 'supported' ? '有证据支持' : '暂定判断'}
                    </Tag>
                  </div>
                  <p className="pfw-claim">{item.text}</p>
                  <Sources ids={item.evidence_ids} evidence={board.evidence} />
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="结论会留在这里"
              detail="每条结论区分证据支持与暂定判断，并保留可追溯的查询来源。"
            />
          ))}
        {section === 'questions' && (
          <>
            <div className="pfw-section-note">
              根据当前研究进展预测的延伸问题，由你决定是否继续。
            </div>
            {board.questions.length ? (
              <div className="pfw-items">
                {board.questions.map((item, index) => (
                  <article className="pfw-item pfw-question" key={item.question}>
                    <span className="pfw-eyebrow">可能的下一问 · {index + 1}</span>
                    <h3>{item.question}</h3>
                    <p>{item.reason}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      title="填入当前会话输入框，不会自动发送"
                      onClick={() => {
                        try {
                          props.fillQuestion(props.sessionId, item.question)
                          setError('')
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '无法填入输入框')
                        }
                      }}
                    >
                      填入追问 ↗
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title="留出继续探索的空间"
                detail="整理完结论后，这里会出现贴合你的问题的下一步建议。"
              />
            )}
            {error && (
              <p role="alert" className="pfw-notice">
                {error}
              </p>
            )}
          </>
        )}
        {section === 'uncertainties' &&
          (board.uncertainties.length ? (
            <div className="pfw-items">
              {board.uncertainties.map((item) => (
                <article className="pfw-item" key={item.id}>
                  <div className="pfw-line">
                    <span className="pfw-eyebrow">待核实结论</span>
                    <Tag tone={item.status === 'resolved' ? 'success' : 'warning'}>
                      {item.status === 'resolved' ? '已核实' : '待核实'}
                    </Tag>
                  </div>
                  <h3>{item.claim}</h3>
                  <p>{item.reason}</p>
                  <div className="pfw-verification">
                    <span className="pfw-eyebrow">核实方式</span>
                    <p>{item.next_action}</p>
                  </div>
                  <Sources ids={item.evidence_ids} evidence={board.evidence} />
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="让不确定性保持可见"
              detail="资料缺失、结果冲突或匹配不明确时，会在这里说明原因和具体核实方式。暂无记录不代表所有结论都已验证。"
            />
          ))}
        <details className="pfw-evidence">
          <summary>
            最近查询证据 <span>{board.evidence.length}</span>
          </summary>
          {recent.length ? (
            recent.map((item) => (
              <div className="pfw-evidence-row" key={item.id}>
                <span className={`pfw-dot pfw-dot-${item.status}`} />
                <div>
                  <strong>{toolLabel(item.tool)}</strong>
                  <p>{item.summary}</p>
                  <small>
                    {item.source || '未取得可用来源'} · {item.id.slice(0, 12)}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="pfw-section-note">还没有校园查询记录。</p>
          )}
        </details>
      </div>
      <footer className="pfw-footer">
        <span>仅当前会话 · 来源见查询证据</span>
        <span role="status">
          {board.phase === 'clarifying'
            ? '等待你补充信息'
            : board.active && board.section_revisions[section] < board.evidence_revision
              ? board.running
                ? '正在同步咨询产物'
                : '等待同步咨询产物'
              : '已同步当前内容'}
        </span>
      </footer>
    </div>
  )
}

export type EntryProps = PropsRuntime<'conversation.session.header.actions'> & {
  openWorkbench: () => void
}
export function WorkbenchEntry(props: EntryProps) {
  const board = props.useProjection('pathfinder.consultation')
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (!opened && (board?.plan.length || board?.evidence.length)) {
      props.openWorkbench()
      setOpened(true)
    }
  }, [board?.plan.length, board?.evidence.length, opened, props.openWorkbench])
  return (
    <Button
      variant="toolbar"
      size="sm"
      onClick={props.openWorkbench}
      title="研究计划、结论、追问与存疑项"
    >
      咨询工作台
    </Button>
  )
}
