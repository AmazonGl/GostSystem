import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { docTemplatesApi, type DocTemplateSection } from '../../api/client'
import { ChevronRight, ChevronDown, FileText, Plus, Trash2, Save, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'

// Узел структуры (рекурсивный)
type Node = { id: string; title: string; subsections?: Node[] }

// Пересчёт номеров по позиции в дереве: 1, 1.1, 1.1.1 ...
function renumber(nodes: Node[], prefix = ''): Node[] {
  return nodes.map((n, i) => {
    const id = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
    return { ...n, id, subsections: renumber(n.subsections ?? [], id) }
  })
}

function NodeEditor({
  node, path, onRename, onRemove, onAddChild,
}: {
  node: Node
  path: number[]
  onRename: (path: number[], title: string) => void
  onRemove: (path: number[]) => void
  onAddChild: (path: number[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(node.title)

  return (
    <div className="pl-3 border-l border-border/50">
      <div className="flex items-center gap-2 py-1 group">
        <span className="text-xs font-mono text-accent/70 shrink-0 w-14">{node.id}</span>
        {editing ? (
          <input
            className="input text-sm py-0.5 flex-1"
            value={val}
            autoFocus
            onChange={e => setVal(e.target.value)}
            onBlur={() => { onRename(path, val.trim() || node.title); setEditing(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onRename(path, val.trim() || node.title); setEditing(false) } }}
          />
        ) : (
          <span className="text-sm text-text flex-1 cursor-pointer" onClick={() => setEditing(true)}>{node.title}</span>
        )}
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} className="text-dim hover:text-accent p-1" title="Переименовать">
            <Pencil size={12} />
          </button>
          <button onClick={() => onAddChild(path)} className="text-dim hover:text-accent p-1" title="Добавить подраздел">
            <Plus size={12} />
          </button>
          <button onClick={() => onRemove(path)} className="text-dim hover:text-danger p-1" title="Удалить">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {(node.subsections ?? []).map((child, i) => (
        <NodeEditor key={i} node={child} path={[...path, i]} onRename={onRename} onRemove={onRemove} onAddChild={onAddChild} />
      ))}
    </div>
  )
}

function TemplateStructure({ id, name, count }: { id: string; name: string; count: number }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: tpl } = useQuery({
    queryKey: ['doc-template', id],
    queryFn: () => docTemplatesApi.get(id),
    enabled: open,
  })
  const [nodes, setNodes] = useState<Node[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (tpl?.structure?.sections) {
      setNodes(tpl.structure.sections as Node[])
      setDirty(false)
    }
  }, [tpl])

  // помощники изменения дерева по пути
  const updateAt = (list: Node[], path: number[], fn: (n: Node) => Node | null): Node[] => {
    const [head, ...rest] = path
    const out: Node[] = []
    list.forEach((n, i) => {
      if (i !== head) { out.push(n); return }
      if (rest.length === 0) {
        const res = fn(n)
        if (res) out.push(res)
      } else {
        out.push({ ...n, subsections: updateAt(n.subsections ?? [], rest, fn) })
      }
    })
    return out
  }

  const onRename = (path: number[], title: string) => {
    setNodes(prev => renumber(updateAt(prev, path, n => ({ ...n, title }))))
    setDirty(true)
  }
  const onRemove = (path: number[]) => {
    setNodes(prev => renumber(updateAt(prev, path, () => null)))
    setDirty(true)
  }
  const onAddChild = (path: number[]) => {
    setNodes(prev => renumber(updateAt(prev, path, n => ({
      ...n, subsections: [...(n.subsections ?? []), { id: '', title: 'Новый подраздел', subsections: [] }],
    }))))
    setDirty(true)
  }
  const onAddSection = () => {
    setNodes(prev => renumber([...prev, { id: '', title: 'Новый раздел', subsections: [] }]))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await docTemplatesApi.updateStructure(id, { sections: nodes as DocTemplateSection[] })
      qc.invalidateQueries({ queryKey: ['doc-template', id] })
      qc.invalidateQueries({ queryKey: ['doc-templates'] })
      toast.success('Структура сохранена')
      setDirty(false)
    } catch {
      toast.error('Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full text-left">
        {open ? <ChevronDown size={16} className="text-dim" /> : <ChevronRight size={16} className="text-dim" />}
        <FileText size={16} className="text-accent" />
        <span className="text-text text-sm font-medium">{name}</span>
        <span className="text-xs text-dim ml-auto">{count} разделов</span>
      </button>
      {open && (
        <div className="mt-3">
          {nodes.length === 0 && <div className="text-xs text-dim pl-3">Структура пуста</div>}
          {nodes.map((n, i) => (
            <NodeEditor key={i} node={n} path={[i]} onRename={onRename} onRemove={onRemove} onAddChild={onAddChild} />
          ))}
          <div className="flex items-center gap-2 mt-3 pl-3">
            <button onClick={onAddSection} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
              <Plus size={12} /> Добавить раздел
            </button>
            {dirty && (
              <button onClick={save} disabled={saving} className="btn-primary text-xs px-3 py-1 flex items-center gap-1">
                <Save size={12} /> {saving ? 'Сохранение...' : 'Сохранить структуру'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StructuresPage() {
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['doc-templates'], queryFn: docTemplatesApi.list })

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">
        Структура документов
      </h1>
      <p className="text-sm text-dim mb-6">
        Разделы и подразделы, разобранные из загруженных шаблонов. Структуру можно отредактировать —
        именно она подставляется при создании документа.
      </p>

      <div className="space-y-2">
        {isLoading && <div className="text-dim text-sm">Загрузка...</div>}
        {!isLoading && templates.length === 0 && (
          <div className="text-dim text-sm">Нет шаблонов. Загрузите их в разделе «Шаблоны».</div>
        )}
        {templates.map(t => (
          <TemplateStructure key={t.id} id={t.id} name={t.name} count={t.sections_count} />
        ))}
      </div>
    </div>
  )
}
