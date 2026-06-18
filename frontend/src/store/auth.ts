import { create } from 'zustand'
import { authApi } from '../api/client'

interface User { id: string; email: string; name: string; role: string }

interface AuthStore {
  user: User | null
  token: string | null
  setToken: (token: string) => void
  loadMe: () => Promise<void>
  logout: () => void
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  token: localStorage.getItem('token'),

  setToken: (token) => {
    localStorage.setItem('token', token)
    set({ token })
  },

  loadMe: async () => {
    try {
      const { data } = await authApi.me()
      set({ user: data })
    } catch {
      localStorage.removeItem('token')
      set({ user: null, token: null })
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null })
  },
}))
