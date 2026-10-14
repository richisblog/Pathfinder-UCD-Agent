import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  Session,
  type SessionEvent,
  type SessionEventType,
  type SessionEventMap,
  type SessionId,
} from '@deepseek-ai/dsh-session'
import ProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  emptyBoard,
  foldBoard,
  validateDocument,
  progressContext,
  PROJECTION,
  type ConsultationDocument,
  type Evidence,
} from '../dist/consultation.js'
import { installProgress } from '../dist/progress.js'

function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, data, seq, time: new Date().toISOString() } as unknown as SessionEvent
}
const evidence: Evidence = {
  id: 'lookup-1',
  tool: 'pathfinder_query_course_db',
  query: 'MAT 21C',
  status: 'success',
  summary: '返回 1 条记录',
  source: 'courses.db',
  turn: 1,
}
const document: ConsultationDocument = {
  visualizations: {},
  goal: '比较 MAT 21C 教授',
  plan: [
    {
      id: 'plan1',
      title: '查询课程要求',
      status: 'completed',
      evidence_ids: ['lookup-1'],
      note: '已取得课程目录证据',
    },
    {
      id: 'plan2',
      title: '比较教授评价',
      status: 'in_progress',
      evidence_ids: [],
      note: '等待教授查询',
    },
  ],
  conclusions: [
    {
      id: 'c1',
      text: '此课程先修要求为 MAT 021B。',
      confidence: 'supported',
      evidence_ids: ['lookup-1'],
    },
  ],
  questions: [
    {
      question: '哪些教授更适合我的学习方式？',
      reason: '课程条件已确定，下一步可以比较教学风格。',
    },
  ],
  uncertainties: [
    {
      id: 'u1',
      claim: '本学期具体教授名单尚待确认。',
      reason: '课程关联记录不等于当期实际开课名单。',
      next_action: '核对当期官方课程安排。',
      status: 'open',
      evidence_ids: [],
    },
  ],
}

test('completed steps, supported conclusions and resolved uncertainties need real evidence', () => {
  assert.deepEqual(validateDocument(document, [evidence]), document)
  assert.throws(() => validateDocument(document, []), /Unknown/)
  assert.throws(
    () =>
      validateDocument({ ...document, plan: [{ ...document.plan[0], evidence_ids: [] }] }, [
        evidence,
      ]),
    /needs successful/,
  )
  assert.throws(
    () => validateDocument(document, [{ ...evidence, status: 'error' }]),
    /failed evidence/,
  )
  assert.throws(
    () => validateDocument(document, [{ ...evidence, status: 'empty' }]),
    /non-empty evidence/,
  )
  assert.throws(
    () =>
      validateDocument(
        { ...document, uncertainties: [{ ...document.uncertainties[0], status: 'resolved' }] },
        [evidence],
      ),
    /non-empty evidence/,
  )
  assert.throws(
    () =>
      validateDocument(
        { ...document, plan: [{ ...document.plan[1] }, { ...document.plan[1], id: 'plan3' }] },
        [evidence],
      ),
    /one research step/,
  )
})

test('native tool events update pending activity and replay all four artifact sections', () => {
  const events = [
    event('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: '比较 MAT 21C 教授' }],
    }),
    event('turn/start', {}, 1),
    event(
      'tool/call',
      { name: 'pathfinder_query_course_db', arguments: '{"course":"MAT21C"}', callId: 'lookup-1' },
      2,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        message: { toolCallId: 'lookup-1', isError: false },
        meta: {
          kind: 'pathfinder.evidence',
          count: 1,
          summary: '返回 1 条记录',
          source: 'courses.db',
        },
      },
      3,
    ),
    event(
      'tool/result',
      {
        message: { toolCallId: 'update-1', isError: false },
        meta: { kind: 'pathfinder.document', document },
      },
      4,
    ),
  ]
  const pending = events.slice(0, 3).reduce(foldBoard, emptyBoard())
  assert.equal(pending.phase, 'researching')
  const replay = events.reduce(foldBoard, emptyBoard())
  assert.equal(replay.evidence[0]!.id, 'lookup-1')
  assert.deepEqual(replay.plan, document.plan)
  assert.deepEqual(replay.conclusions, document.conclusions)
  assert.deepEqual(replay.questions, document.questions)
  assert.deepEqual(replay.uncertainties, document.uncertainties)
  assert.equal(replay.phase, 'attention')
  assert.match(progressContext(replay), /lookup-1/)
  assert.deepEqual(events.reduce(foldBoard, emptyBoard()), replay)
  assert.equal(emptyBoard().evidence.length, 0)
})

