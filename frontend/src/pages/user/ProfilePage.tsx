import { useState } from 'react'
import { useAuth } from '../../store/auth'
import { api } from '../../api/client'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { user, loadMe } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [saving, setSaving] = useState(false)

  const saveName = async () => {
    setSaving(true)
    try {
      await api.put('/users/me', { name })
      await loadMe()
      toast.success('Имя обновлено')
    } catch { toast.error('Ошибка') }
    finally { setSaving(false) }
  }

  const changePassword = async () => {
    setSaving(true)
    try {
      await api.post('/users/me/password', { old_password: oldPwd, new_password: newPwd })
      toast.success('Пароль изменён')
      setOldPwd(''); setNewPwd('')
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Ошибка') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-lg font-medium text-text mb-1">Профиль</h1>
      <p className="text-sm text-dim mb-6">{user?.email}</p>

      <div className="card mb-4 space-y-4">
        <div className="text-xs font-mono text-dim uppercase tracking-widest">Личные данные</div>
        <div>
          <label className="label">Имя</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <button onClick={saveName} disabled={saving} className="btn-primary">Сохранить</button>
      </div>

      <div className="card space-y-4">
        <div className="text-xs font-mono text-dim uppercase tracking-widest">Сменить пароль</div>
        <div>
          <label className="label">Текущий пароль</label>
          <input className="input" type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
        </div>
        <div>
          <label className="label">Новый пароль</label>
          <input className="input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
        </div>
        <button onClick={changePassword} disabled={saving || !oldPwd || !newPwd} className="btn-primary">
          Изменить пароль
        </button>
      </div>
    </div>
  )
}
