import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import * as plugin from '../dist/index.js'
import { endpoints } from '../dist/api-contract.js'
const ctx = new Context()
const report: Record<string, unknown>[] = []
try {
  await ctx.plugin(SystemPrompt, {}).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(plugin, {}).await()
  async function call(name: string, args: unknown) {
    const result = await ctx.tools.execute({
      callId: `live-${name}` as ToolExecutionInput['callId'],
      name: `pathfinder_${name}`,
      arguments: args,
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result)}`)
    const value = result.value as { data: Record<string, unknown>; source: Record<string, unknown> }
    report.push({ tool: name, args, source: value.source, evidence: result.meta })
    console.log(`${name}: OK`)
    return value.data
  }
  const search = await call('search', { q: 'Ty Feng', type: 'professor', limit: 5 })
  const professor = (search.professors as { id: number; name: string }[]).find(
    (x) => x.name === 'Ty Feng',
  )!
  assert.ok(professor?.id)
  const cases: Record<string, unknown> = {
    search_major_requirements: { q: 'Mathematics' },
    get_major_requirements: { major_code: 'LMAT', degree: 'AB' },
    search_review_comments: { term: ['exam'], professor_id: professor.id, limit: 2 },
    get_course: { course_key: 'ECS20' },
    get_course_professors: { course_key: 'ECS20', limit: 2 },
    get_professor_course_stats: { course_key: 'ECS20', professor_id: professor.id },
    get_official_catalog_course: { course_key: 'MAT21C' },
    get_professor: { professor_id: professor.id },
    get_professor_courses: { professor_id: professor.id, limit: 2 },
    get_professor_reviews: { professor_id: professor.id, course: 'ECS20', limit: 2 },
  }
  for (const ep of endpoints) if (ep.name !== 'search') await call(ep.name, cases[ep.name])
  const bs = await call('get_major_requirements', { major_code: 'LMAT', degree: 'BS' })
  assert.equal((bs.items as { degree_code: string }[])[0]?.degree_code, 'BS')
  await writeFile(
    'live-api-verification.json',
    JSON.stringify(
      { verified_at: new Date().toISOString(), service: 'https://rmp.richis.top', calls: report },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `Verified ${report.length} calls across ${endpoints.length} native tools; AB/BS tested separately.`,
  )
} finally {
  await ctx.fiber.dispose()
}
