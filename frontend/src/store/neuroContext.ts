interface NeuroCtx {
  page: string
  gostCode: string
  activeSection: string
  sectionText: string
  sectionHint: string
  documentTitle: string
  projectTopic: string   // о чём документ / предмет разработки (задаёт пользователь)
  // колбэк: вставить предложенный помощником текст в активный раздел редактора
  applyText?: (text: string) => void
}

let _ctx: NeuroCtx = { page: '', gostCode: '', activeSection: '', sectionText: '', sectionHint: '', documentTitle: '', projectTopic: '' }
const _listeners = new Set<() => void>()

export const neuroContext = {
  get: (): NeuroCtx => ({ ..._ctx }),
  set: (partial: Partial<NeuroCtx>) => {
    _ctx = { ..._ctx, ...partial }
    _listeners.forEach(fn => fn())
  },
  subscribe: (fn: () => void): (() => void) => {
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  },
}
