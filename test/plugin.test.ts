import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as plugin from '../dist/index.js'
import { endpoints } from '../dist/api-contract.js'
import { executeQuery, requestUrl } from '../dist/runtime.js'
import { queryMetadata } from '../dist/consultation.js'
const lookup = (name: string) => endpoints.find((x) => x.name === name)!
const argsFor = (name: string) =>
  Object.fromEntries(
    lookup(name)
      .parameters.filter((p) => p.required)
      .map((p) => [
        p.name,
        p.name === 'professor_id'
          ? 2933917
          : p.name === 'term'
            ? ['slides', 'chalkboard']
            : p.name === 'major_code'
              ? 'LMAT'
              : p.name === 'q'
                ? 'Ty Feng'
                : 'MAT21C',
      ]),
  )
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('native Harness registers all 11 remote tools, attaches API evidence and unloads cleanly', async () => {
  const original = globalThis.fetch
  const seen: string[] = []
  globalThis.fetch = async (url, init) => {
    seen.push(String(url))
    assert.equal(init?.method, 'GET')
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.cache, 'no-store')
    return json({ items: [{ id: 1, comment: 'complete comment' }], next_cursor: 'cursor+opaque/' })
  }
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {}).await()
    await ctx.plugin(ToolRuntime).await()
    const fiber = ctx.plugin(plugin, {})
    await fiber.await()
    assert.equal(ctx.tools.schemas().length, 11)
    for (const ep of endpoints) {
      const result = await ctx.tools.execute({
        callId: 'test' as ToolExecutionInput['callId'],
        name: `pathfinder_${ep.name}`,
        arguments: argsFor(ep.name),
        signal: new AbortController().signal,
      })
      assert.equal(result.isError, false, JSON.stringify(result))
      const meta = result.meta as Record<string, unknown>
      assert.equal(meta?.kind, 'pathfinder.evidence')
      assert.equal(result.additionalContexts?.length, 1)
      assert.match(JSON.stringify(result.additionalContexts), /reviewed_sections/)
      assert.match(JSON.stringify(result.additionalContexts), /pathfinder_update_consultation/)
      assert.equal(meta?.count, 1)
      assert.match(String(meta?.source), /^https:\/\/rmp.richis.top\/api\/v1\//)
      assert.equal((result.value as Record<string, unknown>).evidence_id, 'test')
    }
    const before = seen.length
    for (const args of [{ q: '' }, { q: 'Ty', limit: 101 }, { q: 'Ty', account_id: 'forbidden' }]) {
      const result = await ctx.tools.execute({
        callId: 'invalid' as ToolExecutionInput['callId'],
        name: 'pathfinder_search',
        arguments: args,
        signal: new AbortController().signal,
      })
      assert.equal(result.isError, true)
    }
    assert.equal(seen.length, before)
    await fiber.dispose()
    assert.equal(ctx.tools.schemas().length, 0)
  } finally {
    globalThis.fetch = original
    await ctx.fiber.dispose()
  }
})

test('URLs preserve repeated keyword terms, cursor and date filters without automatic pagination', async () => {
  const ep = lookup('search_review_comments')
  const args = {
    term: ['no slides', 'blackboard'],
    mode: 'any',
    professor_id: 2933917,
    department: 'Computer Science',
    from: '2025-01-01',
    to: '2026-10-14',
    cursor: 'opaque+/=中文',
    limit: 20,
  }
  const url = requestUrl(ep, args)
  assert.deepEqual(url.searchParams.getAll('term'), args.term)
  assert.equal(url.searchParams.get('cursor'), args.cursor)
  let calls = 0
  const value = await executeQuery(ep, args, new AbortController().signal, 30000, async () => {
    calls++
    return json({
      items: [{ comment: 'x'.repeat(20000), course_raw: 'MATH021C' }],
      next_cursor: 'next',
    })
  })
  assert.equal(calls, 1)
  assert.equal(value.next_cursor, 'next')
  assert.equal((value.data as { items: { comment: string }[] }).items[0]!.comment.length, 20000)
  assert.match(String((value.source as Record<string, unknown>).api_url), /cursor=/)
})

