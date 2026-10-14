import test from 'node:test'
import assert from 'node:assert/strict'
import * as echarts from 'echarts'
import {
  visualizationSchema,
  validateVisualization,
  type Visualization,
} from '../dist/visualization.js'
import { chartOption } from '../dist/client/chart-option.js'
import { emptyBoard, foldBoard, staleSections, validateDocument } from '../dist/consultation.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
const spec: Visualization = {
  kind: 'echarts',
  title: '课程评分比较',
  rationale: '相同量表上的课程对比',
  origin: 'evidence',
  evidence_ids: ['query1'],
  option: {
    tooltip: { trigger: 'axis' },
    legend: { data: ['质量', '难度'] },
    xAxis: { type: 'category', data: ['ECS 020', 'ECS 140A', 'ECS 034'] },
    yAxis: { type: 'value', min: 0, max: 5 },
    series: [
      { name: '质量', type: 'bar', data: [4, 3.7, 3.4] },
      { name: '难度', type: 'bar', data: [2.86, 2.8, 3] },
    ],
  },
}
const theme = {
  text: '#222',
  muted: '#666',
  border: '#ddd',
  brand: '#4d6bfe',
  background: '#fff',
  font: 'sans-serif',
}
const event = (type: string, data: unknown, seq: number): SessionEvent =>
  ({ type, data, seq, time: '2026-10-13T12:00:00Z' }) as unknown as SessionEvent

