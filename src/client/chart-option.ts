import type { EChartsOption } from 'echarts'
import type { Visualization } from '../visualization.js'
export interface ChartTheme {
  text: string
  muted: string
  border: string
  brand: string
  background: string
  font: string
}
/** Pure presentation projection: preserve every data value and label. */
export function chartOption(spec: Visualization, theme: ChartTheme): EChartsOption {
  const option = JSON.parse(JSON.stringify(spec.option || {})) as Record<string, unknown>
  const styleAxis = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(styleAxis)
    if (!value || typeof value !== 'object') return value
    const axis = value as Record<string, unknown>
    return {
      ...axis,
      axisLabel: { ...(axis.axisLabel as object), color: theme.muted },
      nameTextStyle: { ...(axis.nameTextStyle as object), color: theme.muted },
      axisLine: { ...(axis.axisLine as object), lineStyle: { color: theme.border } },
      splitLine: { ...(axis.splitLine as object), lineStyle: { color: theme.border } },
    }
  }
  if (option.xAxis) option.xAxis = styleAxis(option.xAxis)
  if (option.yAxis) option.yAxis = styleAxis(option.yAxis)
  const legend = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(legend)
      : value && typeof value === 'object'
        ? {
            ...value,
            textStyle: { ...(value as { textStyle?: object }).textStyle, color: theme.text },
          }
        : value
  if (option.legend) option.legend = legend(option.legend)
  return {
    ...option,
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { ...(option.textStyle as object), fontFamily: theme.font, color: theme.text },
    color: option.color || [theme.brand, '#64a7e8', '#6bb5a5', '#a18ad8', '#dca85a'],
    tooltip: { ...(option.tooltip as object), renderMode: 'richText' },
    grid: option.grid || { left: 18, right: 18, top: 35, bottom: 36, containLabel: true },
  } as EChartsOption
}
