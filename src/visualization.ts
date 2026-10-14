import { z } from 'zod'
export const SECTIONS = ['plan', 'conclusions', 'questions', 'uncertainties'] as const
export type Section = (typeof SECTIONS)[number]
export const visualizationSchema = z.object({
  kind: z.enum(['echarts', 'html', 'svg', 'canvas']),
  title: z.string().min(1).max(160),
  rationale: z.string().max(500),
  origin: z.enum(['evidence', 'artifacts', 'scenario']),
  evidence_ids: z.array(z.string().max(160)).max(12),
  assumptions: z.string().max(1800).optional(),
  renderer: z.enum(['svg', 'canvas']).optional(),
  height: z.number().int().min(120).max(700).optional(),
  option: z.record(z.string(), z.json()).optional(),
  markup: z.string().max(50000).optional(),
  script: z.string().max(30000).optional(),
  data: z.json().optional(),
  maps: z
    .array(z.object({ name: z.string().min(1).max(80), geo_json: z.record(z.string(), z.json()) }))
    .max(4)
    .optional(),
})
export type Visualization = z.infer<typeof visualizationSchema>
export const visualizationsSchema = z.object({
  plan: visualizationSchema.nullable().optional(),
  conclusions: visualizationSchema.nullable().optional(),
  questions: visualizationSchema.nullable().optional(),
  uncertainties: visualizationSchema.nullable().optional(),
})
export type Visualizations = z.infer<typeof visualizationsSchema>
export function validateVisualization(spec: Visualization): void {
  if (JSON.stringify(spec).length > 160000)
    throw new Error('Visualization configuration is limited to 160 KB')
  for (const map of spec.maps || [])
    if (map.geo_json.type !== 'FeatureCollection' || !Array.isArray(map.geo_json.features))
      throw new Error('Embedded maps require GeoJSON FeatureCollection data')
  if (spec.kind === 'echarts') {
    if (!spec.option)
      throw new Error('An ECharts visualization requires a deterministic JSON option')
    const series = Array.isArray(spec.option.series)
      ? spec.option.series
      : [spec.option.series].filter(Boolean)
    if (!series.length)
      throw new Error('An ECharts visualization needs at least one declared series')
    for (const entry of series) {
      const item = entry as Record<string, unknown>
      if (item.type === 'graph' && item.layout !== 'circular') {
        const nodes = Array.isArray(item.data)
          ? item.data
          : Array.isArray(item.nodes)
            ? item.nodes
            : []
        if (
          item.layout === 'force' ||
          !nodes.length ||
          nodes.some((node) => {
            const value = node as Record<string, unknown>
            return (
              !(
                typeof value.x === 'number' &&
                Number.isFinite(value.x) &&
                typeof value.y === 'number' &&
                Number.isFinite(value.y)
              ) &&
              !(
                Array.isArray(value.value) &&
                value.value.length >= 2 &&
                value.value.slice(0, 2).every((x) => typeof x === 'number' && Number.isFinite(x))
              )
            )
          })
        )
          throw new Error(
            'Use graph layout none with explicit x/y coordinates, or deterministic circular layout',
          )
      }
    }
    const json = JSON.stringify(spec.option)
    if (/image:\/\/(?:https?:|\/\/)/i.test(json))
      throw new Error('Chart images must be embedded locally')
  }
  if (spec.kind === 'html' || spec.kind === 'svg') {
    if (!spec.markup?.trim()) throw new Error('HTML/SVG visualizations require markup')
  }
  if (spec.kind === 'canvas' && !spec.script?.trim())
    throw new Error('A Canvas visualization requires deterministic drawing code')
  if (spec.script && /\bMath\s*\.\s*random\s*\(/.test(spec.script))
    throw new Error('Visualization scripts must use deterministic data and layout')
  if (spec.origin === 'scenario' && !spec.assumptions?.trim())
    throw new Error('Scenario visualizations must state their assumptions')
  if (spec.origin === 'evidence' && !spec.evidence_ids.length)
    throw new Error('Evidence-based charts require actual query evidence IDs')
}
