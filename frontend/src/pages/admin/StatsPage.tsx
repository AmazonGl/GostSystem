import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Users, BookOpen, FileText, LayoutTemplate } from 'lucide-react'

interface Stats {
  counts: { users: number; gosts: number; docs: number; templates: number }
  top_gosts: { code: string; title: string; templates: number }[]
  recent_docs: { title: string }[]
  recent_users: { name: string; email: string; role: string }[]
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="card flex items-center gap-4">
      <div className="p-2 rounded bg-accent/10 border border-accent/20">
        <Icon size={16} className="text-accent" />
      </div>
      <div>
        <div className="text-2xl font-mono font-medium text-text">{value}</div>
        <div className="text-xs text-dim">{label}</div>
      </div>
    </div>
  )
}

export default function StatsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/stats/').then(r => r.data),
    refetchInterval: 30000,
  })

  if (isLoading) return <div className="p-6 text-dim text-sm">Загрузка...</div>
  if (!data) return null

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-medium text-text mb-1">Статистика</h1>
      <p className="text-sm text-dim mb-6">Общая картина по системе</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard icon={Users}          label="Пользователей" value={data.counts.users} />
        <StatCard icon={BookOpen}       label="ГОСТов"        value={data.counts.gosts} />
        <StatCard icon={LayoutTemplate} label="Шаблонов"      value={data.counts.templates} />
        <StatCard icon={FileText}       label="Документов"    value={data.counts.docs} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="text-xs font-mono text-dim uppercase tracking-widest mb-3">Топ ГОСТов по шаблонам</div>
          {data.top_gosts.length === 0
            ? <div className="text-xs text-muted">Нет данных</div>
            : data.top_gosts.map((g, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <span className="font-mono text-xs text-accent w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text font-mono truncate">{g.code}</div>
                  <div className="text-xs text-dim truncate">{g.title}</div>
                </div>
                <span className="tag">{g.templates} шаблонов</span>
              </div>
            ))
          }
        </div>

        <div className="card">
          <div className="text-xs font-mono text-dim uppercase tracking-widest mb-3">Последние пользователи</div>
          {data.recent_users.length === 0
            ? <div className="text-xs text-muted">Нет данных</div>
            : data.recent_users.map((u, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text">{u.name}</div>
                  <div className="text-xs text-dim font-mono truncate">{u.email}</div>
                </div>
                <span className={`tag ${u.role === 'admin' ? 'border-accent/40 text-accent' : ''}`}>{u.role}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}
