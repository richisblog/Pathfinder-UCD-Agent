import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-questions'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { PROJECTION, emptyBoard } from './consultation.js'
import { isPersonalAdvice, isBroadPersonalAdvice } from './intake-state.js'
import type { Result } from './types.js'
export function installIntake(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'pathfinder_assess_request',
      description:
        'Before personalized recommendations, assess known student facts and missing decision conditions. status needs_input opens ONE native Harness question and WAITS for the student; status ready records a sufficiently scoped next step. Unknown answers remain unknown. This is clarification, not end-of-answer suggested follow-ups. Reassess after each answer; do not require a complete profile or ask everything at once.',
      parameters: {
        status: { type: 'string', enum: ['ready', 'needs_input'], required: true },
        known: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            'Only facts explicitly stated by the student, with qualifications. No inferred major, goals or grades.',
        },
        missing: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            'Decision-critical missing information. Empty when the scoped next step can proceed safely; defer unrelated gaps.',
        },
        question: {
          type: 'string',
          description:
            'One concise question about the highest-impact missing condition; required for needs_input.',
        },
        reason: {
          type: 'string',
          description: 'Why this answer changes the next step; required for needs_input.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional 2–5 neutral choices, including unsure when useful. UI also allows free text.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        presentationMeta: (_args, value) => ({ kind: 'pathfinder.intake', ...value }),
      },
      async execute(args, exec): Promise<Result> {
        if (!exec.agent) throw new Error('Student clarification requires an active Harness session')
        exec.signal.throwIfAborted()
        const board = ctx.sessionProjections.stateOf(exec.agent.session, PROJECTION) ?? emptyBoard()
        const request = board.student_request || board.goal
        const known = z.array(z.string().min(1).max(500)).max(12).parse(args.known)
        const missing = z.array(z.string().min(1).max(500)).max(8).parse(args.missing)
        if (args.status === 'ready') {
          if (missing.length)
            throw new Error(
              'Critical missing conditions require needs_input; narrow the next step rather than invent facts',
            )
          if (
            isPersonalAdvice(request) &&
            (!known.length || isBroadPersonalAdvice(request)) &&
            !board.student_answers?.length
          )
            throw new Error(
              'A vague personal recommendation needs a student answer first; ask about their goal instead of assuming a generic undergraduate profile',
            )
          return { intake: { request, status: 'ready', known, missing } }
        }
        const question = z.string().min(1).max(600).parse(args.question)
        const reason = z.string().min(1).max(600).parse(args.reason)
        if (!missing.length) throw new Error('Name the missing decision condition before asking')
        const options =
          args.options === undefined
            ? undefined
            : z.array(z.string().min(1).max(100)).min(2).max(5).parse(args.options)
        const answer = await ctx.userQuestions.ask({
          agent: exec.agent,
          signal: exec.signal,
          wait: { callId: exec.callId },
          questions: [
            {
              id: 'student-context',
              header: /[\u4e00-\u9fff]/.test(question)
                ? '补充一条关键信息'
                : 'One detail before we continue',
              question,
              detail: reason,
              ...(options ? { options: options.map((label) => ({ label })) } : {}),
            },
          ],
        })
        const item = answer.answers.find((x) => x.id === 'student-context')
        if (!item || (!item.selected.length && !item.custom?.trim()))
          throw new Error('No student answer received; do not continue with assumed facts')
        return {
          intake: { request, status: 'needs_reassessment', known, missing },
          student_answer: {
            question,
            answer: [...item.selected, item.custom || ''].filter(Boolean).join('；').slice(0, 1800),
          },
          evidence_id: exec.callId,
        }
      },
    }),
  )
}
