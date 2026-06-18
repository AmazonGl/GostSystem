import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { storageApi, gostsApi, type Gost, type GostMetaSchema, type StorageNode } from '../../api/client'
import {
  Folder, FolderOpen, File, Plus, Trash2, ChevronRight, ChevronDown,
  Upload, Eye, FileText, RefreshCw, X, Save, Layers,
} from 'lucide-react'
import toast from 'react-hot-toast'

const SERIES_LABELS: Record<string, string> = {
  '19': 'ГОСТ 19 (ЕСПД)',
  '2': 'ГОСТ 2 (ЕСКД)',
  '34': 'ГОСТ 34',
  other: 'Другое',
}

function TreeNode({ node, onDelete }: { node: StorageNode; onDelete: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const isFolder = node.type === 'folder'
  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded text-sm hover:bg-card cursor-pointer group transition-colors"
        onClick={() => isFolder && setOpen(!open)}
      >
        {isFolder
          ? open ? <ChevronDown size={12} className="text-dim" /> : <ChevronRight size={12} className="text-dim" />
          : <span className="w-3" />}
        {isFolder
          ? open ? <FolderOpen size={14} className="text-accent" /> : <Folder size={14} className="text-accent" />
          : <File size={14} className="text-dim" />}
        <span className={isFolder ? 'text-text' : 'text-dim font-mono text-xs'}>{node.name}</span>
        {isFolder && (
          <button
            onClick={e => { e.stopPropagation(); if (confirm('Удалить папку?')) onDelete(node.path) }}
            className="ml-auto opacity-0 group-hover:opacity-100 text-dim hover:text-danger transition-all"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {isFolder && open && node.children && (
        <div className="pl-5 border-l border-border ml-4">
          {node.children.length === 0
            ? <div className="text-xs text-muted py-1 px-3">Пусто</div>
            : node.children.map(child => <TreeNode key={child.path} node={child} onDelete={onDelete} />)
          }
        </div>
      )}
    </div>
  )
}

function MetaSchemaEditor({ meta, onChange }: { meta: GostMetaSchema; onChange: (m: GostMetaSchema) => void }) {
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({})

  const updateSection = (idx: number, field: string, value: string | boolean) => {
    const sections = [...meta.sections]
    sections[idx] = { ...sections[idx], [field]: value }
    onChange({ ...meta, sections })
  }

  const toggleSection = (idx: number) =>
    setOpenSections(prev => ({ ...prev, [idx]: !prev[idx] }))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-mono text-accent">
        <Layers size={12} />
        Серия: {SERIES_LABELS[meta.series] || meta.series}
      </div>
      {meta.sections.map((s, i) => {
        const hasSubs = (s.subsections?.length ?? 0) > 0
        const isOpen = openSections[i] ?? false
        return (
          <div key={s.id} className="p-3 bg-surface rounded border border-border space-y-2">
            <div className="flex items-center gap-2">
              {hasSubs && (
                <button onClick={() => toggleSection(i)} className="text-dim hover:text-text">
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              )}
              <span className="tag text-xs">{s.id}</span>
              <span className="text-sm text-text font-medium">{s.title}</span>
              <span className="tag text-xs ml-auto">{s.type}</span>
            </div>
            <input
              className="input text-xs"
              value={s.description}
              onChange={e => updateSection(i, 'description', e.target.value)}
              placeholder="Описание раздела"
            />
            <div className="text-xs text-dim">Поля: {s.fields.join(', ')}</div>
            {hasSubs && isOpen && (
              <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-accent/20">
                {s.subsections!.map(sub => (
                  <div key={sub.id} className="text-xs space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-accent/70">{sub.id}</span>
                      <span className="text-dim font-medium">{sub.title}</span>
                    </div>
                    {sub.description && (
                      <div className="text-muted leading-relaxed pl-4">
                        {sub.description.length > 150 ? sub.description.slice(0, 150) + '...' : sub.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {hasSubs && !isOpen && (
              <div className="text-xs text-dim pl-1">
                {s.subsections!.length} подпункт{s.subsections!.length === 1 ? '' : s.subsections!.length < 5 ? 'а' : 'ов'}
                {' '}· нажмите ▸ для просмотра
              </div>
            )}
          </div>
        )
      })}
      <div className="text-xs text-dim">
        <div className="font-mono uppercase tracking-widest mb-1">Подсказки для промпта</div>
        <ul className="list-disc pl-4 space-y-0.5">
          {meta.prompt_hints.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      </div>
    </div>
  )
}

function GostDetailPanel({ gost, onClose }: { gost: Gost; onClose: () => void }) {
  const qc = useQueryClient()
  const [meta, setMeta] = useState<GostMetaSchema | null>(gost.meta_schema ?? null)

  const saveMeta = useMutation({
    mutationFn: () => gostsApi.updateMeta(gost.id, meta!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gosts'] }); toast.success('Мета сохранена') },
    onError: () => toast.error('Ошибка сохранения'),
  })
  const regenMeta = useMutation({
    mutationFn: () => gostsApi.regenerateMeta(gost.id),
    onSuccess: (data: any) => {
      setMeta(data.meta_schema)
      qc.invalidateQueries({ queryKey: ['gosts'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Мета и промпт перегенерированы')
    },
    onError: () => toast.error('Ошибка генерации'),
  })

  return (
    <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-40 flex justify-end">
      <div className="w-full max-w-lg bg-surface border-l border-border h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface">
          <div>
            <div className="text-sm font-medium text-text">{gost.code}</div>
            <div className="text-xs text-dim">{gost.title}</div>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          <div className="flex gap-2">
            <a href={gostsApi.previewUrl(gost.id)} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
              <Eye size={12} /> Просмотр файла
            </a>
            <button
              onClick={() => regenMeta.mutate()}
              disabled={regenMeta.isPending}
              className="btn-ghost text-xs"
            >
              <RefreshCw size={12} className={regenMeta.isPending ? 'animate-spin' : ''} />
              Перегенерировать мета
            </button>
          </div>

          {meta ? (
            <>
              <MetaSchemaEditor meta={meta} onChange={setMeta} />
              <button
                onClick={() => saveMeta.mutate()}
                disabled={saveMeta.isPending}
                className="btn-primary w-full"
              >
                <Save size={14} /> Сохранить мета-схему
              </button>
            </>
          ) : (
            <div className="card text-center py-6 text-dim text-sm">
              Мета-информация не создана.
              <button onClick={() => regenMeta.mutate()} className="btn-primary mt-3 mx-auto">
                <RefreshCw size={14} /> Сгенерировать
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StoragePage() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [newFolder, setNewFolder] = useState('')
  const [filter, setFilter] = useState<'all' | '19' | '2'>('all')
  const [selectedGost, setSelectedGost] = useState<Gost | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('espd')
  const [folder, setFolder] = useState('/')

  const { data: tree, isLoading: treeLoading } = useQuery({ queryKey: ['storage-tree'], queryFn: storageApi.tree })
  const { data: gosts = [], isLoading: gostsLoading } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })

  const mkdirMut = useMutation({
    mutationFn: (path: string) => storageApi.mkdir(path),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['storage-tree'] }); setNewFolder(''); toast.success('Папка создана') },
  })
  const rmdirMut = useMutation({
    mutationFn: (path: string) => storageApi.rmdir(path),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['storage-tree'] }); toast.success('Удалено') },
  })
  const removeMut = useMutation({
    mutationFn: gostsApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gosts'] }); qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('ГОСТ удалён') },
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
    form.append('auto_meta', 'true')
    setUploading(true)
    try {
      await gostsApi.upload(form)
      qc.invalidateQueries({ queryKey: ['gosts'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['storage-tree'] })
      toast.success('ГОСТ загружен с мета-информацией')
      setCode(''); setTitle(''); setShowUpload(false)
      if (fileRef.current) fileRef.current.value = ''
    } catch { toast.error('Ошибка загрузки') }
    finally { setUploading(false) }
  }

  const filtered = gosts.filter(g => {
    if (filter === 'all') return true
    const series = g.meta_schema?.series ?? (g.code.includes('19') ? '19' : g.code.match(/гост\s*2/i) ? '2' : '')
    return series === filter
  })

  return (
    <div className="p-6 max-w-5xl">
      {selectedGost && <GostDetailPanel gost={selectedGost} onClose={() => setSelectedGost(null)} />}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-lg font-medium text-text mb-1">Хранилище</h1>
          <p className="text-sm text-dim">ГОСТы с мета-информацией для промптов · папки · просмотр</p>
        </div>
        <button onClick={() => setShowUpload(!showUpload)} className="btn-primary">
          <Upload size={14} /> Загрузить ГОСТ
        </button>
      </div>

      {showUpload && (
        <form onSubmit={upload} className="card mb-6 space-y-4">
          <div className="text-xs font-mono text-dim uppercase tracking-widest">Загрузить стандарт</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Код стандарта</label>
              <input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="ГОСТ 19.201-78" />
            </div>
            <div>
              <label className="label">Категория</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="espd">ЕСПД (ГОСТ 19)</option>
                <option value="eskd">ЕСКД (ГОСТ 2)</option>
                <option value="other">Другое</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Название</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Единая система программной документации" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Папка</label>
              <input className="input font-mono text-sm" value={folder} onChange={e => setFolder(e.target.value)} placeholder="/ЕСПД" />
            </div>
            <div>
              <label className="label">Файл (PDF / DOCX)</label>
              <input ref={fileRef} type="file" accept=".pdf,.docx" className="input py-1.5 text-dim file:mr-3 file:text-xs" />
            </div>
          </div>
          <p className="text-xs text-dim">При загрузке автоматически создаётся схематичная мета-информация и шаблон промпта</p>
          <button type="submit" disabled={uploading} className="btn-primary">
            {uploading ? 'Загрузка...' : 'Загрузить'}
          </button>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', '19', '2'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              filter === f ? 'border-accent text-accent bg-accent/10' : 'border-border text-dim hover:text-text'
            }`}
          >
            {f === 'all' ? 'Все' : SERIES_LABELS[f]}
          </button>
        ))}
      </div>

      {/* GOST list */}
      <div className="card mb-6">
        <div className="text-xs font-mono text-dim uppercase tracking-widest mb-3">Документы ГОСТ</div>
        {gostsLoading ? (
          <div className="text-dim text-sm">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="text-dim text-sm py-4 text-center">ГОСТы не загружены</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(g => (
              <div key={g.id} className="flex items-center gap-3 p-2 rounded hover:bg-card group transition-colors">
                {g.file_type === 'pdf'
                  ? <FileText size={16} className="text-danger shrink-0" />
                  : <File size={16} className="text-info shrink-0" />}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedGost(g)}>
                  <div className="text-sm text-text font-medium truncate">{g.title}</div>
                  <div className="text-xs text-dim font-mono">
                    {g.code} · {g.category.toUpperCase()}
                    {g.meta_schema && <span className="text-accent ml-2">· {SERIES_LABELS[g.meta_schema.series] || g.meta_schema.series}</span>}
                    {g.has_template && <span className="text-success ml-2">· шаблон ✓</span>}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={gostsApi.previewUrl(g.id)} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-2 py-1">
                    <Eye size={12} />
                  </a>
                  <button onClick={() => setSelectedGost(g)} className="btn-ghost text-xs px-2 py-1">
                    <Layers size={12} />
                  </button>
                  <button
                    onClick={() => { if (confirm('Удалить ГОСТ и шаблон?')) removeMut.mutate(g.id) }}
                    className="text-dim hover:text-danger p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Folder tree */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3 text-xs font-mono text-dim uppercase tracking-widest">
          <Folder size={12} /> Структура папок
        </div>
        <div className="flex gap-3 items-end mb-4">
          <div className="flex-1">
            <input className="input font-mono text-sm" value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="/ЕСПД/19-серия" />
          </div>
          <button onClick={() => mkdirMut.mutate(newFolder)} disabled={!newFolder} className="btn-primary shrink-0">
            <Plus size={14} /> Папка
          </button>
        </div>
        {treeLoading ? (
          <div className="text-dim text-sm">Загрузка...</div>
        ) : tree?.children?.length === 0 ? (
          <div className="text-dim text-sm">Пусто</div>
        ) : (
          tree?.children?.map(node => (
            <TreeNode key={node.path} node={node} onDelete={p => rmdirMut.mutate(p)} />
          ))
        )}
      </div>
    </div>
  )
}
