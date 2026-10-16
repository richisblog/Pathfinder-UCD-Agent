import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { Workbench, WorkbenchEntry } from './Workbench.js'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { getLanguage, setSystemLanguage, subscribeLanguage, t } from './i18n.js'
import { styles } from './style.js'

export const name = 'pathfinder-consultation-workbench'
export const inject = [
  'slots',
  'sidebarRightTabs',
  'sidebarRight',
  'sessions',
  'conversation',
  'locale',
]
const ID = 'dsh-plugin-pathfinder-ucd/workbench'
const KIND = 'pathfinder-consultation'
export function apply(ctx: Context): void {
  setSystemLanguage(ctx.locale.getLocale().active)
  ctx.on('locale/change', (snapshot) => setSystemLanguage(snapshot.active))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-plugin-pathfinder-ucd'
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  })
  ctx.effect(() => {
    const register = () =>
      ctx.sidebarRightTabs.register({
        id: ID,
        kind: KIND,
        title: () => t('咨询工作台', getLanguage()),
        guide: [
          {
            id: 'pathfinder',
            order: 5,
            title: () => t('Pathfinder 咨询工作台', getLanguage()),
            description: () => t('研究计划、结论、下一步追问与待核实事项', getLanguage()),
          },
        ],
      })
    let dispose = register()
    const unsubscribe = subscribeLanguage(() => {
      dispose()
      dispose = register()
    })
    return () => {
      unsubscribe()
      dispose()
    }
  })
  const openWorkbench = () => ctx.sidebarRight.openTab(KIND)
  ctx.effect(() =>
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: ID,
          inject: () => ({
            fillQuestion: (
              sessionId: Parameters<typeof ctx.sessions.scope>[0],
              question: string,
            ) => {
              const scope = ctx.sessions.scope(sessionId)
              if (!scope) throw new Error(t('当前会话还未就绪，请稍后重试', getLanguage()))
              const input = ctx.conversation.input.for(scope)
              input.setDraft(question)
              input.focus()
            },
          }),
        },
        Workbench,
      ),
    ),
  )
  ctx.effect(() =>
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.actions',
          id: 'pathfinder-workbench',
          order: 30,
          inject: () => ({ openWorkbench }),
        },
        WorkbenchEntry,
      ),
    ),
  )
}
