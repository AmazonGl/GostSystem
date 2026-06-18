import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { gostsApi, type Gost } from '../../api/client'
import { Upload, Trash2, FileText, File } from 'lucide-react'
import toast from 'react-hot-toast'

export default function GostsPage() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('espd')
  const [folder, setFolder] = useState('/')
  const [uploading, setUploading] = useState(false)

  const { data: gosts = [], isLoading } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })

  const removeMut = useMutation({
    mutationFn: gostsApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gosts'] }); toast.success('Удалён') },
    onError: () => toast.error('Ошибка удаления'),
  })

  const upload = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file || !code || !title) return toast.error('Заполните все поля')
    const form = new FormData()
    form.append('file', file)
    form.append('code', code)
    form.append('title', title)
    form.append('category', category)
    form.append('folder_path', folder)
    setUploading(true)
    try {
      await gostsApi.upload(form)
      qc.invalidateQueries({ queryKey: ['gosts'] })
      toast.success('ГОСТ загружен')
      setCode(''); setTitle(''); if (fileRef.current) fileRef.current.value = ''
    } catch { toast.error('Ошибка загрузки') }
    finally { setUploading(false) }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-medium text-text mb-1">ГОСТы</h1>
      <p className="text-sm text-dim mb-6">Загрузка и управление стандартами</p>

      {/* Upload form */}
      <form onSubmit={upload} className="card mb-6 space-y-4">
        <div className="text-xs font-mono text-dim uppercase tracking-widest mb-2">Загрузить стандарт</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Код стандарта</label>
            <input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="ГОСТ 34.602-2020" />
          </div>
          <div>
            <label className="label">Категория</label>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="espd">ЕСПД</option>
              <option value="eskd">ЕСКД</option>
              <option value="other">Другое</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Название</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Техническое задание на создание АС" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Папка в хранилище</label>
            <input className="input" value={folder} onChange={e => setFolder(e.target.value)} placeholder="/" />
          </div>
          <div>
            <label className="label">Файл (PDF или DOCX)</label>
            <input ref={fileRef} type="file" accept=".pdf,.docx" className="input py-1.5 text-dim file:mr-3 file:btn file:bg-surface file:text-dim file:border-0 file:text-xs" />
          </div>
        </div>
        <button type="submit" disabled={uploading} className="btn-primary">
          <Upload size={14} /> {uploading ? 'Загрузка...' : 'Загрузить'}
        </button>
      </form>

      {/* List */}
      {isLoading ? (
        <div className="text-dim text-sm">Загрузка...</div>
      ) : gosts.length === 0 ? (
        <div className="text-dim text-sm card text-center py-10">Стандарты не загружены</div>
      ) : (
        <div className="space-y-2">
          {gosts.map((g: Gost) => (
            <div key={g.id} className="card flex items-center gap-4 py-3">
              {g.file_type === 'pdf' ? <FileText size={16} className="text-danger shrink-0" /> : <File size={16} className="text-info shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text font-medium truncate">{g.title}</div>
                <div className="text-xs text-dim font-mono">{g.code} · {g.category.toUpperCase()} · {g.folder_path}</div>
              </div>
              <span className="tag">{g.file_type}</span>
              <button onClick={() => removeMut.mutate(g.id)} className="text-dim hover:text-danger transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
