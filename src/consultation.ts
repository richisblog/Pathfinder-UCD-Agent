import { z } from 'zod'
import { intakeSchema, answerSchema } from './intake-state.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { visualizationsSchema, validateVisualization, SECTIONS } from './visualization.js'

export const PROJECTION = 'pathfinder.consultation' as const
const text = z.string().max(1800)
const refs = z.array(z.string().max(160)).max(12)
export const documentSchema = z.object({
  goal: z.string().max(600),
  visualizations: visualizationsSchema.default({}),
  plan: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().min(1).max(260),
        status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
        evidence_ids: refs,
        note: text,
      }),
    )
    .max(12),
  conclusions: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        text,
        confidence: z.enum(['supported', 'tentative']),
        evidence_ids: refs,
      }),
    )
    .max(12),
  questions: z
    .array(z.object({ question: z.string().min(1).max(400), reason: z.string().max(400) }))
    .max(6),
  uncertainties: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        claim: text,
        reason: text,
        next_action: text,
        status: z.enum(['open', 'resolved']),
        evidence_ids: refs,
      }),
    )
    .max(12),
})
export type ConsultationDocument = z.infer<typeof documentSchema>
export const evidenceSchema = z.object({
  id: z.string(),
  tool: z.string(),
  query: z.string(),
  status: z.enum(['success', 'empty', 'error']),
  summary: z.string(),
  source: z.string(),
  turn: z.number(),
})
export type Evidence = z.infer<typeof evidenceSchema>
export const boardSchema = documentSchema.extend({
  student_request: z.string().max(600).optional(),
  intake: intakeSchema.nullable().optional(),
  student_answers: z.array(answerSchema).max(30).optional(),
  evidence: z.array(evidenceSchema).max(560),
  pending: z.record(z.string(), z.object({ name: z.string(), query: z.string() })),
  phase: z.enum([
    'idle',
    'planning',
    'clarifying',
    'researching',
    'synthesizing',
    'complete',
    'attention',
    'paused',
  ]),
  running: z.boolean(),
  revision: z.number(),
  last_seq: z.number(),
  error: z.string(),
  active: z.boolean().default(false),
  evidence_revision: z.number().default(0),
  update_cause: z.enum(['question', 'evidence']).default('question'),
  section_revisions: z
    .object({
      plan: z.number(),
      conclusions: z.number(),
      questions: z.number(),
      uncertainties: z.number(),
    })
    .default({ plan: 0, conclusions: 0, questions: 0, uncertainties: 0 }),
})
export type ConsultationBoard = z.infer<typeof boardSchema>
export function emptyBoard(): ConsultationBoard {
  return {
    goal: '',
    visualizations: {},
    active: false,
    update_cause: 'question',
    evidence_revision: 0,
    section_revisions: { plan: 0, conclusions: 0, questions: 0, uncertainties: 0 },
    plan: [],
    conclusions: [],
    questions: [],
    uncertainties: [],
    evidence: [],
    pending: {},
    phase: 'idle',
    running: false,
    revision: 0,
    last_seq: -1,
    error: '',
  }
}
export function validateDocument(
  value: unknown,
  evidence: readonly Evidence[],
): ConsultationDocument {
  const doc = documentSchema.parse(value)
  if (doc.plan.filter((x) => x.status === 'in_progress').length > 1)
    throw new Error('Only one research step may be in progress')
  for (const group of [doc.plan, doc.conclusions, doc.uncertainties]) {
    const ids = group.map((x) => x.id)
    if (new Set(ids).size !== ids.length)
      throw new Error('Artifact IDs must be unique within each section')
    for (const item of group)
      for (const id of item.evidence_ids) {
        if (!evidence.some((x) => x.id === id && x.status !== 'error'))
          throw new Error(`Unknown or failed evidence reference: ${id}`)
      }
  }
  for (const item of doc.plan)
    if (item.status === 'completed' && !item.evidence_ids.length)
      throw new Error(`Completed step ${item.id} needs successful query evidence`)
  for (const item of doc.conclusions)
    if (
      item.confidence === 'supported' &&
      !item.evidence_ids.some((id) => evidence.some((x) => x.id === id && x.status === 'success'))
    )
      throw new Error(`Supported conclusion ${item.id} needs non-empty evidence`)
  for (const item of doc.uncertainties)
    if (
      item.status === 'resolved' &&
      !item.evidence_ids.some((id) => evidence.some((x) => x.id === id && x.status === 'success'))
    )
      throw new Error(`Resolved uncertainty ${item.id} needs non-empty evidence`)
  for (const spec of Object.values(doc.visualizations)) {
    if (!spec) continue
    validateVisualization(spec)
    for (const ref of spec.evidence_ids)
      if (!evidence.some((x) => x.id === ref && x.status === 'success'))
        throw new Error(`Visualization refers to unavailable evidence: ${ref}`)
  }
  return doc
}
export function staleSections(board: ConsultationBoard): string[] {
  return board.active
    ? SECTIONS.filter((section) => board.section_revisions[section] < board.evidence_revision)
    : []
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function short(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}
export function queryMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const data = record(value.data)
  const remoteSource = record(value.source)
  if (remoteSource?.kind === 'remote_api' && data) {
    const lists = ['items', 'professors', 'courses'].filter((key) => Array.isArray(data[key]))
    const count = lists.length
      ? lists.reduce((n, key) => n + (data[key] as unknown[]).length, 0)
      : Object.keys(data).length
        ? 1
        : 0
    return {
      kind: 'pathfinder.evidence',
      count,
      summary: `CourseScope 返回 ${count} 条记录${data.next_cursor ? '（还有下一页）' : ''}`,
      source: short(remoteSource.api_url, 8000),
      truncated: Boolean(data.next_cursor),
    }
  }
  const rows = Array.isArray(value.rows)
    ? value.rows
    : Array.isArray(value.matches)
      ? value.matches
      : []
  const targets = Array.isArray(value.targets) ? value.targets : []
  const count = targets.length
    ? targets.filter((t) => {
        const r = record(t)
        return record(r?.catalog)?.matched || record(r?.change_major)?.matched
      }).length
    : rows.length
  const source = record(value.source)
  return {
    kind: 'pathfinder.evidence',
    count,
    summary: targets.length
      ? `比较 ${targets.length} 个专业，${count} 个目标有匹配证据`
      : `返回 ${count} 条记录${value.truncated ? '（结果有截断）' : ''}`,
    source: short(source?.database || source?.directory || '本地校园资料'),
    truncated: Boolean(value.truncated),
  }
}
function retainedEvidence(board: ConsultationBoard, added: Evidence): Evidence[] {
  const referenced = new Set<string>()
  for (const group of [board.plan, board.conclusions, board.uncertainties])
    for (const item of group) for (const id of item.evidence_ids) referenced.add(id)
  for (const spec of Object.values(board.visualizations))
    for (const id of spec?.evidence_ids || []) referenced.add(id)
  const all = [...board.evidence, added]
  const recent = new Set(all.slice(-80).map((item) => item.id))
  return all.filter((item) => referenced.has(item.id) || recent.has(item.id))
}
function phase(board: ConsultationBoard): ConsultationBoard['phase'] {
  if (!board.active) return 'idle'
  if (Object.values(board.pending).some((x) => x.name === 'pathfinder_assess_request'))
    return 'clarifying'
  if (Object.keys(board.pending).length) return 'researching'
  if (
    board.error ||
    board.plan.some((x) => x.status === 'blocked') ||
    board.uncertainties.some((x) => x.status === 'open')
  )
    return 'attention'
  if (staleSections(board).length)
    return board.running ? (board.plan.length ? 'synthesizing' : 'planning') : 'attention'
  if (board.plan.length && board.plan.every((x) => x.status === 'completed')) return 'complete'
  return board.running
    ? board.conclusions.length
      ? 'synthesizing'
      : 'planning'
    : board.goal
      ? 'paused'
      : 'idle'
}
/** Pure fold: this is also used for replay, forks and persisted projection caches. */
export function foldBoard(previous: ConsultationBoard, event: SessionEvent): ConsultationBoard {
  let data = event.data as unknown as Record<string, unknown>
  let type: string = event.type
  if (type === 'tool/ptc-dispatch-start') {
    type = 'tool/call'
    data = { ...data, callId: data.subCallId, arguments: JSON.stringify(data.arguments) }
  } else if (type === 'tool/ptc-dispatch') {
    type = 'tool/result'
    let meta: unknown
    for (const block of Array.isArray(data.content) ? data.content : []) {
      const item = record(block)
      if (item?.type !== 'text') continue
      try {
        const parsed = record(JSON.parse(String(item.text)))
        if (parsed?.pathfinderArtifact) {
          meta = parsed.pathfinderArtifact
          break
        }
      } catch {
        /* Ordinary or spilled output is not artifact metadata. */
      }
    }
    data = {
      ...data,
      message: { toolCallId: data.subCallId, isError: data.isError, content: data.content },
      meta,
    }
  }
  let board = previous
  if (type === 'user/message') {
    const source = record(data.source)
    if (source?.kind !== 'user') return previous
    const content = Array.isArray(data.content) ? data.content : []
    const goal = content
      .map((x) => {
        const r = record(x)
        return r?.type === 'text' ? short(r.text, 600) : ''
      })
      .join(' ')
      .trim()
      .slice(0, 600)
    if (!goal) return previous
    board = {
      ...previous,
      goal,
      student_request: goal,
      intake: null,
      active:
        previous.active ||
        /教授|选课|课程|专业|学期|校历|pathfinder|professor|uc davis|ucdavis|major|course|\b(?:ECS|MAT|STA)\s*\d/i.test(
          goal,
        ),
      update_cause: 'question',
      evidence_revision:
        goal === previous.goal ? previous.evidence_revision : previous.evidence_revision + 1,
      plan: goal === previous.goal ? previous.plan : [],
      questions: [],
      visualizations:
        goal === previous.goal
          ? previous.visualizations
          : { ...previous.visualizations, plan: null, questions: null },
      error: '',
    }
  } else if (type === 'turn/start') {
    board = { ...previous, running: true, error: '' }
  } else if (type === 'turn/end') {
    board = { ...previous, running: false, pending: {} }
  } else if (type === 'tool/call') {
    const name = short(data.name)
    if (!name.startsWith('pathfinder_')) return previous
    if (name === 'pathfinder_update_consultation') return previous
    board = {
      ...previous,
      active: true,
      pending: {
        ...previous.pending,
        [String(data.callId)]: { name, query: short(data.arguments) },
      },
    }
  } else if (type === 'tool/result') {
    const message = record(data.message),
      meta = record(data.meta)
    if (message?.isError && previous.pending[String(message.toolCallId)]) {
      const call = previous.pending[String(message.toolCallId)]!
      const pending = { ...previous.pending }
      delete pending[String(message.toolCallId)]
      const feedback = [
        record(data.error)?.message,
        ...(Array.isArray(message.content) ? message.content.map((x) => record(x)?.text) : []),
      ]
        .filter((x) => typeof x === 'string')
        .join(' ')
      const policyFeedback =
        /PATHFINDER_CONTROL|Publish the latest evidence to ALL stale consultation sections|Create a short research plan and publish ALL FOUR|The student answered a clarification\. Reassess|Personalized advice is missing an intake assessment|Wait for the student clarification and reassessment/.test(
          feedback,
        )
      board = policyFeedback
        ? { ...previous, pending }
        : {
            ...previous,
            pending,
            update_cause: 'evidence',
            evidence_revision: previous.evidence_revision + 1,
            error: '查询失败，保留现有证据并等待核实',
            evidence: retainedEvidence(previous, {
              id: String(message.toolCallId),
              tool: call.name,
              query: call.query,
              status: 'error',
              summary: short(record(data.error)?.reason) || '查询失败',
              source: '',
              turn: Number.isFinite(Number(data.turn)) ? Number(data.turn) : 0,
            }),
          }
    } else if (meta?.kind === 'pathfinder.document' && !message?.isError) {
      try {
        const updated = documentSchema.parse(meta.document)
        const sections = Array.isArray(meta.sections)
          ? meta.sections.filter((x): x is string => typeof x === 'string')
          : ['goal', ...SECTIONS, 'visualizations']
        const patch = Object.fromEntries(
          sections
            .filter((x) => ['goal', ...SECTIONS, 'visualizations'].includes(x))
            .map((x) => [x, updated[x as keyof ConsultationDocument]]),
        )
        const doc = validateDocument(
          {
            ...previous,
            ...patch,
            visualizations: {
              ...previous.visualizations,
              ...(patch.visualizations as object | undefined),
            },
          },
          previous.evidence,
        )
        const revisions = { ...previous.section_revisions }
        for (const section of SECTIONS)
          if (sections.includes(section)) revisions[section] = previous.evidence_revision
        board = { ...previous, ...doc, active: true, section_revisions: revisions, error: '' }
      } catch {
        board = { ...previous, error: '咨询产物未通过证据校验，保留此前版本' }
      }
    } else if (meta?.kind === 'pathfinder.intake' && !message?.isError) {
      const intake = intakeSchema.parse(meta.intake)
      const answer = meta.student_answer ? answerSchema.parse(meta.student_answer) : undefined
      const id = String(message?.toolCallId)
      const pending = { ...previous.pending }
      delete pending[id]
      board = {
        ...previous,
        intake,
        pending,
        ...(answer
          ? {
              student_answers: [...(previous.student_answers || []), answer].slice(-30),
              evidence_revision: previous.evidence_revision + 1,
              update_cause: 'evidence' as const,
              evidence: retainedEvidence(previous, {
                id,
                tool: 'pathfinder_assess_request',
                query: answer.question,
                status: 'success',
                summary: `学生自述：${answer.answer}`,
                source: '学生本轮回答（未经官方核验）',
                turn: Number(data.turn) || 0,
              }),
            }
          : {}),
      }
    } else if (meta?.kind === 'pathfinder.evidence' && !message?.isError) {
      const id = String(message?.toolCallId),
        call = previous.pending[id]
      const pending = { ...previous.pending }
      delete pending[id]
      const count = Number(meta.count)
      board = {
        ...previous,
        pending,
        update_cause: 'evidence',
        evidence_revision: previous.evidence_revision + 1,
        evidence: retainedEvidence(previous, {
          id,
          tool: call?.name || 'pathfinder_query',
          query: call?.query || '',
          status: count > 0 ? 'success' : 'empty',
          summary: short(meta.summary),
          source: short(meta.source, 8000),
          turn: Number.isFinite(Number(data.turn)) ? Number(data.turn) : 0,
        }),
      }
    } else return previous
  } else return previous
  const next = {
    ...board,
    phase: phase(board),
    revision: previous.revision + 1,
    last_seq: Number(event.seq),
  }
  return next
}
/** Changed or explicitly reviewed sections; unchanged documents need not be echoed. */
export function updatedSections(args: Record<string, unknown>): string[] {
  const changed = Object.keys(args).filter(
    (key) => key !== 'base_revision' && key !== 'reviewed_sections',
  )
  const reviewed = Array.isArray(args.reviewed_sections)
    ? args.reviewed_sections.filter(
        (key) => typeof key === 'string' && SECTIONS.includes(key as (typeof SECTIONS)[number]),
      )
    : []
  return [...new Set([...changed, ...reviewed])]
}
export function progressContext(board: ConsultationBoard): string {
  const clip = (value: string, length: number) =>
    value.length > length ? value.slice(0, length - 1) + '…' : value
  const compact = {
    goal: clip(board.goal, 320),
    student_request: board.student_request,
    intake: board.intake
      ? {
          ...board.intake,
          known: board.intake.known.map((x) => clip(x, 160)),
          missing: board.intake.missing.map((x) => clip(x, 160)),
        }
      : null,
    student_answers: (board.student_answers || [])
      .slice(-3)
      .map((x) => ({ question: clip(x.question, 160), answer: clip(x.answer, 300) })),
    phase: board.phase,
    revision: board.revision,
    stale_sections: staleSections(board),
    compact_summary: true,
    instruction:
      'Partial section updates preserve full unchanged content; reviewed_sections acknowledges an unchanged section after reviewing new evidence.',
    visualization_forms: Object.fromEntries(
      Object.entries(board.visualizations).map(([key, spec]) => [key, spec?.kind || 'list']),
    ),
    evidence: board.evidence.slice(-8).map((item) => ({
      ...item,
      query: clip(item.query, 100),
      summary: clip(item.summary, 140),
      source: clip(item.source, 80),
    })),
    plan: board.plan.map((item) => ({
      ...item,
      title: clip(item.title, 120),
      note: clip(item.note, 80),
      evidence_ids: item.evidence_ids.slice(0, 2),
    })),
    conclusions: board.conclusions.slice(-6).map((item) => ({
      ...item,
      text: clip(item.text, 220),
      evidence_ids: item.evidence_ids.slice(0, 2),
    })),
    uncertainties: [
      ...board.uncertainties.filter((item) => item.status === 'open'),
      ...board.uncertainties.filter((item) => item.status === 'resolved'),
    ]
      .slice(0, 6)
      .map((item) => ({
        ...item,
        claim: clip(item.claim, 180),
        reason: clip(item.reason, 100),
        next_action: clip(item.next_action, 140),
        evidence_ids: item.evidence_ids.slice(0, 2),
      })),
    questions: board.questions
      .slice(0, 4)
      .map((item) => ({ question: clip(item.question, 220), reason: clip(item.reason, 100) })),
  }
  // Reduce optional context, never cut a JSON payload in the middle of a value.
  while (JSON.stringify(compact).length > 14000) {
    if (compact.uncertainties.length > 2) compact.uncertainties.pop()
    else if (compact.conclusions.length > 2) compact.conclusions.shift()
    else if (compact.questions.length > 1) compact.questions.pop()
    else if (compact.evidence.length > 3) compact.evidence.shift()
    else {
      compact.plan = compact.plan.map((item) => ({
        ...item,
        title: clip(item.title, 60),
        note: '',
        evidence_ids: item.evidence_ids.slice(0, 1),
      }))
      break
    }
  }
  return (
    'Pathfinder consultation progress (session-local, durable evidence; predictions are not facts):\n' +
    JSON.stringify(compact)
  )
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'pathfinder.consultation': ConsultationBoard
  }
  interface SessionProjectionStateMap {
    'pathfinder.consultation': ConsultationBoard
  }
}
