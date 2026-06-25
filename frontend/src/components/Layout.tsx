import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { FileText, FolderOpen, LogOut, Shield, Cpu, Users, BarChart2, UserCircle, LayoutTemplate, PenLine, Sun, Moon, FileStack } from 'lucide-react'
import NeuroAssistant from './NeuroAssistant'
import { useQuery } from '@tanstack/react-query'
import { ollamaApi } from '../api/client'
import { useTheme } from '../store/theme'

function NavItem({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <NavLink to={to} end className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all ${
        isActive ? 'bg-accent/10 text-accent border border-accent/20' : 'text-dim hover:text-text hover:bg-card'
      }`
    }>
      <Icon size={15} /><span>{label}</span>
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const { data: ollama } = useQuery({
    queryKey: ['ollama-health'],
    queryFn: ollamaApi.health,
    refetchInterval: 30000,
    enabled: user?.role === 'admin',
  })

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-surface">
        <div className="px-4 py-5 border-b border-border flex items-center justify-between">
          <div>
            <div className="font-mono text-accent text-sm font-medium tracking-tight">ГОСТ</div>
            <div className="font-mono text-dim text-xs">документы</div>
          </div>
          <button
            onClick={toggle}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            className="text-dim hover:text-accent transition-colors p-1.5 rounded hover:bg-card"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="text-[10px] font-mono text-muted uppercase tracking-widest px-2 pb-1 pt-2">Рабочее место</div>
          <NavItem to="/docs/editor" icon={PenLine}       label="Новый документ" />
          <NavItem to="/docs"        icon={FileText}      label="Документы" />
          <NavItem to="/profile"     icon={UserCircle}    label="Профиль" />

          {user?.role === 'admin' && (
            <>
              <div className="text-[10px] font-mono text-muted uppercase tracking-widest px-2 pb-1 pt-4">Администрирование</div>
              <NavItem to="/admin/storage"  icon={FolderOpen} label="Стандарты (ГОСТы)" />
              <NavItem to="/admin/templates" icon={LayoutTemplate} label="Шаблоны" />
              <NavItem to="/admin/structures" icon={FileStack} label="Структура документов" />
              <NavItem to="/admin/users"    icon={Users}      label="Пользователи" />
              <NavItem to="/admin/stats"    icon={BarChart2}  label="Статистика" />
            </>
          )}
        </nav>

        <div className="p-3 border-t border-border space-y-2">
          {user?.role === 'admin' && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Cpu size={12} className={ollama?.status === 'ok' ? 'text-success' : 'text-danger'} />
              <span className="text-xs font-mono text-dim truncate">{ollama?.active_model ?? 'ollama...'}</span>
              <span className={`ml-auto w-1.5 h-1.5 rounded-full ${ollama?.status === 'ok' ? 'bg-success' : 'bg-danger'}`} />
            </div>
          )}
          <div className="flex items-center gap-2 px-2 py-1.5">
            {user?.role === 'admin' && <Shield size={12} className="text-accent shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text truncate">{user?.name}</div>
              <div className="text-[10px] text-dim truncate">{user?.email}</div>
            </div>
            <button onClick={() => { logout(); navigate('/login') }} className="text-dim hover:text-danger transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-bg"><Outlet /></main>
      <NeuroAssistant />
    </div>
  )
}
