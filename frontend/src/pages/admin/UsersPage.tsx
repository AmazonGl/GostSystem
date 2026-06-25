import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Shield, User, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../store/auth'

interface UserItem { id: string; email: string; name: string; role: string }

export default function UsersPage() {
  const qc = useQueryClient()
  const { user: me } = useAuth()

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UserItem[]>('/users/').then(r => r.data),
  })

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.put(`/users/${id}/role`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Роль обновлена') },
    onError: () => toast.error('Ошибка'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Удалён') },
    onError: () => toast.error('Ошибка'),
  })

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">Пользователи</h1>
      <p className="text-sm text-dim mb-6">Управление доступом</p>

      <div className="space-y-2">
        {users.map((u: UserItem) => (
          <div key={u.id} className="card flex items-center gap-4 py-3">
            {u.role === 'admin'
              ? <Shield size={15} className="text-accent shrink-0" />
              : <User size={15} className="text-dim shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text">{u.name}</div>
              <div className="text-xs text-dim font-mono">{u.email}</div>
            </div>
            <select
              className="input w-28 text-xs"
              value={u.role}
              disabled={u.id === me?.id}
              onChange={e => roleMut.mutate({ id: u.id, role: e.target.value })}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            {u.id !== me?.id && (
              <button onClick={() => deleteMut.mutate(u.id)} className="text-dim hover:text-danger transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {users.length === 0 && (
          <div className="card text-center py-10 text-dim text-sm">Нет пользователей</div>
        )}
      </div>
    </div>
  )
}
