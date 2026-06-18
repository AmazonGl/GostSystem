import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { gostsApi, promptsApi, slowApi, type Roadmap, type RoadmapItem } from '../../api/client'
import { Zap, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../api/client'

function RoadmapCard({ rm, onDelete }: { rm: any; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-3 text-left flex-1 min-w-0">
          {open ? <ChevronDown size={14} className="text-dim shrink-0" /> : <ChevronRight size={14} className="text-dim shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text font-medium truncate">
              {rm.name || `Роадмап ${rm.id.slice(0, 8)}`}
            </div>
            <div className="text-xs text-dim font-mono">{rm.structure.length} разделов · id: {rm.id.slice(0, 8)}</div>
          </div>
        </button>
        <button
          onClick={() => onDelete(rm.id)}
          className="text-dim hover:text-danger transition-colors shrink-0 p-1"
          title="Удалить роадмап"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {open && (
        <ol className="mt-4 space-y-4 pl-4 border-l border-border">
          {rm.structure.map((item: RoadmapItem, i: number) => (
            <li key={i} className="space-y-1">
              <div className="text-sm font-medium text-accent">{item.section}</div>
              <div className="text-xs text-dim">{item.description}</div>
              <div className="text-xs text-text/70 font-mono bg-surface rounded px-2 py-1">▸ {item.question}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function RoadmapsPage() {
  const qc = useQueryClient()
  const [gostId, setGostId] = useState('')
  const [promptId, setPromptId] = useState('')
  const [name, setName] = useState('')

  const { data: gosts = [] } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })
  const { data: prompts = [] } = useQuery({ queryKey: ['prompts'], queryFn: promptsApi.list })
  const { data: roadmaps = [], refetch } = useQuery({
    queryKey: ['roadmaps'],
    queryFn: () => api.get('/roadmaps/').then(r => r.data),
  })

  const genMut = useMutation({
    mutationFn: () => slowApi.post('/roadmaps/generate', { gost_id: gostId, prompt_id: promptId, name }).then(r => r.data),
    onSuccess: () => {
      refetch()
      toast.success('Роадмап сгенерирован!')
      setName('')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail ?? 'Ошибка генерации'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/roadmaps/${id}`),
    onSuccess: () => { refetch(); toast.success('Удалён') },
    onError: () => toast.error('Ошибка удаления'),
  })

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">Роадмапы</h1>
      <p className="text-sm text-dim mb-6">Генерация структуры документа через нейронку</p>

      <div className="card mb-6 space-y-4">
        <div className="text-xs font-mono text-dim uppercase tracking-widest">Генератор</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">ГОСТ</label>
            <select className="input" value={gostId} onChange={e => setGostId(e.target.value)}>
              <option value="">Выберите стандарт</option>
              {gosts.map((g: any) => <option key={g.id} value={g.id}>{g.code}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Промпт</label>
            <select className="input" value={promptId} onChange={e => setPromptId(e.target.value)}>
              <option value="">Выберите промпт</option>
              {prompts.map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Название роадмапа (необязательно)</label>
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="например: ТЗ для CRM-системы"
          />
        </div>
        <button onClick={() => genMut.mutate()} disabled={!gostId || !promptId || genMut.isPending} className="btn-primary">
          <Zap size={14} />
          {genMut.isPending ? 'Генерация... (подождите)' : 'Сгенерировать роадмап'}
        </button>
        {genMut.isPending && (
          <div className="text-xs text-dim font-mono animate-pulse">▸ ollama обрабатывает документ...</div>
        )}
      </div>

      <div className="space-y-3">
        {(roadmaps as any[]).map((rm) => (
          <RoadmapCard
            key={rm.id}
            rm={rm}
            onDelete={(id) => {
              if (confirm('Удалить роадмап? Все связанные ответы тоже будут удалены.')) {
                deleteMut.mutate(id)
              }
            }}
          />
        ))}
        {roadmaps.length === 0 && (
          <div className="card text-center py-10 text-dim text-sm">Роадмапы не сгенерированы</div>
        )}
      </div>
    </div>
  )
}
