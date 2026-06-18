import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi, api, slowApi, docsApi, type Session, type DocSection } from '../../api/client'
import { FileDown, FilePlus, Loader, Eye, X, ExternalLink, CheckCircle, Trash2, Pencil, Save } from 'lucide-react'
import toast from 'react-hot-toast'

// --- helpers ---
async function downloadFile(url: string, filename: string) {
  try {
    const resp = await api.get(url, { responseType: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([resp.data]))
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  } catch (e: any) {
    toast.error('Ошибка скачивания: ' + (e?.response?.data?.detail || e?.message || 'неизвестно'))
  }
}

function flashTitle(msg: string) {
  const orig = document.title; let n = 0
  const t = setInterval(() => {
    document.title = n++ % 2 === 0 ? `🔔 ${msg}` : orig
    if (n > 20) { clearInterval(t); document.title = orig }
  }, 600)
}

function playSound() {
  try {
    const ctx = new AudioContext()
    ;[0, 0.15, 0.3].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.value = [520, 660, 880][i]
      g.gain.setValueAtTime(0.3, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.12)
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12)
    })
  } catch {}
}

// --- Edit modal ---
function EditDocModal({ docId, docTitle, onClose }: { docId: string; docTitle: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(docTitle)
  const [sections, setSections] = useState<DocSection[]>([])
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['doc-content', docId],
    queryFn: () => docsApi.getContent(docId),
  })

  useEffect(() => {
    if (data?.sections) setSections(data.sections)
    if (data?.title) setTitle(data.title)
  }, [data])

  const save = async () => {
    setSaving(true)
    try {
      await docsApi.updateContent(docId, sections, title)
      qc.invalidateQueries({ queryKey: ['docs'] })
      toast.success('Документ обновлён')
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const updateSection = (idx: number, text: string) => {
    const next = [...sections]
    next[idx] = { ...next[idx], text }
    setSections(next)
  }

  return (
    <div className="fixed inset-0 bg-bg/90 backdrop-blur-sm z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
        <span className="text-sm font-medium text-text">Редактирование документа</span>
        <div className="flex gap-2">
          <button onClick={save} disabled={saving || isLoading} className="btn-primary text-xs">
            <Save size={12} /> {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button onClick={onClose} className="text-dim hover:text-text"><X size={18} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 max-w-3xl mx-auto w-full space-y-4">
        {isLoading ? (
          <div className="text-dim text-sm">Загрузка...</div>
        ) : (
          <>
            <div>
              <label className="label">Название документа</label>
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            {sections.map((s, i) => (
              <div key={i} className="card space-y-2">
                <div className="text-xs font-mono text-accent">{s.section}</div>
                <textarea
                  className="input resize-none text-sm font-serif"
                  rows={8}
                  value={s.text}
                  onChange={e => updateSection(i, e.target.value)}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// --- Preview modal ---
function PreviewModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { data: html, isLoading } = useQuery({
    queryKey: ['preview', docId],
    queryFn: () => api.get(`/docs/${docId}/preview`).then(r => r.data),
  })
  return (
    <div className="fixed inset-0 bg-bg/90 backdrop-blur-sm z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
        <span className="text-sm font-medium text-text">Предпросмотр документа</span>
        <button onClick={onClose} className="text-dim hover:text-text"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto bg-white">
        {isLoading
          ? <div className="flex items-center justify-center h-full text-dim">Загрузка...</div>
          : <iframe srcDoc={html} className="w-full h-full border-0" title="Предпросмотр" />
        }
      </div>
    </div>
  )
}

// --- Progress steps ---
const STEPS = [
  { key: 'answers', label: 'Проверяем ответы' },
  { key: 'writing', label: 'Нейросеть пишет разделы' },
  { key: 'assembling', label: 'Собираем документ' },
  { key: 'done', label: 'Готово!' },
]

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="card border-accent/30 bg-accent/5 space-y-3">
      <div className="text-xs font-mono text-accent uppercase tracking-widest">Генерация документа</div>
      <div className="space-y-2">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-mono transition-all ${
              i < step ? 'bg-success text-bg' :
              i === step ? 'bg-accent text-bg animate-pulse' :
              'bg-surface border border-border text-muted'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`text-sm transition-all ${
              i < step ? 'text-success line-through opacity-60' :
              i === step ? 'text-accent font-medium' :
              'text-muted'
            }`}>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="w-full bg-surface rounded-full h-1.5">
        <div
          className="bg-accent h-1.5 rounded-full transition-all duration-1000"
          style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
        />
      </div>
      <div className="text-xs text-dim font-mono">это может занять 3–7 минут на CPU</div>
    </div>
  )
}

// --- Main page ---
export default function DocsPage() {
  const qc = useQueryClient()
  const [sessionId, setSessionId] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [makePdf, setMakePdf] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [editDoc, setEditDoc] = useState<{ id: string; title: string } | null>(null)
  const [progressStep, setProgressStep] = useState(-1)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['docs'],
    queryFn: () => api.get('/docs/').then(r => r.data),
  })
  const { data: sessions = [] } = useQuery({ queryKey: ['sessions'], queryFn: chatApi.sessions })

  const genMut = useMutation({
    mutationFn: async () => {
      setProgressStep(0)
      await new Promise(r => setTimeout(r, 800))
      setProgressStep(1)
      const result = await slowApi.post('/docs/generate', {
        session_id: sessionId,
        doc_title: docTitle || 'Технический документ',
        make_pdf: makePdf,
      })
      setProgressStep(2)
      await new Promise(r => setTimeout(r, 600))
      setProgressStep(3)
      return result.data
    },
    onSuccess: (doc: any) => {
      qc.invalidateQueries({ queryKey: ['docs'] })
      setTimeout(() => setProgressStep(-1), 2000)
      playSound()
      flashTitle('Документ готов!')
      toast.success(
        `Документ "${doc.title || 'Технический документ'}" готов!` +
        (doc.cloud_docx_link ? ' Загружен на Яндекс Диск.' : ''),
        { duration: 10000, icon: '📄' }
      )
    },
    onError: (e: any) => {
      setProgressStep(-1)
      toast.error(e.response?.data?.detail ?? 'Ошибка генерации')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/docs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['docs'] }); toast.success('Удалён') },
  })

  const filteredSessions = (sessions as Session[]).filter(s => s.roadmap_id)

  return (
    <div className="p-6 max-w-3xl">
      {previewId && <PreviewModal docId={previewId} onClose={() => setPreviewId(null)} />}
      {editDoc && <EditDocModal docId={editDoc.id} docTitle={editDoc.title} onClose={() => setEditDoc(null)} />}

      <h1 className="text-lg font-medium text-text mb-1">Документы</h1>
      <p className="text-sm text-dim mb-6">Генерация DOCX/PDF из заполненных сессий</p>

      {/* Форма генерации */}
      {progressStep < 0 ? (
        <div className="card mb-6 space-y-4">
          <div className="text-xs font-mono text-dim uppercase tracking-widest">Сформировать документ</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Сессия с роадмапом</label>
              <select className="input" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                <option value="">Выберите сессию</option>
                {filteredSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.id.slice(0, 16)}</option>
                ))}
              </select>
              {filteredSessions.length === 0 && (
                <p className="text-xs text-muted mt-1">Нет завершённых сессий с роадмапом</p>
              )}
            </div>
            <div>
              <label className="label">Название документа</label>
              <input className="input" value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="Техническое задание" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={makePdf} onChange={e => setMakePdf(e.target.checked)} />
            Конвертировать в PDF
          </label>
          <button onClick={() => genMut.mutate()} disabled={!sessionId} className="btn-primary">
            <FilePlus size={14} /> Сформировать
          </button>
        </div>
      ) : (
        <div className="mb-6">
          <ProgressBar step={progressStep} />
        </div>
      )}

      {/* Список документов */}
      {isLoading ? (
        <div className="text-dim text-sm">Загрузка...</div>
      ) : docs.length === 0 ? (
        <div className="card text-center py-10 text-dim text-sm">Документы не сгенерированы</div>
      ) : (
        <div className="space-y-2">
          {(docs as any[]).map(doc => (
            <div key={doc.id} className="card space-y-2 py-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text font-medium truncate">
                    {doc.title || 'Технический документ'}
                  </div>
                  <div className="text-xs text-dim font-mono">id: {doc.id.slice(0, 12)}</div>
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                  <button onClick={() => setPreviewId(doc.id)} className="btn-ghost text-xs px-2 py-1">
                    <Eye size={12} /> Просмотр
                  </button>
                  <button
                    onClick={() => setEditDoc({ id: doc.id, title: doc.title || 'Технический документ' })}
                    className="btn-ghost text-xs px-2 py-1"
                  >
                    <Pencil size={12} /> Редактировать
                  </button>
                  {doc.docx_path && (
                    <button
                      onClick={() => downloadFile(`/docs/${doc.id}/download/docx`, `${doc.title || 'document'}.docx`)}
                      className="btn-ghost text-xs px-2 py-1"
                    >
                      <FileDown size={12} /> DOCX
                    </button>
                  )}
                  {doc.docx_path && (
                    <button
                      onClick={() => downloadFile(`/docs/${doc.id}/download/pdf`, `${doc.title || 'document'}.pdf`)}
                      className="btn-ghost text-xs px-2 py-1 text-danger border-danger/40 hover:bg-danger hover:text-white"
                    >
                      <FileDown size={12} /> PDF
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm('Удалить документ?')) deleteMut.mutate(doc.id) }}
                    className="text-dim hover:text-danger transition-colors p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {(doc.cloud_docx_link || doc.cloud_pdf_link) && (
                <div className="flex items-center gap-3 pt-1 border-t border-border">
                  <span className="text-xs text-dim">Яндекс Диск:</span>
                  {doc.cloud_docx_link && (
                    <a href={doc.cloud_docx_link} target="_blank" rel="noreferrer"
                      className="text-xs text-accent hover:underline flex items-center gap-1">
                      <ExternalLink size={11} /> DOCX
                    </a>
                  )}
                  {doc.cloud_pdf_link && (
                    <a href={doc.cloud_pdf_link} target="_blank" rel="noreferrer"
                      className="text-xs text-accent hover:underline flex items-center gap-1">
                      <ExternalLink size={11} /> PDF
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