test('ECharts options retain exact values, axes and labels through theme and live-data changes', () => {
  validateVisualization(visualizationSchema.parse(spec))
  const light = chartOption(spec, theme)
  const dark = chartOption(spec, { ...theme, text: '#eee', border: '#444', background: '#111' })
  assert.deepEqual(light.series, spec.option!.series)
  assert.deepEqual(dark.series, spec.option!.series)
  assert.deepEqual((light.xAxis as { data: unknown }).data, ['ECS 020', 'ECS 140A', 'ECS 034'])
  assert.equal((dark.yAxis as { max: number }).max, 5)
  const changed = chartOption(
    {
      ...spec,
      option: { ...spec.option, series: [{ name: '质量', type: 'bar', data: [4.1, 3.89, 3] }] },
    },
    theme,
  )
  assert.deepEqual((changed.series as Array<{ data: number[] }>)[0]!.data, [4.1, 3.89, 3])
  assert.deepEqual(chartOption(spec, theme), light)
})
test('the actual ECharts SVG engine renders deterministic declared data', () => {
  const chart = echarts.init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: 640,
    height: 300,
  })
  try {
    chart.setOption(chartOption(spec, theme))
    const svg = chart.renderToSVGString()
    assert.match(svg, /<svg/)
    assert.match(svg, /ECS 020/)
    assert.match(svg, /ECS 140A/)
    assert.doesNotMatch(svg, /NaN/)
  } finally {
    chart.dispose()
  }
})
test('Agent-selected HTML, SVG and Canvas are accepted; random layout and ungrounded data are rejected', () => {
  for (const kind of ['html', 'svg', 'canvas'] as const) {
    validateVisualization({
      kind,
      title: '研究步骤',
      rationale: '按步骤展示',
      origin: 'artifacts',
      evidence_ids: [],
      markup: '<svg><text>步骤一</text></svg>',
      script:
        kind === 'canvas'
          ? 'const canvas=document.getElementById("pathfinder-canvas");const ctx=canvas.getContext("2d");ctx.fillText(PATHFINDER_DATA.label,10,20)'
          : '',
      data: { label: '步骤一' },
    })
  }
  assert.throws(
    () =>
      validateVisualization({
        ...spec,
        option: { series: [{ type: 'graph', layout: 'force', data: [{ name: 'a' }] }] },
      }),
    /explicit x\/y/,
  )
  assert.throws(() => validateVisualization({ ...spec, evidence_ids: [] }), /actual query/)
  assert.throws(() => validateVisualization({ ...spec, origin: 'scenario' }), /assumptions/)
  assert.throws(
    () =>
      validateVisualization({
        kind: 'canvas',
        title: 'random',
        rationale: '',
        origin: 'artifacts',
        evidence_ids: [],
        script: 'ctx.fillRect(Math.random()*100,0,10,10)',
      }),
    /deterministic/,
  )
  assert.throws(
    () => validateDocument({ ...emptyBoard(), visualizations: { conclusions: spec } }, []),
    /unavailable evidence/,
  )
})
test('each artifact section receives independent atomic updates after every new observation', () => {
  let board = emptyBoard()
  board = foldBoard(
    board,
    event(
      'user/message',
      { source: { kind: 'user' }, content: [{ type: 'text', text: '选课比较' }] },
      0,
    ),
  )
  assert.deepEqual(staleSections(board), ['plan', 'conclusions', 'questions', 'uncertainties'])
  const doc = {
    ...board,
    goal: '选课比较',
    plan: [{ id: 'p1', title: '查课程', status: 'in_progress', evidence_ids: [], note: '' }],
    visualizations: {
      plan: {
        kind: 'svg',
        title: '步骤',
        rationale: '',
        origin: 'artifacts',
        evidence_ids: [],
        markup: '<svg><text>查课程</text></svg>',
      },
    },
  }
  board = foldBoard(
    board,
    event(
      'tool/result',
      {
        message: { toolCallId: 'update', isError: false },
        meta: {
          kind: 'pathfinder.document',
          document: doc,
          sections: ['plan', 'conclusions', 'questions', 'uncertainties', 'visualizations'],
        },
      },
      1,
    ),
  )
  assert.deepEqual(staleSections(board), [])
  board = foldBoard(
    board,
    event(
      'tool/call',
      { callId: 'query1', name: 'pathfinder_query_course_db', arguments: '{}' },
      2,
    ),
  )
  board = foldBoard(
    board,
    event(
      'tool/result',
      {
        turn: 1,
        message: { toolCallId: 'query1', isError: false },
        meta: { kind: 'pathfinder.evidence', count: 1, summary: '一条记录', source: 'courses.db' },
      },
      3,
    ),
  )
  assert.deepEqual(staleSections(board), ['plan', 'conclusions', 'questions', 'uncertainties'])
  const update = {
    ...board,
    conclusions: [
      { id: 'c1', text: '有课程证据', confidence: 'supported', evidence_ids: ['query1'] },
    ],
    visualizations: { conclusions: spec },
  }
  board = foldBoard(
    board,
    event(
      'tool/result',
      {
        message: { toolCallId: 'update2', isError: false },
        meta: {
          kind: 'pathfinder.document',
          document: update,
          sections: ['conclusions', 'visualizations'],
        },
      },
      4,
    ),
  )
  assert.deepEqual(staleSections(board), ['plan', 'questions', 'uncertainties'])
  assert.equal(board.conclusions[0]!.text, '有课程证据')
  assert.equal(board.visualizations.plan?.kind, 'svg')
  assert.equal(board.visualizations.conclusions?.kind, 'echarts')
})

test('large progress snapshots remain parseable and preserve full stored artifacts', async () => {
  const { progressContext } = await import('../dist/consultation.js')
  const board = {
    ...emptyBoard(),
    active: true,
    goal: '课程'.repeat(300),
    plan: Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      title: '计划'.repeat(120),
      note: '内容'.repeat(800),
      status: 'pending' as const,
      evidence_ids: ['a'.repeat(160), 'b'.repeat(160)],
    })),
    conclusions: Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      text: '结论'.repeat(800),
      confidence: 'tentative' as const,
      evidence_ids: ['a'.repeat(160), 'b'.repeat(160)],
    })),
    uncertainties: Array.from({ length: 12 }, (_, i) => ({
      id: `u${i}`,
      claim: '存疑'.repeat(800),
      reason: '原因'.repeat(800),
      next_action: '核实'.repeat(800),
      status: 'open' as const,
      evidence_ids: ['a'.repeat(160), 'b'.repeat(160)],
    })),
  }
  const output = progressContext(board)
  const payload = output.slice(output.indexOf('\n') + 1)
  assert.ok(payload.length <= 14000)
  const parsed = JSON.parse(payload)
  assert.equal(parsed.compact_summary, true)
  assert.equal(parsed.plan.length, 12)
  assert.equal(board.conclusions[0]!.text.length, 1600)
})