test('PTC nested calls preserve bounded evidence and artifacts through durable envelopes', () => {
  const events = [
    event('tool/ptc-dispatch-start', {
      name: 'pathfinder_query_course_db',
      arguments: { course: 'MAT21C' },
      subCallId: 'lookup-1',
    }),
    event(
      'tool/ptc-dispatch',
      {
        turn: 1,
        name: 'pathfinder_query_course_db',
        subCallId: 'lookup-1',
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              pathfinderArtifact: {
                kind: 'pathfinder.evidence',
                count: 1,
                summary: '返回 1 条记录',
                source: 'courses.db',
              },
            }),
          },
          { type: 'text', text: 'spilled body: see output file' },
        ],
      },
      1,
    ),
    event(
      'tool/ptc-dispatch',
      {
        name: 'pathfinder_update_consultation',
        subCallId: 'update',
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ pathfinderArtifact: { kind: 'pathfinder.document', document } }),
          },
        ],
      },
      2,
    ),
  ]
  const board = events.reduce(foldBoard, emptyBoard())
  assert.equal(board.evidence[0]!.id, 'lookup-1')
  assert.equal(board.conclusions[0]!.confidence, 'supported')
  assert.equal(Object.keys(board.pending).length, 0)
})

test('errors and malformed updates preserve valid conclusions; injected context cannot become the goal', () => {
  const board = { ...emptyBoard(), ...document, evidence: [evidence] }
  const bad = foldBoard(
    board,
    event('tool/result', {
      message: { isError: false },
      meta: {
        kind: 'pathfinder.document',
        document: {
          ...document,
          conclusions: [{ ...document.conclusions[0], evidence_ids: ['fabricated'] }],
        },
      },
    }),
  )
  assert.deepEqual(bad.conclusions, document.conclusions)
  assert.match(bad.error, /证据校验/)
  assert.equal(
    foldBoard(
      board,
      event('user/message', {
        source: { kind: 'system-prompt' },
        content: [{ type: 'text', text: 'Internal injected context' }],
      }),
    ),
    board,
  )
  const pending = foldBoard(
    board,
    event('tool/call', { name: 'pathfinder_professor_reviews', callId: 'failed', arguments: '{}' }),
  )
  const failed = foldBoard(
    pending,
    event('tool/result', {
      turn: 2,
      message: { toolCallId: 'failed', isError: true },
      error: { reason: 'Missing rmp.db' },
    }),
  )
  assert.equal(failed.evidence.at(-1)!.status, 'error')
  assert.deepEqual(failed.conclusions, document.conclusions)
})

