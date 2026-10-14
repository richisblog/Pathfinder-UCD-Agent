import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import type { WorkbenchProps } from '../src/client/Workbench.js'
import type { ConsultationBoard } from '../src/consultation.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
Object.defineProperty(globalThis, 'HTMLElement', {
  value: dom.window.HTMLElement,
  configurable: true,
})
Object.defineProperty(globalThis, 'MutationObserver', {
  value: dom.window.MutationObserver,
  configurable: true,
})
Object.defineProperty(globalThis, 'matchMedia', {
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  configurable: true,
})
Object.defineProperty(globalThis, 'getComputedStyle', {
  value: dom.window.getComputedStyle.bind(dom.window),
  configurable: true,
})
class Resize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { value: Resize, configurable: true })
Object.defineProperty(dom.window, 'ResizeObserver', { value: Resize, configurable: true })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const generated = resolve('test/.generated')
mkdirSync(generated, { recursive: true })
// Bundle the published primitives used by this component. CSS is irrelevant
// to DOM behavior; all unused primitive dependencies are tree-shaken here.
await build({
  entryPoints: ['src/client/Workbench.tsx'],
  outfile: resolve(generated, 'Workbench.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'clsx'],
  plugins: [
    {
      name: 'native-primitives-test-css',
      setup(builder) {
        builder.onResolve({ filter: /\.css$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path),
          namespace: 'test-css',
          sideEffects: false,
        }))
        builder.onLoad({ filter: /.*/, namespace: 'test-css' }, () => ({
          contents: 'export default new Proxy({}, {get:(_t,key)=>String(key)});',
          loader: 'js',
        }))
        builder.onResolve({ filter: /^[^.\/]/ }, (args) => {
          if (args.path === '@deepseek-ai/dsh-client-ui-primitives')
            return {
              path: resolve('node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'),
              sideEffects: false,
            }
          return { path: args.path, external: true, sideEffects: false }
        })
      },
    },
  ],
  treeShaking: true,
})
const { Workbench } = (await import(
  pathToFileURL(resolve(generated, 'Workbench.mjs')).href
)) as typeof import('../src/client/Workbench.js')
const { render, fireEvent, cleanup } = await import('@testing-library/react')
const { createElement } = await import('react')
test.after(() => {
  cleanup()
  dom.window.close()
  rmSync(generated, { recursive: true, force: true })
})
const board: ConsultationBoard = {
  visualizations: {},
  active: true,
  update_cause: 'question',
  goal: '比较 MAT 21C 教授',
  plan: [
    {
      id: 'p1',
      title: '查询课程要求',
      status: 'completed',
      evidence_ids: ['lookup'],
      note: '已取得目录证据',
    },
    {
      id: 'p2',
      title: '比较教授评价',
      status: 'in_progress',
      evidence_ids: [],
      note: '继续检索教学风格',
    },
  ],
  conclusions: [
    { id: 'c1', text: '先修课程为 MAT 021B。', confidence: 'supported', evidence_ids: ['lookup'] },
  ],
  questions: [{ question: '哪些教授更适合我的学习方式？', reason: '接下来可以比较教学风格。' }],
  uncertainties: [
    {
      id: 'u1',
      claim: '实际开课教授尚待确认。',
      reason: '历史关联不代表当期安排。',
      next_action: '核对官方课程安排。',
      status: 'open',
      evidence_ids: [],
    },
  ],
  evidence: [
    {
      id: 'lookup',
      tool: 'pathfinder_query_course_db',
      query: 'MAT21C',
      status: 'success',
      summary: '返回 1 条记录',
      source: 'courses.db',
      turn: 1,
    },
  ],
  pending: {},
  phase: 'attention',
  running: false,
  evidence_revision: 0,
  section_revisions: { plan: 0, conclusions: 0, questions: 0, uncertainties: 0 },
  revision: 1,
  last_seq: 4,
  error: '',
}

