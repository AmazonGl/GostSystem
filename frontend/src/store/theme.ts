import { create } from 'zustand'

type Theme = 'dark' | 'light'

const stored = (localStorage.getItem('theme') as Theme) || 'dark'

// применяем тему к <html data-theme="...">
function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}
apply(stored)

interface ThemeStore {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: stored,
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('theme', next)
    apply(next)
    set({ theme: next })
  },
  setTheme: (t) => {
    localStorage.setItem('theme', t)
    apply(t)
    set({ theme: t })
  },
}))
