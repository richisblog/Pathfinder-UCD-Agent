import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import type { Visualization as Spec } from '../visualization.js'
import { t, useLanguage } from './i18n.js'
import { chartOption, type ChartTheme } from './chart-option.js'

type Theme = ChartTheme
function readTheme(element?: HTMLElement | null): Theme {
  const css = getComputedStyle(element || document.body)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    text: get('--dsw-alias-label-primary', '#1f2329'),
    muted: get('--dsw-alias-label-secondary', '#6b7280'),
    border: get('--dsw-alias-border-l4', '#e5e7eb'),
    brand: get('--dsw-alias-brand-primary', '#4d6bfe'),
    background: get('--dsw-alias-bg-base', '#ffffff'),
    font: get('--dsw-font-family', 'system-ui, sans-serif'),
  }
}
function useTheme(target: React.RefObject<HTMLElement>): Theme {
  const [theme, setTheme] = useState<Theme>(() => readTheme(target.current))
  useEffect(() => {
    const update = () =>
      setTheme((current) => {
        const next = readTheme(target.current)
        return JSON.stringify(current) === JSON.stringify(next) ? current : next
      })
    const observer = new MutationObserver(update)
    for (
      let element: HTMLElement | null = target.current || document.body;
      element;
      element = element.parentElement
    )
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'],
      })
    update()
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])
  return theme
}
function EChart({ spec, theme }: { spec: Spec; theme: Theme }) {
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<echarts.ECharts>()
  const language = useLanguage()
  const [error, setError] = useState('')
  const signature = JSON.stringify(spec)
  useEffect(() => {
    if (!host.current) return
    const instance = echarts.init(host.current, undefined, { renderer: spec.renderer || 'svg' })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = undefined
    }
  }, [spec.renderer])
  useEffect(() => {
    const instance = chart.current
    if (!instance) return
    try {
      const option = chartOption(spec, theme)
      for (const map of spec.maps || [])
        echarts.registerMap(
          map.name,
          map.geo_json as unknown as Parameters<typeof echarts.registerMap>[1],
        )
      instance.setOption(option, { notMerge: true, lazyUpdate: false })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('无法显示此图表', language))
    }
  }, [signature, theme])
  return (
    <>
      <div
        className="pfw-chart"
        ref={host}
        style={{ height: spec.height || 270 }}
        role="img"
        aria-label={spec.title}
      />
      {error && (
        <p className="pfw-notice" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
export function frameDocument(spec: Spec, theme: Theme): string {
  const script = (spec.script || '').replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:light dark;--pf-brand:${theme.brand};--pf-text:${theme.text};--pf-muted:${theme.muted};--pf-border:${theme.border};--pf-bg:${theme.background}}*{box-sizing:border-box}body{margin:0;padding:12px;font:13px/1.65 ${theme.font};color:var(--pf-text);background:var(--pf-bg)}svg,canvas{max-width:100%;height:auto}button,input,select{font:inherit;color:inherit;border:1px solid var(--pf-border);border-radius:8px;background:var(--pf-bg);padding:6px 10px}button{cursor:pointer}button:hover{border-color:var(--pf-brand)}table{width:100%;border-collapse:collapse}td,th{padding:7px;text-align:left;border-bottom:1px solid var(--pf-border)}</style></head><body>${spec.kind === 'canvas' ? '<canvas id="pathfinder-canvas" width="960" height="520" aria-label="交互演示"></canvas>' : ''}${spec.markup || ''}<script>window.PATHFINDER_DATA=${json(spec.data ?? {})};window.PATHFINDER_THEME=${json(theme)};${script}</script></body></html>`
}
export function Visualization({ spec }: { spec: Spec }) {
  const language = useLanguage()
  const root = useRef<HTMLElement>(null)
  const theme = useTheme(root)
  const source = useMemo(() => frameDocument(spec, theme), [spec, theme])
  return (
    <section ref={root} className="pfw-visualization" aria-label={spec.title}>
      <div className="pfw-line">
        <h3>{spec.title}</h3>
        <span>
          {t(
            { evidence: '查询证据', artifacts: '咨询产物', scenario: '假设演示' }[spec.origin],
            language,
          )}
        </span>
      </div>
      {spec.rationale && <p className="pfw-section-note">{spec.rationale}</p>}
      {spec.kind === 'echarts' ? (
        <EChart spec={spec} theme={theme} />
      ) : (
        <iframe
          className="pfw-custom-visual"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={spec.title}
          style={{ height: spec.height || (spec.kind === 'svg' ? 190 : 300) }}
          srcDoc={source}
        />
      )}
      {spec.assumptions && (
        <p className="pfw-section-note">
          {t('假设：', language)}
          {spec.assumptions}
        </p>
      )}
      <details className="pfw-sources">
        <summary>{t('核对数据与配置', language)}</summary>
        <pre className="pfw-config">
          {JSON.stringify(
            spec.kind === 'echarts'
              ? spec.option
              : { data: spec.data ?? null, markup: spec.markup || '', script: spec.script || '' },
            null,
            2,
          )}
        </pre>
        <small>
          {t('来源引用：', language)}
          {spec.evidence_ids.join(' · ') || t('当前咨询产物或已注明假设', language)}
        </small>
      </details>
    </section>
  )
}