test('strict API bounds, valid dates and fixed identifiers reject unsupported or malformed requests', () => {
  for (const args of [
    { term: [] },
    { term: Array(11).fill('x') },
    { term: ['x'.repeat(81)] },
    { term: ['slides'], from: '2026-02-30' },
    { term: ['slides'], from: '2026-10-14', to: '2026-10-13' },
    { term: ['slides'], min_confidence: 1.1 },
  ])
    assert.throws(() => requestUrl(lookup('search_review_comments'), args))
  for (const course_key of ['../../accounts', 'https://evil.test', 'MAT21C?raw=1'])
    assert.throws(() => requestUrl(lookup('get_course'), { course_key }))
  assert.throws(() => requestUrl(lookup('get_professor'), { professor_id: -1 }))
  assert.throws(() =>
    requestUrl(lookup('get_major_requirements'), { major_code: 'LMAT', degree: 'BA' }),
  )
  assert.equal(
    requestUrl(lookup('get_major_requirements'), {
      major_code: 'LMAT',
      degree: 'AB',
    }).searchParams.get('degree'),
    'AB',
  )
})

test('remote empty search, detail and degree records produce correct durable evidence counts', () => {
  const wrap = (data: unknown) =>
    queryMetadata({
      data,
      source: { kind: 'remote_api', api_url: 'https://rmp.richis.top/api/v1/search?q=x' },
    })
  assert.equal(wrap({ courses: [], professors: [] }).count, 0)
  assert.equal(wrap({ courses: [{ key: 'MAT21C' }], professors: [] }).count, 1)
  assert.equal(wrap({ items: [] }).count, 0)
  assert.equal(wrap({ key: 'MAT21C', prerequisites: 'MAT21B' }).count, 1)
  assert.equal(
    wrap({
      items: [{ degree_code: 'AB' }, { degree_code: 'BS', requirement_status: 'not_displayed' }],
    }).count,
    2,
  )
})

test('API errors, invalid responses and oversize bodies fail explicitly without fallback', async () => {
  const ep = lookup('search'),
    args = { q: 'Ty' }
  for (const code of [400, 404, 429, 503]) {
    let calls = 0
    await assert.rejects(
      executeQuery(ep, args, new AbortController().signal, 1000, async () => {
        calls++
        return json({ error: { code: 'test_error', message: 'snapshot unavailable' } }, code)
      }),
      new RegExp(`HTTP ${code}`),
    )
    assert.equal(calls, 1)
  }
  await assert.rejects(
    executeQuery(
      ep,
      args,
      new AbortController().signal,
      1000,
      async () => new Response('<html>not json</html>'),
    ),
    /invalid JSON/,
  )
  await assert.rejects(
    executeQuery(ep, args, new AbortController().signal, 1000, async () => json([])),
    /invalid JSON/,
  )
  await assert.rejects(
    executeQuery(ep, args, new AbortController().signal, 1000, async () =>
      json({ blob: 'x'.repeat(8 * 1024 * 1024) }),
    ),
    /exceeds 8 MiB/,
  )
})

test('in-flight cancellation, timeout and plugin unload abort outstanding HTTP requests', async () => {
  const blocked: typeof fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      const signal = options!.signal!
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  const controller = new AbortController()
  const task = executeQuery(lookup('search'), { q: 'Ty' }, controller.signal, 1000, blocked)
  controller.abort(new Error('cancelled'))
  await assert.rejects(task, /cancelled/)
  await assert.rejects(
    executeQuery(lookup('search'), { q: 'Ty' }, new AbortController().signal, 10, blocked),
    /timed out/,
  )
  const original = globalThis.fetch
  globalThis.fetch = blocked
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {}).await()
    await ctx.plugin(ToolRuntime).await()
    const fiber = ctx.plugin(plugin, {})
    await fiber.await()
    const pending = ctx.tools.execute({
      callId: 'pending' as ToolExecutionInput['callId'],
      name: 'pathfinder_search',
      arguments: { q: 'Ty' },
      signal: new AbortController().signal,
    })
    await fiber.dispose()
    assert.equal((await pending).isError, true)
  } finally {
    globalThis.fetch = original
    await ctx.fiber.dispose()
  }
})

test('configuration validates timeout and needs no local data directory', async () => {
  await assert.rejects(plugin.apply({} as Context, { timeoutMs: 0 }), /timeoutMs/)
})
