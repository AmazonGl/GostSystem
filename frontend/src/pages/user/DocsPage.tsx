import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, docsApi } from '../../api/client'
import { FileDown, FilePlus, Loader, Eye, X, ExternalLink, CheckCircle, Trash2, Pencil, Copy } from 'lucide-react'
import toast from 'react-hot-toast'

// --- helpers ---
async function downloadFile(url: string, filename: string) {
  try {
    const resp = await api.get(url, { responseType: 'blob', params: { _t: Date.now() } })
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

// --- Main page ---
export default function DocsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [previewId, setPreviewId] = useState<string | null>(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['docs'],
    queryFn: () => api.get('/docs/').then(r => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/docs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['docs'] }); toast.success('Удалён') },
  })

  return (
    <div className="p-6 max-w-3xl">
      {previewId && <PreviewModal docId={previewId} onClose={() => setPreviewId(null)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-medium text-text mb-1">Документы</h1>
          <p className="text-sm text-dim">Созданные документы — можно открыть, отредактировать или скачать</p>
        </div>
        <button onClick={() => navigate('/docs/editor')} className="btn-primary">
          <FilePlus size={14} /> Создать документ
        </button>
      </div>

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
                    onClick={() => navigate(`/docs/editor?id=${doc.id}`)}
                    className="btn-ghost text-xs px-2 py-1"
                  >
                    <Pencil size={12} /> Редактировать
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await docsApi.duplicate(doc.id)
                        qc.invalidateQueries({ queryKey: ['docs'] })
                        toast.success('Создана копия документа')
                      } catch (e: any) {
                        toast.error(e?.response?.data?.detail || 'Не удалось дублировать')
                      }
                    }}
                    className="btn-ghost text-xs px-2 py-1"
                  >
                    <Copy size={12} /> Дублировать
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
