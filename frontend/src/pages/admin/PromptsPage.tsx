import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { promptsApi, gostsApi, type Prompt, type Gost } from '../../api/client'
import { Plus, Pencil, Trash2, Link, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'

function PromptForm({ initial, onSave, onCancel }: {
  initial?: Prompt
  onSave: (title: string, content: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  return (
    <div className="card space-y-3">
      <div className="text-xs font-mono text-dim uppercase tracking-widest">
        {initial ? 'Редактировать промпт' : 'Новый промпт'}
      </div>
      <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Название промпта" />
      <textarea
        className="input resize-none font-mono text-xs"
        rows={8}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Текст инструкции для нейронки..."
      />
      <div className="flex gap-2">
        <button onClick={() => onSave(title, content)} className="btn-primary"><Check size={14} /> Сохранить</button>
        <button onClick={onCancel} className="btn-ghost"><X size={14} /> Отмена</button>
      </div>
    </div>
  )
}

function BindPanel({ prompt, gosts }: { prompt: Prompt; gosts: Gost[] }) {
  const qc = useQueryClient()
  const bind = useMutation({
    mutationFn: ({ gostId }: { gostId: string }) => promptsApi.bind(prompt.id, gostId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompts'] }); toast.success('Привязан') },
  })
  const [open, setOpen] = useState(false)
  if (!open) return (
    <button onClick={() => setOpen(true)} className="btn-ghost text-xs"><Link size={12} /> Привязать к ГОСТу</button>
  )
  return (
    <div className="mt-3 p-3 bg-surface rounded border border-border space-y-2">
      <div className="text-xs text-dim">Выберите ГОСТ:</div>
      {gosts.map(g => (
        <button key={g.id} onClick={() => { bind.mutate({ gostId: g.id }); setOpen(false) }}
          className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-card text-dim hover:text-text transition-colors font-mono">
          {g.code}
        </button>
      ))}
      <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-dim">Закрыть</button>
    </div>
  )
}

export default function PromptsPage() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const { data: prompts = [] } = useQuery({ queryKey: ['prompts'], queryFn: promptsApi.list })
  const { data: gosts = [] } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })

  const createMut = useMutation({
    mutationFn: ({ title, content }: { title: string; content: string }) => promptsApi.create(title, content),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompts'] }); setCreating(false); toast.success('Создан') },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, title, content }: { id: string; title: string; content: string }) => promptsApi.update(id, title, content),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompts'] }); setEditing(null); toast.success('Сохранён') },
  })
  const removeMut = useMutation({
    mutationFn: promptsApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prompts'] }); toast.success('Удалён') },
  })

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-medium text-text mb-1">Промпты</h1>
          <p className="text-sm text-dim">Инструкции для нейронки + привязка к ГОСТам</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus size={14} /> Новый промпт
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-4">
          <PromptForm
            onSave={(title, content) => createMut.mutate({ title, content })}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div className="space-y-3">
        {prompts.map((p: Prompt) => (
          <div key={p.id} className="card">
            {editing === p.id ? (
              <PromptForm
                initial={p}
                onSave={(title, content) => updateMut.mutate({ id: p.id, title, content })}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text text-sm">{p.title}</div>
                    <pre className="text-xs text-dim mt-2 whitespace-pre-wrap font-mono bg-surface rounded p-3 max-h-32 overflow-y-auto">
                      {p.content}
                    </pre>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditing(p.id)} className="text-dim hover:text-text transition-colors p-1">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => removeMut.mutate(p.id)} className="text-dim hover:text-danger transition-colors p-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <BindPanel prompt={p} gosts={gosts} />
              </>
            )}
          </div>
        ))}
        {prompts.length === 0 && !creating && (
          <div className="card text-center py-10 text-dim text-sm">Промпты не созданы</div>
        )}
      </div>
    </div>
  )
}
