import type { ParameterSchemaSpec, ParameterPropertySpec } from '@deepseek-ai/dsh-tools'
import type { Args, Json, Result } from './types.js'
export const API_ORIGIN = 'https://rmp.richis.top'
export interface ApiSchema {
  type: string
  enum?: (string | number)[]
  default?: string | number
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  format?: string
  items?: ApiSchema
}
export interface Endpoint {
  name: string
  path: string
  description: string
  parameters: {
    name: string
    in: string
    required?: boolean
    description?: string
    schema: ApiSchema
    style?: string
    explode?: boolean
  }[]
}
/** The native DSL omits bounds; enforce them before making the GET request. */
export function toolParameters(endpoint: Endpoint): ParameterSchemaSpec {
  function convert(s: ApiSchema): ParameterPropertySpec {
    return {
      type: s.type,
      ...(s.enum ? { enum: s.enum } : {}),
      ...(s.items ? { items: convert(s.items) } : {}),
    } as ParameterPropertySpec
  }
  return Object.fromEntries(
    endpoint.parameters.map((p) => [
      p.name,
      {
        ...convert(p.schema),
        ...(p.required ? { required: true as const } : {}),
        description: [
          p.description,
          p.schema.minimum !== undefined ? `Minimum ${p.schema.minimum}.` : '',
          p.schema.maximum !== undefined ? `Maximum ${p.schema.maximum}.` : '',
          p.schema.maxItems !== undefined ? `At most ${p.schema.maxItems} items.` : '',
          p.schema.default !== undefined ? `Default ${p.schema.default}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
    ]),
  )
}
function validate(value: unknown, s: ApiSchema, name: string): void {
  if (s.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < (s.minItems ?? 0) ||
      value.length > (s.maxItems ?? 100)
    )
      throw new Error(`Invalid ${name} array length`)
    value.forEach((item) => validate(item, s.items!, name))
  } else if (s.type === 'string') {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length < (s.minLength ?? 1) ||
      value.length > (s.maxLength ?? 2000)
    )
      throw new Error(`Invalid ${name} string`)
    if (
      s.format === 'date' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new Error(`Invalid ${name} calendar date`)
  } else if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (s.type === 'integer' && !Number.isSafeInteger(value)) ||
    value < (s.minimum ?? -Infinity) ||
    value > (s.maximum ?? Infinity)
  )
    throw new Error(`Invalid ${name} number`)
  if (s.enum && !s.enum.includes(value as string | number)) throw new Error(`Invalid ${name} enum`)
}
export function requestUrl(endpoint: Endpoint, args: Args): URL {
  for (const key of Object.keys(args))
    if (!endpoint.parameters.some((p) => p.name === key))
      throw new Error(`Unsupported API parameter: ${key}`)
  let path = endpoint.path
  const query = new URLSearchParams()
  for (const p of endpoint.parameters) {
    const value = args[p.name] === undefined ? p.schema.default : args[p.name]
    if (value === undefined) {
      if (p.required) throw new Error(`Missing ${p.name}`)
      continue
    }
    validate(value, p.schema, p.name)
    if (p.in === 'path') {
      if (p.name === 'professor_id' && Number(value) <= 0)
        throw new Error('Professor ID must be positive')
      if (typeof value === 'string' && !/^[a-zA-Z0-9 ]+$/.test(value))
        throw new Error(`Invalid ${p.name} identifier`)
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)))
    } else
      for (const item of Array.isArray(value) ? value : [value]) query.append(p.name, String(item))
  }
  if (typeof args.from === 'string' && typeof args.to === 'string' && args.from > args.to)
    throw new Error('from must not be after to')
  const url = new URL(path, API_ORIGIN)
  url.search = query.toString()
  return url
}
/** GET only; no local database, persistent cache, retries or implicit pagination. */
export async function executeQuery(
  endpoint: Endpoint,
  args: Args,
  signal: AbortSignal,
  timeoutMs = 30000,
  transport: typeof fetch = fetch,
): Promise<Result> {
  signal.throwIfAborted()
  const url = requestUrl(endpoint, args)
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('CourseScope API request timed out')),
    timeoutMs,
  )
  const combined = AbortSignal.any([signal, controller.signal])
  try {
    const response = await transport(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: combined,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    })
    if (!response.body) throw new Error('CourseScope API returned no response body')
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        combined.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8 * 1024 * 1024)
          throw new Error('CourseScope response exceeds 8 MiB; narrow query or limit')
        chunks.push(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    }
    let data: Record<string, Json>
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      data = parsed as Record<string, Json>
    } catch {
      throw new Error(
        `CourseScope API HTTP ${response.status}: invalid JSON response; live verification unavailable`,
      )
    }
    if (!response.ok) {
      const error = data.error as Record<string, Json> | undefined
      throw new Error(
        `CourseScope API HTTP ${response.status}: ${String(error?.code ?? '')} ${String(error?.message ?? response.statusText)}. ${response.status === 404 ? 'Re-search the entity identifier.' : response.status === 400 ? 'Correct the request parameters.' : 'Live verification unavailable; no local fallback.'}`,
      )
    }
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error('CourseScope response is not application/json')
    return {
      data,
      source: {
        kind: 'remote_api',
        api_url: url.href,
        requested_at: new Date().toISOString(),
        service: 'CourseScope',
        note: 'Live API request to a server-side snapshot. requested_at is request time, not source collection/effective date; inspect fetched_at/as_of in data.',
      },
      next_cursor: data.next_cursor ?? null,
    }
  } finally {
    clearTimeout(timer)
  }
}
