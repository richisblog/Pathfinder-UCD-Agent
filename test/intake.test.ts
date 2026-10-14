import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import ProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionRequest,
  UserQuestionService,
} from '@deepseek-ai/dsh-user-questions'
import { installIntake } from '../dist/intake.js'
import { intakeBlock, isBroadPersonalAdvice } from '../dist/intake-state.js'
import { installProgress } from '../dist/progress.js'
import { emptyBoard, PROJECTION } from '../dist/consultation.js'

test('vague personal advice needs intake but direct factual lookup does not need a student profile', () => {
  assert.ok(intakeBlock({ ...emptyBoard(), goal: '下学期我该选什么课？想选点有用的，别太难。' }))
  assert.equal(intakeBlock({ ...emptyBoard(), goal: '查询MAT21C的学分和先修' }), undefined)
  assert.equal(isBroadPersonalAdvice('下学期我该选什么课？想选点有用的，别太难。'), true)
})
test('native student question waits, records a student answer separately, requires reassessment and preserves session isolation', async () => {
  const ctx = new Context()
  let request: AskUserQuestionRequest | undefined
  let resolveAnswer!: (answer: AskUserQuestionAnswer) => void
  try {
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(ProjectionRegistry).await()
    await ctx.plugin(SystemPrompt, {}).await()
    await ctx.plugin(ToolRuntime).await()
    await ctx
      .plugin({ inject: ['tools', 'sessionProjections', 'systemPrompt'], apply: installProgress })
      .await()
    ctx.provide('userQuestions', {
      ask: async (req: AskUserQuestionRequest) => {
        request = req
        return new Promise((resolve) => {
          resolveAnswer = resolve
        })
      },
    } as UserQuestionService)
    await ctx
      .plugin({ inject: ['tools', 'sessionProjections', 'userQuestions'], apply: installIntake })
      .await()
    const session = ctx.sessions.create('intake-one' as SessionId),
      other = ctx.sessions.create('intake-two' as SessionId)
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '下学期我该选什么课？想选点有用的，别太难。' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    let index = 0
    async function invoke(args: unknown) {
      const callId = `intake-${++index}` as ToolExecutionInput['callId']
      session.append('tool/call', {
        callId,
        name: 'pathfinder_assess_request',
        arguments: JSON.stringify(args),
        turn: 1,
        step: index,
      })
      const result = await ctx.tools.execute({
        callId,
        name: 'pathfinder_assess_request',
        arguments: args,
        agent: { session } as ToolExecutionInput['agent'],
        signal: new AbortController().signal,
      })
      session.append(
        'tool/result',
        {
          turn: 1,
          step: index,
          message: createToolResultMessage({
            callId,
            content: result.content,
            isError: result.isError,
          }),
          ...(result.meta === undefined ? {} : { meta: result.meta }),
        },
        { surfaceOp: 'append' },
      )
      return result
    }
    assert.equal(
      (await invoke({ status: 'ready', known: ['用户想选实用不太难的课'], missing: [] })).isError,
      true,
    )
    let settled = false
    let outcome: unknown
    const pending = invoke({
      status: 'needs_input',
      known: [],
      missing: ['课程用途'],
      question: '你更想推进毕业、探索专业，还是准备实习？',
      reason: '目的不同，候选课程会不同。',
      options: ['推进毕业', '探索专业', '准备实习', '还没想清楚'],
    }).then((x) => {
      outcome = x
      settled = true
      return x
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settled, false, JSON.stringify(outcome))
    assert.equal(request?.questions.length, 1)
    assert.equal(ctx.sessionProjections.stateOf(session, PROJECTION)?.phase, 'clarifying')
    resolveAnswer({
      answers: [{ id: 'student-context', selected: ['探索专业'], custom: '我还没有确定专业' }],
    })
    assert.equal((await pending).isError, false)
    const board = ctx.sessionProjections.stateOf(session, PROJECTION)!
    assert.equal(board.student_answers?.length, 1)
    assert.match(board.student_answers![0]!.answer, /探索专业/)
    assert.match(board.evidence.find((x) => x.status === 'success')!.source, /学生/)
    assert.match(intakeBlock(board)!, /Reassess/)
    assert.equal(ctx.sessionProjections.stateOf(other, PROJECTION)?.student_answers, undefined)
    assert.equal(
      (await invoke({ status: 'ready', known: ['希望探索专业，尚未定专业'], missing: [] })).isError,
      false,
    )
    assert.equal(intakeBlock(ctx.sessionProjections.stateOf(session, PROJECTION)!), undefined)
  } finally {
    await ctx.fiber.dispose()
  }
})
