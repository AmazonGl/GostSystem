import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { authApi } from '../api/client'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const { setToken, loadMe } = useAuth()
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      let token: string
      if (tab === 'login') {
        const { data } = await authApi.login(email, password)
        token = data.access_token
      } else {
        const { data } = await authApi.register(email, password, name)
        token = data.access_token
      }
      setToken(token)
      await loadMe()
      navigate('/')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="font-mono text-accent text-3xl font-medium tracking-tight">ГОСТ</div>
          <div className="font-mono text-dim text-sm mt-1">система документирования</div>
        </div>

        <div className="card">
          {/* Tabs */}
          <div className="flex border-b border-border -mx-5 -mt-5 mb-6 px-5">
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`pb-3 pt-4 px-1 mr-6 text-sm border-b-2 transition-colors -mb-px ${
                  tab === t ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-text'
                }`}
              >
                {t === 'login' ? 'Войти' : 'Регистрация'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {tab === 'register' && (
              <div>
                <label className="label">Имя</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Иван Иванов" required />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" required />
            </div>
            <div>
              <label className="label">Пароль</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center mt-2">
              {loading ? 'Загрузка...' : tab === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
