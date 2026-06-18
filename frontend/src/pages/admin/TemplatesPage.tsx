import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { templatesApi, type GostTemplate } from '../../api/client'
import { RotateCcw, Save, ChevronDown, ChevronUp, BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'

const SERIES_LABELS: Record<string, string> = {
  '19': 'ГОСТ 19',
  '2': 'ГОСТ 2',
  '34': 'ГОСТ 34',
  other: 'Другое',
}

function TemplateCard({ tmpl }: { tmpl: GostTemplate }) {
  const qc = useQueryClient()
  const [prompt, setPrompt] = useState(tmpl.current_prompt)
  const [expanded, setExpanded] = useState(false)
  const [showDefault, setShowDefault] = useState(false)

  const saveMut = useMutation({
    mutationFn: () => templatesApi.update(tmpl.id, prompt),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('Промпт сохранён') },
    onError: () => toast.error('Ошибка'),
  })
  const resetMut = useMutation({
    mutationFn: () => templatesApi.reset(tmpl.id),
    onSuccess: (data) => {
      setPrompt(data.current_prompt)
      qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Восстановлен исходный промпт')
    },
    onError: () => toast.error('Ошибка'),
  })

  const isModified = prompt !== tmpl.default_prompt
  const series = tmpl.meta_schema?.series ?? 'other'

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-3">
        <BookOpen size={16} className="text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text">{tmpl.gost_code}</div>
          <div className="text-xs text-dim truncate">{tmpl.gost_title}</div>
          <div className="flex gap-2 mt-1">
            <span className="tag text-xs">{tmpl.gost_category.toUpperCase()}</span>
            <span className="tag text-xs">{SERIES_LABELS[series] || series}</span>
            {isModified && <span className="tag text-xs text-accent border-accent/40">изменён</span>}
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-dim hover:text-text">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <>
          {tmpl.meta_schema && (
            <div className="p-3 bg-surface rounded border border-border">
              <div className="text-xs font-mono text-dim uppercase tracking-widest mb-2">Мета-схема</div>
              <div className="space-y-1">
                {tmpl.meta_schema.sections.map(s => (
                  <div key={s.id} className="text-xs text-dim flex gap-2">
                    <span className="text-accent font-mono shrink-0">{s.id}.</span>
                    <span>{s.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label">Промпт (можно редактировать)</label>
              <button
                onClick={() => setShowDefault(!showDefault)}
                className="text-xs text-dim hover:text-text"
              >
                {showDefault ? 'Скрыть оригинал' : 'Показать оригинал'}
              </button>
            </div>
            {showDefault && (
              <pre className="text-xs text-muted font-mono bg-surface rounded p-2 mb-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                {tmpl.default_prompt}
              </pre>
            )}
            <textarea
              className="input resize-none font-mono text-xs"
              rows={10}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="btn-primary">
              <Save size={14} /> Сохранить
            </button>
            <button
              onClick={() => { if (confirm('Вернуть исходный промпт?')) resetMut.mutate() }}
              disabled={resetMut.isPending || !isModified}
              className="btn-ghost"
            >
              <RotateCcw size={14} /> Сбросить
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function TemplatesPage() {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.list,
  })

  const series19 = templates.filter(t => t.meta_schema?.series === '19')
  const series2 = templates.filter(t => t.meta_schema?.series === '2')
  const other = templates.filter(t => !['19', '2'].includes(t.meta_schema?.series ?? ''))

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">Шаблоны по ГОСТу</h1>
      <p className="text-sm text-dim mb-6">
        Промпты для каждого загруженного ГОСТа. Можно настроить под себя и вернуть исходный.
      </p>

      {isLoading ? (
        <div className="text-dim text-sm">Загрузка...</div>
      ) : templates.length === 0 ? (
        <div className="card text-center py-10 text-dim text-sm">
          Шаблоны не созданы. Загрузите ГОСТы в разделе «Хранилище».
        </div>
      ) : (
        <div className="space-y-6">
          {series19.length > 0 && (
            <section>
              <div className="text-xs font-mono text-dim uppercase tracking-widest mb-3">ГОСТ 19 (ЕСПД)</div>
              <div className="space-y-3">{series19.map(t => <TemplateCard key={t.id} tmpl={t} />)}</div>
            </section>
          )}
          {series2.length > 0 && (
            <section>
              <div className="text-xs font-mono text-dim uppercase tracking-widest mb-3">ГОСТ 2 (ЕСКД)</div>
              <div className="space-y-3">{series2.map(t => <TemplateCard key={t.id} tmpl={t} />)}</div>
            </section>
          )}
          {other.length > 0 && (
            <section>
              <div className="text-xs font-mono text-dim uppercase tracking-widest mb-3">Прочие</div>
              <div className="space-y-3">{other.map(t => <TemplateCard key={t.id} tmpl={t} />)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
