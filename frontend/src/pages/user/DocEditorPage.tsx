import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { gostsApi, docsApi, assistantApi, api, type Gost, type DocSection } from '../../api/client'
import { FilePlus, Sparkles, FileDown, Bot, X, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { neuroContext } from '../../store/neuroContext'

interface SubState {
  id: string
  title: string
  description: string
  text: string
}

interface SectionState {
  section: string
  hint: string
  text: string
  subsections: SubState[]
  open: boolean
}

function SubField({
  sub,
  onChange,
  onFocus,
  onImprove,
  isImproving,
}: {
  sub: SubState
  onChange: (v: string) => void
  onFocus: () => void
  onImprove: () => void
  isImproving: boolean
}) {
  return (
    <div className="pl-4 border-l-2 border-accent/20 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-dim">{sub.id} {sub.title}</span>
        <button
          type="button"
          onClick={onImprove}
          disabled={isImproving || !sub.text.trim()}
          className="btn-ghost text-xs px-2 py-0.5 flex items-center gap-1 shrink-0"
        >
          <Sparkles size={10} className={isImproving ? 'animate-pulse text-accent' : ''} />
          {isImproving ? '...' : 'Улучшить'}
        </button>
      </div>
      {sub.description && (
        <div className="text-xs text-muted bg-surface rounded px-2 py-1 leading-relaxed">
          {sub.description.length > 200 ? sub.description.slice(0, 200) + '...' : sub.description}
        </div>
      )}
      <textarea
        className="input resize-none text-sm w-full"
        rows={4}
        value={sub.text}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={`Заполните «${sub.title}»...`}
      />
    </div>
  )
}

function SectionField({
  s,
  onTextChange,
  onSubChange,
  onFocus,
  onSubFocus,
  onImprove,
  onSubImprove,
  improvingKey,
  onToggle,
}: {
  s: SectionState
  onTextChange: (v: string) => void
  onSubChange: (si: number, v: string) => void
  onFocus: () => void
  onSubFocus: (si: number) => void
  onImprove: () => void
  onSubImprove: (si: number) => void
  improvingKey: string | null
  onToggle: () => void
}) {
  const hasSubsections = s.subsections.length > 0

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2">
        {hasSubsections && (
          <button onClick={onToggle} className="text-dim hover:text-text mt-0.5 shrink-0">
            {s.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-accent font-medium">{s.section}</span>
            {!hasSubsections && (
              <button
                type="button"
                onClick={onImprove}
                disabled={improvingKey === s.section || !s.text.trim()}
                className="btn-ghost text-xs px-2 py-1 flex items-center gap-1 shrink-0"
              >
                <Sparkles size={11} className={improvingKey === s.section ? 'animate-pulse text-accent' : ''} />
                {improvingKey === s.section ? 'Улучшаю...' : 'Улучшить'}
              </button>
            )}
          </div>
          {s.hint && !hasSubsections && (
            <div className="text-xs text-dim bg-surface rounded px-2 py-1.5 leading-relaxed border-l-2 border-accent/30 mt-1.5">
              {s.hint.length > 300 ? s.hint.slice(0, 300) + '...' : s.hint}
            </div>
          )}
        </div>
      </div>

      {hasSubsections && s.open && (
        <div className="space-y-4 pt-1">
          {s.subsections.map((sub, si) => (
            <SubField
              key={sub.id}
              sub={sub}
              onChange={v => onSubChange(si, v)}
              onFocus={() => onSubFocus(si)}
              onImprove={() => onSubImprove(si)}
              isImproving={improvingKey === `${s.section}__${si}`}
            />
          ))}
        </div>
      )}

      {!hasSubsections && (
        <textarea
          className="input resize-none text-sm w-full"
          rows={6}
          value={s.text}
          onChange={e => onTextChange(e.target.value)}
          onFocus={onFocus}
          placeholder={`Заполните раздел «${s.section}»...`}
        />
      )}
    </div>
  )
}

export default function DocEditorPage() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [selectedGostId, setSelectedGostId] = useState('')
  const [sections, setSections] = useState<SectionState[]>([])
  const [improvingKey, setImprovingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestion, setSuggestion] = useState<{ gostId: string; gostCode: string; message: string } | null>(null)
  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: gosts = [] } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })
  const selectedGost = (gosts as Gost[]).find(g => g.id === selectedGostId)

  useEffect(() => {
    if (!selectedGost?.meta_schema?.sections?.length) {
      setSections([])
      neuroContext.set({ gostCode: selectedGost?.code ?? '', activeSection: '', sectionText: '' })
      return
    }
    setSections(
      selectedGost.meta_schema.sections.map(s => ({
        section: s.title,
        hint: s.description ?? '',
        text: '',
        open: true,
        subsections: (s.subsections ?? []).map(sub => ({
          id: sub.id,
          title: sub.title,
          description: sub.description ?? '',
          text: '',
        })),
      }))
    )
    neuroContext.set({ gostCode: selectedGost.code, activeSection: '', sectionText: '' })
  }, [selectedGostId])

  useEffect(() => {
    neuroContext.set({ documentTitle: title })
    if (titleDebounce.current) clearTimeout(titleDebounce.current)
    if (title.length < 6 || selectedGostId) return
    titleDebounce.current = setTimeout(async () => {
      try {
        const res = await assistantApi.suggestGost(title)
        if (res.gost_id && res.gost_code && res.message)
          setSuggestion({ gostId: res.gost_id, gostCode: res.gost_code, message: res.message })
      } catch {}
    }, 2000)
    return () => { if (titleDebounce.current) clearTimeout(titleDebounce.current) }
  }, [title, selectedGostId])

  const improveText = async (text: string, hint: string, key: string, onDone: (v: string) => void) => {
    if (!text.trim()) return
    setImprovingKey(key)
    try {
      const resp = await api.post('/chat/improve', { text, question: hint })
      onDone(resp.data.improved)
      toast.success('Текст улучшен')
    } catch {
      toast.error('Ошибка улучшения текста')
    } finally {
      setImprovingKey(null)
    }
  }

  const updateSection = (i: number, patch: Partial<SectionState>) =>
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))

  const updateSub = (i: number, si: number, text: string) =>
    setSections(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      const subs = s.subsections.map((sub, sidx) => sidx === si ? { ...sub, text } : sub)
      return { ...s, subsections: subs }
    }))

  const buildPayload = (): DocSection[] =>
    sections.flatMap(s => {
      if (s.subsections.length > 0) {
        const filled = s.subsections.filter(sub => sub.text.trim())
        if (!filled.length) return []
        const combined = filled.map(sub => `${sub.id} ${sub.title}\n${sub.text}`).join('\n\n')
        return [{ section: s.section, text: combined }]
      }
      return s.text.trim() ? [{ section: s.section, text: s.text }] : []
    })

  const handleSave = async (makePdf = false) => {
    if (!selectedGostId) return toast.error('Выберите ГОСТ')
    if (!title.trim()) return toast.error('Укажите название документа')
    const payload = buildPayload()
    if (!payload.length) return toast.error('Заполните хотя бы один раздел')
    setSaving(true)
    try {
      const doc = await docsApi.createFromTemplate(selectedGostId, title.trim(), payload, makePdf)
      qc.invalidateQueries({ queryKey: ['docs'] })
      toast.success(`Документ «${doc.title}» сформирован!`, { duration: 6000, icon: '📄' })
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">Новый документ</h1>
      <p className="text-sm text-dim mb-6">Выберите стандарт, заполните разделы — нейропомощник поможет при необходимости</p>

      {suggestion && !selectedGostId && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg">
          <Bot size={14} className="text-accent shrink-0" />
          <span className="text-sm text-text flex-1">{suggestion.message}</span>
          <button
            onClick={() => { setSelectedGostId(suggestion.gostId); setSuggestion(null) }}
            className="btn-primary text-xs px-3 py-1.5 shrink-0"
          >
            Применить
          </button>
          <button onClick={() => setSuggestion(null)} className="text-dim hover:text-text shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="card mb-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Название документа</label>
            <input
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Техническое задание на разработку..."
            />
          </div>
          <div>
            <label className="label">ГОСТ / стандарт</label>
            <select className="input" value={selectedGostId} onChange={e => { setSelectedGostId(e.target.value); setSuggestion(null) }}>
              <option value="">Выберите стандарт</option>
              {(gosts as Gost[]).map(g => (
                <option key={g.id} value={g.id}>{g.code} — {g.title}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="space-y-4">
          {sections.map((s, i) => (
            <SectionField
              key={i}
              s={s}
              onToggle={() => updateSection(i, { open: !s.open })}
              onTextChange={text => {
                updateSection(i, { text })
                neuroContext.set({ activeSection: s.section, sectionText: text })
              }}
              onSubChange={(si, text) => {
                updateSub(i, si, text)
                neuroContext.set({ activeSection: `${s.section} / ${s.subsections[si]?.title}`, sectionText: text })
              }}
              onFocus={() => neuroContext.set({ activeSection: s.section, sectionText: s.text })}
              onSubFocus={si => neuroContext.set({ activeSection: `${s.section} / ${s.subsections[si]?.title}`, sectionText: s.subsections[si]?.text })}
              onImprove={() => improveText(s.text, s.hint, s.section, text => updateSection(i, { text }))}
              onSubImprove={si => {
                const sub = s.subsections[si]
                improveText(sub.text, sub.description, `${s.section}__${si}`, text => updateSub(i, si, text))
              }}
              improvingKey={improvingKey}
            />
          ))}

          <div className="flex gap-3 pt-2">
            <button onClick={() => handleSave(false)} disabled={saving} className="btn-primary">
              <FilePlus size={14} />
              {saving ? 'Формирую...' : 'Сформировать DOCX'}
            </button>
            <button onClick={() => handleSave(true)} disabled={saving} className="btn-ghost">
              <FileDown size={14} />
              С конвертацией в PDF
            </button>
          </div>
        </div>
      ) : selectedGostId ? (
        <div className="card text-center py-10 text-dim text-sm">
          У этого ГОСТа нет структуры разделов — добавьте мета-схему в разделе «ГОСТы / Хранилище»
        </div>
      ) : (
        <div className="card text-center py-10 text-dim text-sm">
          Выберите стандарт — появятся разделы для заполнения
        </div>
      )}
    </div>
  )
}