test('real Host projection, session isolation, artifact tool and prompt snapshot', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(ProjectionRegistry).await()
  await ctx.plugin(SystemPrompt, {}).await()
  await ctx.plugin(ToolRuntime).await()
  const fiber = ctx.plugin({
    inject: ['tools', 'sessionProjections', 'systemPrompt'],
    apply: installProgress,
  })
  await fiber.await()
  try {
    const first = ctx.sessions.create('pf-first' as SessionId)
    const second = ctx.sessions.create('pf-second' as SessionId)
    const callId = 'lookup-1' as ToolCallId
    first.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'pathfinder_query_course_db',
      arguments: '{"course":"MAT21C"}',
    })
    first.append(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: 'text', text: '{"rows":[{"title":"Calculus"}]}' }],
          isError: false,
        }),
        meta: {
          kind: 'pathfinder.evidence',
          count: 1,
          summary: '返回 1 条记录',
          source: 'courses.db',
        },
      },
      { surfaceOp: 'append' },
    )
    assert.equal(ctx.sessionProjections.stateOf(first, PROJECTION)!.evidence.length, 1)
    assert.equal(ctx.sessionProjections.stateOf(second, PROJECTION)!.evidence.length, 0)
    const result = await ctx.tools.execute({
      callId: 'update' as ToolCallId,
      name: 'pathfinder_update_consultation',
      arguments: document,
      agent: { session: first } as ToolExecutionInput['agent'],
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    first.append(
      'tool/result',
      {
        turn: 1,
        step: 2,
        message: createToolResultMessage({
          callId: 'update' as ToolCallId,
          content: result.content,
          isError: false,
        }),
        meta: result.meta,
      },
      { surfaceOp: 'append' },
    )
    assert.equal(ctx.sessionProjections.snapshot(first).values[PROJECTION]!.plan.length, 2)
    const prompt = await ctx.systemPrompt.assemble({ scope: { session: first } })
    assert.match(JSON.stringify(prompt), /lookup-1/)
    const invalid = await ctx.tools.execute({
      callId: 'invalid' as ToolCallId,
      name: 'pathfinder_update_consultation',
      arguments: {
        ...document,
        conclusions: [{ ...document.conclusions[0], evidence_ids: ['fake'] }],
      },
      agent: { session: first } as ToolExecutionInput['agent'],
      signal: new AbortController().signal,
    })
    assert.equal(invalid.isError, true)
    assert.equal(
      ctx.sessionProjections.snapshot(first).values[PROJECTION]!.conclusions[0]!.text,
      document.conclusions[0]!.text,
    )
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
})

test('execution guards require a published plan and all four sections to be synchronized', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(ProjectionRegistry).await()
  await ctx.plugin(SystemPrompt, {}).await()
  await ctx.plugin(ToolRuntime).await()
  const fiber = ctx.plugin({
    inject: ['tools', 'sessionProjections', 'systemPrompt'],
    apply: installProgress,
  })
  await fiber.await()
  let calls = 0
  const queryPlugin = ctx.plugin({
    inject: ['tools'],
    apply(ctx: Context) {
      ctx.tools.register({
        name: 'pathfinder_guard_test',
        description: 'Read-only guard fixture',
        parameters: { type: 'object', properties: {} },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: () => [{ type: 'text', text: '{}' }],
        },
        async execute() {
          calls++
          return { rows: [{ id: 1 }] }
        },
      })
    },
  })
  await queryPlugin.await()
  try {
    const session = ctx.sessions.create('pf-guard' as SessionId)
    const agent = { session, steer: () => {} } as unknown as ToolExecutionInput['agent']
    // A real user event establishes a new consultation epoch.
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    session.append(
      'user/message',
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '查课程' }] }),
      { surfaceOp: 'append' },
    )
    const invoke = (name: string, args: unknown) =>
      ctx.tools.execute({
        callId: 'guard-call' as ToolCallId,
        name,
        arguments: args,
        agent,
        signal: new AbortController().signal,
      })
    assert.equal((await invoke('pathfinder_guard_test', {})).isError, true)
    assert.equal(calls, 0)
    const publish = async (args: unknown) => {
      const result = await invoke('pathfinder_update_consultation', args)
      assert.equal(result.isError, false, JSON.stringify(result))
      session.append(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: createToolResultMessage({
            callId: 'guard-call' as ToolCallId,
            content: result.content,
            isError: false,
          }),
          meta: result.meta,
        },
        { surfaceOp: 'append' },
      )
    }
    await publish({
      plan: [{ id: 'p1', title: '查询课程', status: 'in_progress', evidence_ids: [], note: '' }],
      conclusions: [],
      questions: [],
      uncertainties: [],
    })
    assert.equal((await invoke('pathfinder_guard_test', {})).isError, false)
    assert.equal(calls, 1)
    session.append('tool/call', {
      turn: 1,
      step: 2,
      callId: 'guard-evidence' as ToolCallId,
      name: 'pathfinder_guard_test',
      arguments: '{}',
    })
    session.append(
      'tool/result',
      {
        turn: 1,
        step: 2,
        message: createToolResultMessage({
          callId: 'guard-evidence' as ToolCallId,
          content: [{ type: 'text', text: '{}' }],
          isError: false,
        }),
        meta: { kind: 'pathfinder.evidence', count: 1, summary: 'fixture', source: 'fixture.db' },
      },
      { surfaceOp: 'append' },
    )
    await publish({
      conclusions: [
        {
          id: 'c1',
          text: '取得课程记录',
          confidence: 'supported',
          evidence_ids: ['guard-evidence'],
        },
      ],
    })
    assert.equal((await invoke('pathfinder_guard_test', {})).isError, true)
    await publish({
      plan: [
        {
          id: 'p1',
          title: '查询课程',
          status: 'completed',
          evidence_ids: ['guard-evidence'],
          note: '',
        },
      ],
      questions: [],
      uncertainties: [],
    })
    assert.equal((await invoke('pathfinder_guard_test', {})).isError, false)
    const revision = ctx.sessionProjections.stateOf(session, PROJECTION)!.revision
    assert.equal(
      (
        await invoke('pathfinder_update_consultation', {
          base_revision: revision - 1,
          questions: [],
        })
      ).isError,
      true,
    )
    // An unfinished publication cannot silently finalize; repairs are bounded.
    session.append(
      'user/message',
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: '换一个研究问题' }],
      }),
      { surfaceOp: 'append' },
    )
    let repairs = 0
    const repairAgent = {
      session,
      steer: () => {
        repairs++
      },
    } as unknown as NonNullable<ToolExecutionInput['agent']>
    for (let i = 0; i < 3; i++)
      await ctx.parallel('agent/turn-stopping', {
        agent: repairAgent,
        turn: 2,
        signal: new AbortController().signal,
      })
    assert.equal(repairs, 2)
  } finally {
    await queryPlugin.dispose()
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
})