function props(
  value: ConsultationBoard | undefined,
  fillQuestion: WorkbenchProps['fillQuestion'],
): WorkbenchProps {
  return {
    sessionId: 'session-a',
    useProjection: () => value,
    fillQuestion,
  } as unknown as WorkbenchProps
}
test('native controls expose four artifacts, evidence and draft-only follow-up', () => {
  const drafts: Array<[string, string]> = []
  const view = render(
    createElement(
      Workbench,
      props(board, (id, question) => drafts.push([id, question])),
    ),
  )
  assert.ok(view.getByText('1 / 2 步已完成'))
  assert.equal(view.getByRole('progressbar').getAttribute('aria-valuenow'), '1')
  assert.ok(view.getByText('查询课程要求'))
  fireEvent.click(view.getByRole('tab', { name: /结论/ }))
  assert.ok(view.getByText('先修课程为 MAT 021B。'))
  assert.ok(view.getByText('有证据支持'))
  fireEvent.click(view.getByRole('tab', { name: /追问/ }))
  assert.ok(view.getByText('哪些教授更适合我的学习方式？'))
  fireEvent.click(view.getByRole('button', { name: /填入追问/ }))
  assert.deepEqual(drafts, [['session-a', '哪些教授更适合我的学习方式？']])
  fireEvent.click(view.getByRole('tab', { name: /存疑/ }))
  assert.ok(view.getByText('实际开课教授尚待确认。'))
  assert.ok(view.getByText('核对官方课程安排。'))
  view.unmount()
})
test('empty state does not invent progress, conclusions or predicted questions', () => {
  const view = render(
    createElement(
      Workbench,
      props(undefined, () => {}),
    ),
  )
  assert.ok(view.getByText('尚未制定计划'))
  assert.equal(view.getByRole('progressbar').getAttribute('aria-valuenow'), '0')
  fireEvent.click(view.getByRole('tab', { name: /追问/ }))
  assert.ok(view.getByText('留出继续探索的空间'))
  assert.equal(view.queryByRole('button', { name: /填入追问/ }), null)
  view.unmount()
})
test('switching the session projection removes previous conclusions', () => {
  const view = render(
    createElement(
      Workbench,
      props(board, () => {}),
    ),
  )
  fireEvent.click(view.getByRole('tab', { name: /结论/ }))
  assert.ok(view.getByText('先修课程为 MAT 021B。'))
  view.rerender(
    createElement(
      Workbench,
      props({ ...board, goal: '专业新问题', conclusions: [], evidence: [], plan: [] }, () => {}),
    ),
  )
  assert.equal(view.queryByText('先修课程为 MAT 021B。'), null)
  assert.ok(view.getByText('结论会留在这里'))
  view.unmount()
})

test('new evidence shows a live synchronization state instead of presenting old conclusions as current', () => {
  const view = render(
    createElement(
      Workbench,
      props(
        {
          ...board,
          update_cause: 'evidence',
          running: true,
          evidence_revision: 2,
          section_revisions: { plan: 2, conclusions: 1, questions: 1, uncertainties: 1 },
        },
        () => {},
      ),
    ),
  )
  fireEvent.click(view.getByRole('tab', { name: /结论/ }))
  assert.ok(view.getByText(/新证据已到达/))
  assert.ok(view.getByText('正在同步咨询产物'))
  view.rerender(
    createElement(
      Workbench,
      props(
        {
          ...board,
          update_cause: 'evidence',
          running: true,
          evidence_revision: 2,
          section_revisions: { plan: 2, conclusions: 2, questions: 2, uncertainties: 2 },
        },
        () => {},
      ),
    ),
  )
  assert.equal(view.queryByText(/新证据已到达/), null)
  assert.ok(view.getByText('已同步当前内容'))
  view.unmount()
})
test('Agent-selected custom visualizations retain their inspectable data and isolated interactions', () => {
  const visual = {
    kind: 'html' as const,
    title: '课程选择流程',
    rationale: '按步骤选择更清晰',
    origin: 'artifacts' as const,
    evidence_ids: [],
    markup:
      '<button id="choice">查看下一步</button><svg width="100" height="40"><text x="10" y="25">确定目标</text></svg>',
    script: 'document.getElementById("choice").onclick=()=>document.body.dataset.choice="next"',
    data: { steps: ['确定目标', '核对课程'] },
  }
  const view = render(
    createElement(
      Workbench,
      props({ ...board, visualizations: { plan: visual } }, () => {}),
    ),
  )
  const frame = view.container.querySelector('iframe')!
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts')
  assert.match(frame.getAttribute('srcdoc')!, /PATHFINDER_DATA/)
  assert.match(frame.getAttribute('srcdoc')!, /确定目标/)
  assert.ok(view.getByText('核对数据与配置'))
  view.unmount()
})

test('student clarification presents a waiting state instead of query activity or an obsolete guard error', () => {
  const view = render(
    createElement(
      Workbench,
      props(
        {
          ...board,
          phase: 'clarifying',
          running: true,
          plan: [],
          pending: { question: { name: 'pathfinder_assess_request', query: '课程用途' } },
          error: '查询失败，保留现有证据并等待核实',
        },
        () => {},
      ),
    ),
  )
  assert.ok(view.getByText('等待你的回答，再确定研究方向'))
  assert.ok(view.getByText('先补充影响决策的信息'))
  assert.equal(view.queryByText(/正在查询/), null)
  assert.equal(view.queryByText('查询失败，保留现有证据并等待核实'), null)
  view.unmount()
})
