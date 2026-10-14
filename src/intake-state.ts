import { z } from 'zod'
export const intakeSchema = z.object({
  request: z.string().max(600),
  status: z.enum(['ready', 'needs_reassessment']),
  known: z.array(z.string().max(500)).max(12),
  missing: z.array(z.string().max(500)).max(8),
})
export const answerSchema = z.object({
  question: z.string().max(600),
  answer: z.string().max(1800),
})
export function isPersonalAdvice(request: string): boolean {
  return /选什么课|该选|适合我|帮我.{0,12}(选课|选专业|规划)|给我.{0,12}(推荐|方案)|推荐.{0,12}(给我|课程)|what.{0,12}should I|recommend.{0,12}(me|courses)|courses?.{0,12}for me/i.test(
    request,
  )
}
export function intakeBlock(board: {
  student_request?: string
  goal: string
  intake?: z.infer<typeof intakeSchema> | null
  student_answers?: z.infer<typeof answerSchema>[]
}): string | undefined {
  const request = board.student_request || board.goal
  if (board.intake?.status === 'needs_reassessment')
    return 'The student answered a clarification. Reassess the actual answer with pathfinder_assess_request; if a critical condition is still missing, ask ONE focused question before campus queries.'
  if (isPersonalAdvice(request) && (!board.intake || board.intake.request !== request))
    return 'Personalized advice is missing an intake assessment. Call pathfinder_assess_request first. Unknown goals, prerequisites or workload cannot be replaced with generic course candidates. Ask the highest-impact missing question now; do not query courses first and ask only in the final answer.'
}

export function isBroadPersonalAdvice(request: string): boolean {
  return (
    isPersonalAdvice(request) &&
    !/专业|大[一二三四]|年级|毕业|实习|编程|数学|统计|经济|打工|学分|\bGE\b|\b(?:ECS|MAT|STA|CHE)\s*\d|major|internship|graduate|units/i.test(
      request,
    )
  )
}