test('repeated synchronization denials add no evidence or new stale epochs in native and PTC logs', () => {
  let board = { ...emptyBoard(), goal: '读取专业要求', active: true, evidence_revision: 7 }
  const epoch = board.evidence_revision
  const messages = [
    'PATHFINDER_CONTROL: This query has NOT run. Next call pathfinder_update_consultation.',
    'Publish the latest evidence to ALL stale consultation sections (plan, conclusions, questions, uncertainties) with pathfinder_update_consultation before another campus query.',
  ]
  for (let i = 0; i < 8; i++) {
    const id = `denied-${i}`,
      text = `Error: ${messages[i % 2]}`
    board = foldBoard(
      board,
      event(
        'tool/call',
        {
          callId: id,
          name: 'pathfinder_get_major_requirements',
          arguments: '{"major_code":"ECSI","degree":"BS"}',
        },
        i * 2,
      ),
    )
    board = foldBoard(
      board,
      event(
        'tool/result',
        { message: { toolCallId: id, isError: true, content: [{ type: 'text', text }] } },
        i * 2 + 1,
      ),
    )
    assert.equal(board.evidence_revision, epoch)
    assert.equal(board.evidence.length, 0)
    assert.equal(board.error, '')
    assert.deepEqual(board.pending, {})
  }
  board = foldBoard(
    board,
    event(
      'tool/ptc-dispatch-start',
      {
        subCallId: 'ptc-denied',
        name: 'pathfinder_get_major_requirements',
        arguments: { major_code: 'ECSI', degree: 'BS' },
      },
      20,
    ),
  )
  board = foldBoard(
    board,
    event(
      'tool/ptc-dispatch',
      {
        subCallId: 'ptc-denied',
        name: 'pathfinder_get_major_requirements',
        isError: true,
        content: [{ type: 'text', text: 'Error: PATHFINDER_CONTROL: update artifacts' }],
      },
      21,
    ),
  )
  assert.equal(board.evidence_revision, epoch)
  assert.equal(board.evidence.length, 0)
  // Genuine API errors still change the evidence state and remain visible.
  board = foldBoard(
    board,
    event(
      'tool/call',
      { callId: 'api-error', name: 'pathfinder_get_major_requirements', arguments: '{}' },
      22,
    ),
  )
  board = foldBoard(
    board,
    event(
      'tool/result',
      {
        message: {
          toolCallId: 'api-error',
          isError: true,
          content: [{ type: 'text', text: 'CourseScope API HTTP 503: snapshot unavailable' }],
        },
      },
      23,
    ),
  )
  assert.equal(board.evidence_revision, epoch + 1)
  assert.equal(board.evidence.length, 1)
  assert.equal(board.evidence[0]!.status, 'error')
})
