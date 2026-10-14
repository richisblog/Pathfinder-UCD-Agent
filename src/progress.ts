import { intakeBlock } from './intake-state.js'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import {
  boardSchema,
  PROJECTION,
  emptyBoard,
  foldBoard,
  progressContext,
  validateDocument,
  queryMetadata,
  staleSections,
  updatedSections,
} from './consultation.js'

const refs = { type: 'array', items: { type: 'string' }, required: true } as const
const id = { type: 'string', required: true } as const
const note = { type: 'string', required: true } as const
export function installProgress(ctx: Context): void {
  ctx.effect(() =>
    ctx.sessionProjections.register({
      key: PROJECTION,
      stateVersion: 5,
      stateSchema: boardSchema,
      init: emptyBoard,
      apply: foldBoard,
      wire: { viewSchema: boardSchema, view: (state) => state },
    }),
  )
  // PTC dispatches skip presentationMeta. Preserve a small, policy-approved
  // artifact envelope on their durable log copy through the official hook.
  const ptcArtifacts = new Map<string, unknown>()
  const dispatchKey = (sessionId: string | undefined, callId: string) =>
    `${sessionId ?? ''}:${callId}`
  ctx.effect(() => () => ptcArtifacts.clear())
  ctx.on('tools/result', (exec, result) => {
    if (
      !exec.parent ||
      !exec.name.startsWith('pathfinder_') ||
      result.isError ||
      !result.value ||
      typeof result.value !== 'object'
    )
      return undefined
    const metadata =
      exec.name === 'pathfinder_update_consultation'
        ? {
            kind: 'pathfinder.document',
            document: result.value,
            sections: updatedSections(exec.arguments as Record<string, unknown>),
          }
        : exec.name === 'pathfinder_assess_request'
          ? { kind: 'pathfinder.intake', ...(result.value as object) }
          : queryMetadata(result.value as Record<string, unknown>)
    ptcArtifacts.set(dispatchKey(exec.agent?.session.id, exec.callId), metadata)
    return undefined
  })
  ctx.on('tools/ptc-dispatch-log', async (dispatch, next) => {
    const content = await next()
    const key = dispatchKey(dispatch.agent?.session.id, dispatch.subCallId)
    const artifact = ptcArtifacts.get(key)
    ptcArtifacts.delete(key)
    if (!artifact || dispatch.isError) return content
    return [{ type: 'text', text: JSON.stringify({ pathfinderArtifact: artifact }) }, ...content]
  })
  // Progress publication is an execution invariant, not just a prompt request.
  ctx.tools.guard((exec) => {
    if (
      !exec.agent ||
      !exec.name.startsWith('pathfinder_') ||
      exec.name === 'pathfinder_update_consultation' ||
      exec.name === 'pathfinder_assess_request'
    )
      return
    const board = ctx.sessionProjections.stateOf(exec.agent.session, PROJECTION)
    if (!board) return
    if (Object.values(board.pending).some((x) => x.name === 'pathfinder_assess_request'))
      return 'PATHFINDER_CONTROL: Wait for the student clarification and reassessment before making campus queries.'
    const blocker = intakeBlock(board)
    if (blocker) return `PATHFINDER_CONTROL: ${blocker}`
    if (board.goal && !board.plan.length)
      return 'PATHFINDER_CONTROL: Create a short research plan and publish ALL FOUR initial artifact sections with pathfinder_update_consultation before the first campus query. Conclusions/questions/uncertainties may be empty until facts arrive. Keep steps pending or in_progress until evidence arrives.'
    const stale = staleSections(board)
    if (stale.length)
      return `PATHFINDER_CONTROL: This query has NOT run. Do not retry it yet. Next call pathfinder_update_consultation: update changed content in ${stale.join(', ')}, and include reviewed_sections for any unchanged sections after reviewing the latest evidence. You do not need to copy the whole document. If a conclusion needs the requested lookup, keep it tentative and keep that plan step pending; synchronize the current observation now, then resume this query. Example for an unchanged section: {"reviewed_sections":["questions"]}. This control notice adds no evidence; the latest progress snapshot has the actual evidence IDs.`
  })
  ctx.systemPrompt.section({
    name: 'pathfinder:consultation-workflow',
    order: 2950,
    text: `When answering campus consultation questions with Pathfinder, maintain the right-sidebar consultation artifacts using pathfinder_update_consultation. When planning, distinguish missing student decision conditions from missing API evidence. For vague personal course/major advice, FIRST use pathfinder_assess_request with status needs_input to ask ONE highest-impact question and wait for the student; do not invent a generic profile or choose candidate courses before their answer. Reassess known and missing conditions after every reply, retaining unknowns. status ready allows only the scoped next step with no decision-critical gaps. General fact lookups do not require student profile questions. Suggested questions in the sidebar are optional next research topics, NOT a substitute for a blocking clarification. Plans awaiting a student answer are blocked, not in_progress research. For complex comparisons, create a short research plan before queries. On each step, read the progress snapshot, choose the next unresolved condition, query only missing evidence, then update conclusions and uncertainties. Read source.api_url and source timestamps. requested_at is request time; fetched_at/as_of describe the server snapshot, not policy effective time. Do not repeat a successful identical query unless the user asks to refresh it. The evidence IDs in the snapshot are actual tool call IDs. Completed research steps need successful query evidence; supported conclusions and resolved uncertainties need non-empty evidence. Keep unsupported interpretations tentative, expose ambiguous matches and stale data, and give a concrete verification action. Publish 2–4 useful predicted follow-up questions with a reason; predictions are suggestions, not user intentions. Update ALL FOUR sections immediately after each new query observation, not just at the end. Partial updates are allowed and must preserve unchanged artifacts; explicitly mark reviewed_sections when new evidence does not change a section, avoiding unnecessary full document repetition; use base_revision from the snapshot to reject stale updates. Each section may choose its own visualization in visualizations: ECharts option JSON for numeric charts (bar, line, pie, sankey, graph, radar, map, etc.); HTML/SVG markup for custom structures; Canvas script for interactive demonstrations. You choose the form that best fits the actual information; do not force a chart on text. Explain the choice in rationale, classify origin as evidence/artifacts/scenario, and cite evidence IDs or state scenario assumptions. All numeric values, axes, labels and positions must be deterministic and inspectable; no random drawing. Graphs use explicit coordinates or circular layout. Scripts run in an isolated local frame and may read PATHFINDER_DATA and PATHFINDER_THEME. Never wait for the final answer to publish changed plans, conclusions, predictions or uncertainties. Update artifacts before the final answer. Do not mark a plan complete when blocking conditions remain. A direct simple lookup may have a one-step plan. Never add account, forum, or schedule-import actions.`,
  })
  ctx.systemPrompt.context({
    name: 'pathfinder:progress',
    order: 130,
    text: ({ scope }) => {
      const agent = scope as Agent | undefined
      if (!agent?.session) return ''
      const board = ctx.sessionProjections.stateOf(agent.session, PROJECTION)
      return board?.active ? progressContext(board) : ''
    },
  })
  const repairs = new WeakMap<Agent, { turn: number; attempts: number }>()
  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    if (signal.aborted) return
    const board = ctx.sessionProjections.stateOf(agent.session, PROJECTION)
    if (!board || !board.active || !staleSections(board).length) return
    const entry = repairs.get(agent)
    const attempts = entry?.turn === turn ? entry.attempts : 0
    if (attempts >= 2) return
    repairs.set(agent, { turn, attempts: attempts + 1 })
    agent.steer(
      createUserMessage({
        source: { kind: 'pathfinder-progress' },
        content: [
          {
            type: 'text',
            text: `New consultation evidence is not yet reflected in: ${staleSections(board).join(', ')}. Update these artifact sections now with pathfinder_update_consultation, including next questions and uncertainties. Preserve evidence references and actual facts. Then finish the answer.`,
          },
        ],
      }),
    )
  })
  ctx.tools.register(
    defineTool({
      name: 'pathfinder_update_consultation',
      description:
        'Update the session-local research plan, conclusions, predicted follow-up questions and uncertainties shown in the Pathfinder right sidebar. Supply changed sections only, or the whole document; updates are merged into the current session atomically. Each section independently chooses an ECharts/HTML/SVG/Canvas visualization. Reference actual evidence IDs from the progress snapshot. This only writes consultation artifacts, never campus databases.',
      parameters: {
        goal: { type: 'string' },
        reviewed_sections: {
          type: 'array',
          items: { type: 'string', enum: ['plan', 'conclusions', 'questions', 'uncertainties'] },
          description:
            'Sections explicitly reviewed against new evidence and retained unchanged. Avoid rewriting unchanged artifacts.',
        },
        base_revision: {
          type: 'integer',
          description: 'Current board revision from the snapshot; stale writes are rejected.',
        },
        visualizations: {
          type: 'json',
          description:
            'Optional per-section map keyed by plan/conclusions/questions/uncertainties. Each value: {kind:echarts|html|svg|canvas,title,rationale,origin:evidence|artifacts|scenario,evidence_ids,option?,renderer?:svg|canvas,markup?,script?,data?,height?:120-700,assumptions?,maps?:[{name,geo_json}]}. null removes a visualization. option is standard deterministic ECharts JSON; no callbacks. HTML/SVG/Canvas scripts can read PATHFINDER_DATA and PATHFINDER_THEME.',
        },
        plan: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id,
              title: note,
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'blocked'],
                required: true,
              },
              evidence_ids: refs,
              note,
            },
          },
        },
        conclusions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id,
              text: note,
              confidence: { type: 'string', enum: ['supported', 'tentative'], required: true },
              evidence_ids: refs,
            },
          },
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { question: note, reason: note },
          },
        },
        uncertainties: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id,
              claim: note,
              reason: note,
              next_action: note,
              status: { type: 'string', enum: ['open', 'resolved'], required: true },
              evidence_ids: refs,
            },
          },
        },
      },
      output: {
        schema: { type: 'json' },
        render: (args, _value) => [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'published',
              updated_sections: updatedSections(args),
              note: 'Full artifacts are durable in the session projection; the next progress snapshot has the updated state.',
            }),
          },
        ],
        presentationMeta: (args, value) => ({
          kind: 'pathfinder.document',
          document: value,
          sections: updatedSections(args),
        }),
      },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('Consultation updates require an active Harness session')
        exec.signal.throwIfAborted()
        const board = ctx.sessionProjections.stateOf(exec.agent.session, PROJECTION) ?? emptyBoard()
        if (args.base_revision !== undefined && args.base_revision !== board.revision)
          throw new Error('Stale consultation revision; read the new progress snapshot and retry')
        if (
          Object.keys(args).some(
            (key) =>
              ![
                'goal',
                'base_revision',
                'reviewed_sections',
                'visualizations',
                'plan',
                'conclusions',
                'questions',
                'uncertainties',
              ].includes(key),
          )
        )
          throw new Error('Unknown consultation update field')
        if (!updatedSections(args).length)
          throw new Error('Supply at least one changed artifact section')
        return validateDocument(
          {
            ...board,
            ...args,
            visualizations: {
              ...board.visualizations,
              ...(args.visualizations as object | undefined),
            },
          },
          board.evidence,
        )
      },
    }),
  )
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'pathfinder-progress': { kind: 'pathfinder-progress' }
  }
}
