import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { executeQuery, toolParameters } from './runtime.js'
import { endpoints } from './api-contract.js'
import type { Args, Result } from './types.js'
import { queryMetadata } from './consultation.js'
import { installIntake } from './intake.js'
import { installProgress } from './progress.js'
import { COURSE_SCOPE_PROTOCOL } from './protocol.js'
export const name = 'pathfinder-ucd'
export const inject = ['tools']
export interface Config {
  timeoutMs?: number
}
export const Config = z.object({
  timeoutMs: z
    .number()
    .default(30000)
    .description(
      'CourseScope GET timeout in milliseconds (100–120000); default 30000. No local data directory required.',
    ),
})
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const timeoutMs = config.timeoutMs ?? 30000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000)
    throw new Error('timeoutMs must be an integer from 100 to 120000')
  ctx.inject(['tools', 'sessionProjections', 'systemPrompt'], installProgress)
  ctx.inject(['tools', 'sessionProjections', 'userQuestions'], installIntake)
  ctx.inject(['systemPrompt'], (scoped) =>
    scoped.systemPrompt.section({
      name: 'pathfinder:coursescope-protocol',
      order: 2940,
      text: COURSE_SCOPE_PROTOCOL,
    }),
  )
  const controller = new AbortController(),
    pending = new Set<Promise<Result>>()
  ctx.effect(() => async () => {
    controller.abort()
    await Promise.allSettled([...pending])
  })
  for (const endpoint of endpoints) {
    ctx.tools.register(
      defineTool({
        name: `pathfinder_${endpoint.name}`,
        description: `${endpoint.description} Read-only CourseScope JSON API; cite source.api_url and source timestamps. No local database fallback.`,
        parameters: toolParameters(endpoint),
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          presentationMeta: (_args, value) => queryMetadata(value) as Result,
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const task = executeQuery(
            endpoint,
            args as Args,
            AbortSignal.any([exec.signal, controller.signal]),
            timeoutMs,
          )
          pending.add(task)
          try {
            const value = await task
            exec.deferContext(
              createUserMessage({
                source: { kind: 'pathfinder-progress' },
                content: [
                  {
                    type: 'text',
                    text: `Pathfinder observation ${exec.callId} has settled. Before another campus query, call pathfinder_update_consultation to reflect this observation in changed sections; include reviewed_sections for unchanged plan/conclusions/questions/uncertainties after review. If more data is needed, keep conclusions tentative and the next lookup pending rather than waiting to publish. Do not retry the query you just completed. The next progress snapshot contains evidence IDs and stale sections.`,
                  },
                ],
              }),
            )
            return { ...value, evidence_id: exec.callId }
          } finally {
            pending.delete(task)
          }
        },
      }),
    )
  }
}
