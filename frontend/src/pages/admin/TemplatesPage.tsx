import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { docTemplatesApi, gostsApi, type Gost } from '../../api/client'
import { FileUp, Trash2, FileText, Loader } from 'lucide-react'
import toast from 'react-hot-toast'

export default function TemplatesPage() {
  const qc = useQueryClient()
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['doc-templates'], queryFn: docTemplatesApi.list })
  const { data: gosts = [] } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })

  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [gostId, setGostId] = useState('')
  const [uploading, setUploading] = useState(false)

  const remove = useMutation({
    mutationFn: (id: string) => docTemplatesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc-templates'] }); toast.success('Шаблон удалён') },
  })

  const handleUpload = async () => {
    if (!file) { toast.error('Выберите .docx файл'); return }
    if (!name.trim()) { toast.error('Укажите название шаблона'); return }
    setUploading(true)
    try {
      await docTemplatesApi.upload(file, name.trim(), '', gostId)
      qc.invalidateQueries({ queryKey: ['doc-templates'] })
      toast.success('Шаблон загружен')
      setFile(null); setName(''); setGostId('')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Не удалось загрузить шаблон')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">Шаблоны</h1>
      <p className="text-sm text-dim mb-6">
        Готовые .docx-бланки документов (ТЗ, руководства, ПМИ и др.) с правильным оформлением.
        При создании документа текст вставляется в шаблон с сохранением его форматирования.
      </p>

      <div className="card mb-6 space-y-4">
        <div className="text-xs font-medium text-dim uppercase tracking-wide">Загрузить шаблон</div>
        <div>
          <label className="label">Название</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Техническое задание" />
        </div>
        <div>
          <label className="label">Привязать к ГОСТу (для подсказок по содержанию)</label>
          <select className="input" value={gostId} onChange={e => setGostId(e.target.value)}>
            <option value="">Не привязан</option>
            {(gosts as Gost[]).map(g => (
              <option key={g.id} value={g.id}>{g.code} — {g.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Файл шаблона (.docx)</label>
          <input type="file" accept=".docx" className="input" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <button onClick={handleUpload} disabled={uploading} className="btn-primary">
          {uploading ? <Loader size={14} className="animate-spin" /> : <FileUp size={14} />}
          {uploading ? 'Загрузка...' : 'Загрузить шаблон'}
        </button>
      </div>

      <div className="space-y-2">
        {isLoading && <div className="text-dim text-sm">Загрузка...</div>}
        {!isLoading && templates.length === 0 && (
          <div className="text-dim text-sm">Пока нет загруженных шаблонов.</div>
        )}
        {templates.map(t => (
          <div key={t.id} className="card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-accent" />
              <div>
                <div className="text-text text-sm font-medium">{t.name}</div>
                <div className="text-xs text-dim">{t.sections_count} разделов</div>
              </div>
            </div>
            <button onClick={() => remove.mutate(t.id)} className="text-dim hover:text-danger p-1" title="Удалить">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
