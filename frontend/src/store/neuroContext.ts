interface NeuroCtx {
  page: string
  gostCode: string
  activeSection: string
  sectionText: string
  documentTitle: string
}

let _ctx: NeuroCtx = { page: '', gostCode: '', activeSection: '', sectionText: '', documentTitle: '' }
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
