import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { gostsApi, docsApi, docTemplatesApi, api, type Gost, type DocSection, type DocFormat, type TitlePageData } from '../../api/client'
import { FilePlus, Sparkles, FileDown, ChevronDown, ChevronRight, Save, Trash2, ChevronUp, Plus, Layers, Image } from 'lucide-react'
import toast from 'react-hot-toast'
import { neuroContext } from '../../store/neuroContext'

// Разбирает текст с подзаголовками "## / ### / ####" обратно во вложенное дерево узлов.
// Уровень = число символов '#'. Номера (id) берутся из заголовка, если есть.
function parseSubsections(text: string, sectionIndex: number): NodeState[] {
  if (!text || !text.includes('#')) return []
  const lines = text.split('\n')
  type Item = { level: number; title: string; id: string; body: string }
  const items: Item[] = []
  let cur: Item | null = null
  for (const line of lines) {
    const hm = line.match(/^(#{2,6})\s+(.*)$/)
    if (hm) {
      const level = hm[1].length          // ## -> 2, ### -> 3 ...
      const rest = hm[2].trim()
      const m = rest.match(/^(\d+(?:\.\d+)*)\s+(.*)$/)
      cur = { level, id: m ? m[1] : '', title: (m ? m[2] : rest) || 'Подраздел', body: '' }
      items.push(cur)
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line
    }
  }
  // строим дерево по уровням
  const root: NodeState = freshNode('', '')
  const stack: { level: number; node: NodeState }[] = [{ level: 1, node: root }]
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1].node : root
    const { clean, images } = extractImages(it.body.trim())
    const idx = parent.subsections.length + 1
    const id = it.id || (parent.id ? `${parent.id}.${idx}` : `${sectionIndex + 1}.${idx}`)
    const node: NodeState = { id, title: it.title, description: '', text: clean, images, subsections: [] }
    parent.subsections.push(node)
    stack.push({ level: it.level, node })
  }
  return root.subsections
}

// Извлекает маркеры [[IMG:путь|подпись]] из текста в массив картинок, возвращает очищенный текст
function extractImages(text: string): { clean: string; images: DocImage[] } {
  const images: DocImage[] = []
  const clean = (text || '').replace(/\[\[IMG:(.+?)\|(.*?)\]\]/g, (_m, path, caption) => {
    images.push({ path: path.trim(), caption: (caption || '').trim() })
    return ''
  }).replace(/\n{3,}/g, '\n\n').trim()
  return { clean, images }
}

// Выбирает и загружает картинку, возвращает объект DocImage с превью
async function pickImage(): Promise<DocImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      try {
        const { path } = await docsApi.uploadImage(file)
        const preview = await new Promise<string>((res) => {
          const reader = new FileReader()
          reader.onload = () => res(reader.result as string)
          reader.readAsDataURL(file)
        })
        resolve({ path, caption: '', preview })
      } catch (e: any) {
        toast.error('Не удалось загрузить картинку: ' + (e?.response?.data?.detail || 'ошибка'))
        resolve(null)
      }
    }
    input.click()
  })
}

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

interface DocImage {
  path: string
  caption: string
  preview?: string  // data URL для показа в форме
}

interface NodeState {
  id: string
  title: string
  description: string
  text: string
  images: DocImage[]
  subsections: NodeState[]
}
type SubState = NodeState

interface SectionState {
  section: string
  hint: string
  text: string
  subsections: NodeState[]
  images: DocImage[]
  open: boolean
}

// ---- Immutable-операции над деревом узлов по пути (массив индексов) ----
function nodeAt(nodes: NodeState[], path: number[]): NodeState | null {
  let cur: NodeState | undefined = nodes[path[0]]
  for (let i = 1; i < path.length && cur; i++) cur = cur.subsections[path[i]]
  return cur ?? null
}
function updateNode(nodes: NodeState[], path: number[], fn: (n: NodeState) => NodeState): NodeState[] {
  const [head, ...rest] = path
  return nodes.map((n, i) => {
    if (i !== head) return n
    if (rest.length === 0) return fn(n)
    return { ...n, subsections: updateNode(n.subsections, rest, fn) }
  })
}
function removeNode(nodes: NodeState[], path: number[]): NodeState[] {
  const [head, ...rest] = path
  if (rest.length === 0) return nodes.filter((_, i) => i !== head)
  return nodes.map((n, i) => i === head ? { ...n, subsections: removeNode(n.subsections, rest) } : n)
}
function moveNode(nodes: NodeState[], path: number[], dir: -1 | 1): NodeState[] {
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  const swap = (arr: NodeState[]): NodeState[] => {
    const t = idx + dir
    if (t < 0 || t >= arr.length) return arr
    const copy = [...arr]
    ;[copy[idx], copy[t]] = [copy[t], copy[idx]]
    return copy
  }
  if (parentPath.length === 0) return swap(nodes)
  return updateNode(nodes, parentPath, p => ({ ...p, subsections: swap(p.subsections) }))
}
function addChild(nodes: NodeState[], path: number[], child: NodeState): NodeState[] {
  if (path.length === 0) return [...nodes, child]
  return updateNode(nodes, path, p => ({ ...p, subsections: [...p.subsections, child] }))
}
function freshNode(id: string, title = 'Новый подраздел'): NodeState {
  return { id, title, description: '', text: '', images: [], subsections: [] }
}

// Красивая галерея картинок с превью и подписью
function ImageGallery({
  images, onCaption, onRemove,
}: {
  images: DocImage[]
  onCaption: (idx: number, v: string) => void
  onRemove: (idx: number) => void
}) {
  if (!images.length) return null
  return (
    <div className="grid grid-cols-2 gap-3 pt-1">
      {images.map((im, k) => (
        <div key={k} className="card bg-surface p-2 space-y-2 relative group">
          <button
            onClick={() => onRemove(k)}
            className="absolute top-3 right-3 bg-bg/80 text-dim hover:text-danger rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            title="Удалить картинку"
          >
            <Trash2 size={14} />
          </button>
          <div className="rounded overflow-hidden bg-bg/40 flex items-center justify-center" style={{ minHeight: 90 }}>
            {im.preview
              ? <img src={im.preview} alt="" className="max-h-40 w-auto object-contain" />
              : <div className="text-dim text-xs py-6 flex flex-col items-center gap-1"><Image size={20} /> загружено</div>}
          </div>
          <input
            className="input text-xs py-1"
            value={im.caption}
            placeholder="Название рисунка"
            onChange={e => onCaption(k, e.target.value)}
          />
        </div>
      ))}
    </div>
  )
}

// Рекурсивная карточка узла (раздел/подраздел любой глубины). Работает по пути (массив индексов).
function NodeCard({
  node, path, total, depth,
  onChange, onFocus, onImprove, onRename, onRemove, onMove,
  onAddChild, onAddImage, onCaptionImage, onRemoveImage,
  improvingKey,
}: {
  node: NodeState
  path: number[]
  total: number
  depth: number
  onChange: (path: number[], v: string) => void
  onFocus: (path: number[]) => void
  onImprove: (path: number[]) => void
  onRename: (path: number[], v: string) => void
  onRemove: (path: number[]) => void
  onMove: (path: number[], dir: -1 | 1) => void
  onAddChild: (path: number[]) => void
  onAddImage: (path: number[]) => void
  onCaptionImage: (path: number[], idx: number, v: string) => void
  onRemoveImage: (path: number[], idx: number) => void
  improvingKey: string | null
}) {
  const index = path[path.length - 1]
  const hasChildren = node.subsections.length > 0
  const key = path.join('-')
  return (
    <div className="pl-4 border-l-2 border-accent/20 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-dim shrink-0">{node.id}</span>
        <input
          className="input text-sm flex-1 py-1"
          value={node.title}
          placeholder="Название подраздела"
          onChange={e => onRename(path, e.target.value)}
        />
        <div className="flex gap-0.5 shrink-0">
          <button onClick={() => onMove(path, -1)} disabled={index === 0}
            className="text-dim hover:text-text disabled:opacity-30 p-1" title="Вверх">
            <ChevronUp size={13} />
          </button>
          <button onClick={() => onMove(path, 1)} disabled={index === total - 1}
            className="text-dim hover:text-text disabled:opacity-30 p-1" title="Вниз">
            <ChevronDown size={13} />
          </button>
          <button onClick={() => onRemove(path)}
            className="text-dim hover:text-danger p-1" title="Удалить">
            <Trash2 size={13} />
          </button>
          <button type="button" onClick={() => onImprove(path)}
            disabled={improvingKey === key || !node.text.trim()}
            className="text-dim hover:text-accent disabled:opacity-30 p-1"
            title="Улучшить нейропомощником">
            <Sparkles size={12} className={improvingKey === key ? 'animate-pulse text-accent' : ''} />
          </button>
        </div>
      </div>
      {node.description && (
        <HintBox text={node.description} limit={200} />
      )}
      {/* Поле текста показываем только у листьев (без детей) */}
      {!hasChildren && (
        <>
          <textarea
            className="input resize-none text-sm w-full"
            rows={4}
            value={node.text}
            onChange={e => onChange(path, e.target.value)}
            onFocus={() => onFocus(path)}
            placeholder={node.description ? `Что писать: ${node.description.slice(0, 160)}` : `Заполните «${node.title}»...`}
          />
          <button onClick={() => onAddImage(path)} className="btn-ghost text-xs px-2 py-1">
            <Image size={11} /> Добавить картинку
          </button>
          <ImageGallery images={node.images} onCaption={(idx, v) => onCaptionImage(path, idx, v)} onRemove={idx => onRemoveImage(path, idx)} />
        </>
      )}
      {hasChildren && (
        <div className="space-y-3 pt-1">
          {node.subsections.map((child, ci) => (
            <NodeCard
              key={child.id}
              node={child}
              path={[...path, ci]}
              total={node.subsections.length}
              depth={depth + 1}
              onChange={onChange} onFocus={onFocus} onImprove={onImprove}
              onRename={onRename} onRemove={onRemove} onMove={onMove}
              onAddChild={onAddChild} onAddImage={onAddImage}
              onCaptionImage={onCaptionImage} onRemoveImage={onRemoveImage}
              improvingKey={improvingKey}
            />
          ))}
        </div>
      )}
      {depth < 4 && (
        <button onClick={() => onAddChild(path)} className="btn-ghost text-xs px-2 py-1">
          <Plus size={11} /> Добавить вложенный подраздел
        </button>
      )}
    </div>
  )
}

// Раскрывающаяся подсказка-описание раздела/подраздела.
// Продолжение пункта скрыто по умолчанию; раскрывается по «Показать больше».
function HintBox({ text }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <div className="text-xs text-dim leading-relaxed mt-1.5">
      {open && <span className="whitespace-pre-line">{text} </span>}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-dim hover:text-text underline underline-offset-2"
      >
        {open ? 'Свернуть' : 'Показать больше'}
      </button>
    </div>
  )
}

function SectionField({
  s, index, total,
  onTextChange, onFocus, onImprove, improvingKey,
  onToggle, onRename, onAddAfter, onRemove, onMove, onConvertToSubs,
  onAddImage, onCaptionImage, onRemoveImage,
  // операции над деревом подразделов по пути (path относительно этой секции)
  onNodeChange, onNodeFocus, onNodeImprove, onNodeRename, onNodeRemove, onNodeMove, onNodeAddChild,
  onNodeAddImage, onNodeCaptionImage, onNodeRemoveImage,
}: {
  s: SectionState
  index: number
  total: number
  onTextChange: (v: string) => void
  onFocus: () => void
  onImprove: () => void
  improvingKey: string | null
  onToggle: () => void
  onRename: (v: string) => void
  onAddAfter: () => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onConvertToSubs: () => void
  onAddImage: () => void
  onCaptionImage: (idx: number, v: string) => void
  onRemoveImage: (idx: number) => void
  onNodeChange: (path: number[], v: string) => void
  onNodeFocus: (path: number[]) => void
  onNodeImprove: (path: number[]) => void
  onNodeRename: (path: number[], v: string) => void
  onNodeRemove: (path: number[]) => void
  onNodeMove: (path: number[], dir: -1 | 1) => void
  onNodeAddChild: (path: number[]) => void
  onNodeAddImage: (path: number[]) => void
  onNodeCaptionImage: (path: number[], idx: number, v: string) => void
  onNodeRemoveImage: (path: number[], idx: number) => void
}) {
  const hasSubsections = s.subsections.length > 0

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2">
        {hasSubsections && (
          <button onClick={onToggle} className="text-dim hover:text-text mt-2 shrink-0">
            {s.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-dim shrink-0">{index + 1}.</span>
            <input
              className="input text-sm font-medium flex-1 py-1.5"
              value={s.section}
              placeholder="Название раздела"
              onChange={e => onRename(e.target.value)}
            />
            <div className="flex gap-0.5 shrink-0">
              <button onClick={() => onMove(-1)} disabled={index === 0}
                className="text-dim hover:text-text disabled:opacity-30 p-1" title="Вверх">
                <ChevronUp size={14} />
              </button>
              <button onClick={() => onMove(1)} disabled={index === total - 1}
                className="text-dim hover:text-text disabled:opacity-30 p-1" title="Вниз">
                <ChevronDown size={14} />
              </button>
              <button onClick={onRemove}
                className="text-dim hover:text-danger p-1" title="Удалить раздел">
                <Trash2 size={14} />
              </button>
              {!hasSubsections && (
                <button type="button" onClick={onImprove}
                  disabled={improvingKey === s.section || !s.text.trim()}
                  className="text-dim hover:text-accent disabled:opacity-30 p-1"
                  title="Улучшить нейропомощником">
                  <Sparkles size={13} className={improvingKey === s.section ? 'animate-pulse text-accent' : ''} />
                </button>
              )}
            </div>
          </div>
          {s.hint && !hasSubsections && (
            <HintBox text={s.hint} limit={300} />
          )}
        </div>
      </div>

      {hasSubsections && s.open && (
        <div className="space-y-4 pt-1">
          {s.subsections.map((sub, si) => (
            <NodeCard
              key={sub.id}
              node={sub}
              path={[si]}
              total={s.subsections.length}
              depth={2}
              onChange={onNodeChange} onFocus={onNodeFocus} onImprove={onNodeImprove}
              onRename={onNodeRename} onRemove={onNodeRemove} onMove={onNodeMove}
              onAddChild={onNodeAddChild} onAddImage={onNodeAddImage}
              onCaptionImage={onNodeCaptionImage} onRemoveImage={onNodeRemoveImage}
              improvingKey={improvingKey}
            />
          ))}
          <button onClick={() => onNodeAddChild([])} className="btn-ghost text-xs px-2 py-1 ml-4">
            <Plus size={12} /> Добавить подраздел
          </button>
        </div>
      )}

      {!hasSubsections && (
        <>
          <textarea
            className="input resize-none text-sm w-full"
            rows={6}
            value={s.text}
            onChange={e => onTextChange(e.target.value)}
            onFocus={onFocus}
            placeholder={s.hint ? `Что писать: ${s.hint.slice(0, 160)}` : `Заполните раздел «${s.section}»...`}
          />
          <div className="flex gap-2">
            <button onClick={onConvertToSubs} className="btn-ghost text-xs px-2 py-1">
              <Layers size={12} /> Разбить на подразделы
            </button>
            <button onClick={onAddImage} className="btn-ghost text-xs px-2 py-1">
              <Image size={12} /> Добавить картинку
            </button>
          </div>
          <ImageGallery images={s.images} onCaption={onCaptionImage} onRemove={onRemoveImage} />
        </>
      )}

      <button onClick={onAddAfter} className="btn-ghost text-xs px-2 py-1">
        <Plus size={12} /> Добавить раздел ниже
      </button>
    </div>
  )
}


export default function DocEditorPage() {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const editDocId = searchParams.get('id')
  const [title, setTitle] = useState('')
  const [projectTopic, setProjectTopic] = useState('')
  const [selectedGostId, setSelectedGostId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [sections, setSections] = useState<SectionState[]>([])
  const [improvingKey, setImprovingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedDocId, setSavedDocId] = useState<string | null>(editDocId)
  const [fmt, setFmt] = useState<DocFormat>({ font: 'Times New Roman', size: 14, align: 'justify', line_spacing: 1.5 })
  const [titlePage, setTitlePage] = useState<TitlePageData>({})
  const [titlePageOpen, setTitlePageOpen] = useState(false)
  const loadedExisting = useRef(false)

  const { data: gosts = [] } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })
  const { data: docTemplates = [] } = useQuery({ queryKey: ['doc-templates'], queryFn: docTemplatesApi.list })
  const selectedGost = (gosts as Gost[]).find(g => g.id === selectedGostId)

  // Применение загруженного .docx-шаблона: подтягивает его структуру разделов
  const applyTemplate = async (id: string) => {
    setTemplateId(id)
    setSelectedGostId('')
    if (!id) { setSections([]); return }
    try {
      const tpl = await docTemplatesApi.get(id)
      const secs = tpl.structure?.sections ?? []
      // рекурсивно превращаем узлы шаблона в NodeState (любая глубина)
      const toNode = (n: any): NodeState => ({
        id: n.id,
        title: n.title,
        description: n.description ?? '',
        text: '',
        images: [],
        subsections: (n.subsections ?? []).map(toNode),
      })
      setSections(
        secs.map((s: any) => ({
          section: s.title,
          hint: s.description ?? '',
          text: '',
          open: true,
          images: [],
          subsections: (s.subsections ?? []).map(toNode),
        }))
      )
      if (!title.trim()) setTitle(tpl.name)
    } catch {
      toast.error('Не удалось загрузить шаблон')
    }
  }

  // Загрузка существующего документа для продолжения редактирования
  const { data: existingDoc } = useQuery({
    queryKey: ['doc-content', editDocId],
    queryFn: () => docsApi.getContent(editDocId!),
    enabled: !!editDocId,
  })

  useEffect(() => {
    if (!existingDoc || loadedExisting.current) return
    loadedExisting.current = true
    if (existingDoc.title) setTitle(existingDoc.title)
    if (existingDoc.fmt) setFmt({ ...fmt, ...existingDoc.fmt })
    if (existingDoc.title_page) setTitlePage(existingDoc.title_page)
    setSections(
      (existingDoc.sections ?? []).map((s, idx) => {
        // Разбираем подразделы вида "## N.M Заголовок\nтекст" обратно в поля
        const parsed = parseSubsections(s.text, idx)
        if (parsed.length > 0) {
          return { section: s.section, hint: '', text: '', open: true, subsections: parsed, images: [] }
        }
        const { clean: cleanText, images: imgs } = extractImages(s.text)
        return { section: s.section, hint: '', text: cleanText, open: true, subsections: [], images: imgs }
      })
    )
  }, [existingDoc])

  useEffect(() => {
    if (editDocId) return  // при редактировании структуру не перезаписываем
    // ГОСТ больше НЕ подставляет разделы — структуру задаёт только шаблон.
    // ГОСТ используется лишь как источник подсказок по содержанию.
    if (selectedGost) {
      neuroContext.set({ gostCode: selectedGost.code, activeSection: '', sectionText: '' })
    }
  }, [selectedGostId])

  useEffect(() => {
    neuroContext.set({ documentTitle: title, projectTopic })
  }, [title, projectTopic])

  const improveText = async (text: string, hint: string, key: string, onDone: (v: string) => void, section = '', mode: 'improve' | 'draft' = 'improve') => {
    if (mode === 'improve' && !text.trim()) return
    setImprovingKey(key)
    try {
      const resp = await api.post('/chat/improve', {
        text,
        gost_hint: hint,
        section,
        doc_title: title,
        mode,
      })
      onDone(resp.data.improved)
      toast.success(mode === 'draft' ? 'Черновик готов' : 'Текст улучшен')
    } catch {
      toast.error('Ошибка нейропомощника')
    } finally {
      setImprovingKey(null)
    }
  }

  const updateSection = (i: number, patch: Partial<SectionState>) =>
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))

  // --- Операции над деревом подразделов по пути (path) внутри секции i ---
  const setSubs = (i: number, fn: (subs: NodeState[]) => NodeState[]) =>
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, subsections: fn(s.subsections) } : s))

  const updateNodeText = (i: number, path: number[], text: string) =>
    setSubs(i, subs => updateNode(subs, path, n => ({ ...n, text })))
  const renameNode = (i: number, path: number[], title: string) =>
    setSubs(i, subs => updateNode(subs, path, n => ({ ...n, title })))
  const removeNodeAt = (i: number, path: number[]) =>
    setSubs(i, subs => removeNode(subs, path))
  const moveNodeAt = (i: number, path: number[], dir: -1 | 1) =>
    setSubs(i, subs => moveNode(subs, path, dir))
  const addChildAt = (i: number, path: number[]) =>
    setSections(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      const parentNum = path.length === 0 ? `${idx + 1}` : (nodeAt(s.subsections, path)?.id ?? `${idx + 1}`)
      const count = path.length === 0 ? s.subsections.length : (nodeAt(s.subsections, path)?.subsections.length ?? 0)
      const child = freshNode(`${parentNum}.${count + 1}`)
      return { ...s, subsections: addChild(s.subsections, path, child), open: true }
    }))

  // --- Кастомизация структуры документа ---
  const renameSection = (i: number, name: string) =>
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, section: name } : s))

  const addSectionAfter = (i?: number) => {
    const fresh: SectionState = { section: 'Новый раздел', hint: '', text: '', subsections: [], images: [], open: true }
    setSections(prev => {
      if (i === undefined) return [...prev, fresh]
      const next = [...prev]
      next.splice(i + 1, 0, fresh)
      return next
    })
  }
  const removeSectionAt = (i: number) =>
    setSections(prev => prev.filter((_, idx) => idx !== i))
  const moveSectionBy = (i: number, dir: -1 | 1) =>
    setSections(prev => {
      const t = i + dir
      if (t < 0 || t >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[t]] = [next[t], next[i]]
      return next
    })

  // Превратить обычный раздел в раздел с подразделами
  const convertToSubsections = (i: number) =>
    setSections(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      if (s.subsections.length > 0) return s
      return { ...s, open: true, text: '',
        subsections: [{ id: `${idx + 1}.1`, title: 'Подраздел 1', description: '', text: s.text, images: [], subsections: [] }] }
    }))

  // --- Картинки раздела ---
  const addSectionImage = async (i: number) => {
    const img = await pickImage(); if (!img) return
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, images: [...s.images, img] } : s))
  }
  const removeSectionImage = (i: number, imgIdx: number) =>
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, images: s.images.filter((_, k) => k !== imgIdx) } : s))
  const captionSectionImage = (i: number, imgIdx: number, caption: string) =>
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, images: s.images.map((im, k) => k === imgIdx ? { ...im, caption } : im) } : s))

  // --- Картинки узла подраздела (по пути) ---
  const addNodeImage = async (i: number, path: number[]) => {
    const img = await pickImage(); if (!img) return
    setSubs(i, subs => updateNode(subs, path, n => ({ ...n, images: [...n.images, img] })))
  }
  const removeNodeImage = (i: number, path: number[], imgIdx: number) =>
    setSubs(i, subs => updateNode(subs, path, n => ({ ...n, images: n.images.filter((_, j) => j !== imgIdx) })))
  const captionNodeImage = (i: number, path: number[], imgIdx: number, caption: string) =>
    setSubs(i, subs => updateNode(subs, path, n => ({ ...n, images: n.images.map((im, j) => j === imgIdx ? { ...im, caption } : im) })))

  const imgMarkers = (imgs: DocImage[]) =>
    imgs.map(im => `[[IMG:${im.path}|${im.caption}]]`).join('\n')

  const withImages = (text: string, imgs: DocImage[]) => {
    const markers = imgMarkers(imgs)
    if (!markers) return text
    return text.trim() ? `${text}\n${markers}` : markers
  }

  const buildPayload = (): DocSection[] => {
    // Рекурсивно кодируем узел: уровень '#' = глубина (2 -> ##, 3 -> ###, ...)
    const encodeNode = (n: NodeState, level: number): string => {
      const hashes = '#'.repeat(Math.min(level, 6))
      const parts: string[] = []
      const ownText = withImages(n.text, n.images)
      parts.push(`${hashes} ${n.id} ${n.title}` + (ownText.trim() ? `\n${ownText}` : ''))
      for (const child of n.subsections) {
        // включаем подузел, если у него или его потомков есть содержимое
        if (hasContent(child)) parts.push(encodeNode(child, level + 1))
      }
      return parts.join('\n\n')
    }
    const hasContent = (n: NodeState): boolean =>
      !!n.text.trim() || n.images.length > 0 || n.subsections.some(hasContent)

    return sections.flatMap(s => {
      if (s.subsections.length > 0) {
        const filled = s.subsections.filter(hasContent)
        if (!filled.length) return []
        const combined = filled.map(sub => encodeNode(sub, 2)).join('\n\n')
        return [{ section: s.section, text: combined }]
      }
      const body = withImages(s.text, s.images)
      return body.trim() ? [{ section: s.section, text: body }] : []
    })
  }

  const handleSave = async (makePdf = false) => {
    if (!title.trim()) return toast.error('Укажите название документа')
    const payload = buildPayload()
    if (!payload.length) return toast.error('Заполните хотя бы один раздел')
    setSaving(true)
    try {
      if (savedDocId) {
        // Обновляем существующий документ — пересборка по шаблону
        const doc = await docsApi.updateContent(savedDocId, payload, title.trim(), fmt, titlePage)
        qc.invalidateQueries({ queryKey: ['docs'] })
        toast.success(`Документ «${doc.title}» обновлён!`, { duration: 5000, icon: '📄' })
      } else {
        const doc = await docsApi.createFromTemplate(selectedGostId || null, title.trim(), payload, makePdf, fmt, titlePage, templateId || null)
        setSavedDocId(doc.id)
        qc.invalidateQueries({ queryKey: ['docs'] })
        toast.success(`Документ «${doc.title}» сформирован!`, { duration: 6000, icon: '📄' })
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail ?? 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium text-text mb-1">{savedDocId ? 'Редактирование документа' : 'Новый документ'}</h1>
      <p className="text-sm text-dim mb-6">
        {savedDocId
          ? 'Продолжите редактирование сохранённого документа. Изменения сохраняются на сервере.'
          : 'Выберите шаблон, заполните разделы — нейропомощник поможет при необходимости'}
      </p>

      <div className="card mb-6 space-y-4">
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
          <label className="label">О чём документ / тема разработки</label>
          <textarea
            className="input min-h-[60px] resize-y"
            value={projectTopic}
            onChange={e => setProjectTopic(e.target.value)}
            placeholder="Например: система для колледжа для создания личного кабинета студента"
          />
        </div>
        {!savedDocId && (
          <div>
            <label className="label">Шаблон документа</label>
            <select className="input" value={templateId} onChange={e => applyTemplate(e.target.value)}>
              <option value="">Не выбран</option>
              {(docTemplates as any[]).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {templateId && (
              <div className="text-xs text-dim mt-1">
                Документ оформится по загруженному шаблону
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card mb-6 space-y-3">
        <div className="text-xs font-medium text-dim uppercase tracking-wide">Оформление текста</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Шрифт</label>
            <select className="input" value={fmt.font} onChange={e => setFmt({ ...fmt, font: e.target.value })}>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Arial">Arial</option>
              <option value="Calibri">Calibri</option>
              <option value="Georgia">Georgia</option>
              <option value="Courier New">Courier New</option>
              <option value="Verdana">Verdana</option>
            </select>
          </div>
          <div>
            <label className="label">Размер (пт)</label>
            <select className="input" value={fmt.size} onChange={e => setFmt({ ...fmt, size: Number(e.target.value) })}>
              {[10, 11, 12, 13, 14, 16, 18].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Выравнивание</label>
            <select className="input" value={fmt.align} onChange={e => setFmt({ ...fmt, align: e.target.value as DocFormat['align'] })}>
              <option value="justify">По ширине</option>
              <option value="left">По левому краю</option>
              <option value="center">По центру</option>
              <option value="right">По правому краю</option>
            </select>
          </div>
          <div>
            <label className="label">Междустрочный</label>
            <select className="input" value={fmt.line_spacing} onChange={e => setFmt({ ...fmt, line_spacing: Number(e.target.value) })}>
              <option value={1}>1.0</option>
              <option value={1.15}>1.15</option>
              <option value={1.5}>1.5</option>
              <option value={2}>2.0</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card mb-6 space-y-3">
        <button
          className="flex items-center gap-2 text-xs font-medium text-dim uppercase tracking-wide w-full"
          onClick={() => setTitlePageOpen(v => !v)}
        >
          {titlePageOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Титульный лист
        </button>

        {titlePageOpen && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Организация-разработчик</label>
                <input className="input" value={titlePage.org_name ?? ''} placeholder="ОРГАНИЗАЦИЯ-РАЗРАБОТЧИК"
                  onChange={e => setTitlePage(p => ({ ...p, org_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Исполнитель (необязательно)</label>
                <input className="input" value={titlePage.executor ?? ''} placeholder="Отдел / подразделение"
                  onChange={e => setTitlePage(p => ({ ...p, executor: e.target.value }))} />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="text-xs text-dim mb-2 font-medium">Гриф утверждения</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Метка грифа</label>
                  <input className="input" value={titlePage.approve_label ?? ''} placeholder="УТВЕРЖДАЮ"
                    onChange={e => setTitlePage(p => ({ ...p, approve_label: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Должность</label>
                  <input className="input" value={titlePage.approve_position ?? ''} placeholder="Генеральный директор"
                    onChange={e => setTitlePage(p => ({ ...p, approve_position: e.target.value }))} />
                </div>
                <div>
                  <label className="label">ФИО</label>
                  <input className="input" value={titlePage.approve_name ?? ''} placeholder="И.И. Иванов"
                    onChange={e => setTitlePage(p => ({ ...p, approve_name: e.target.value }))} />
                </div>
              </div>
              <div className="mt-3">
                <label className="label">Дата утверждения</label>
                <input className="input md:w-1/3" value={titlePage.approve_date ?? ''}
                  placeholder={`«___» ____________ ${new Date().getFullYear()} г.`}
                  onChange={e => setTitlePage(p => ({ ...p, approve_date: e.target.value }))} />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="text-xs text-dim mb-2 font-medium">Центральная часть</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Название документа на титуле</label>
                  <input className="input" value={titlePage.doc_title ?? ''} placeholder="Совпадает с названием выше"
                    onChange={e => setTitlePage(p => ({ ...p, doc_title: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Шифр / обозначение</label>
                  <input className="input" value={titlePage.cipher ?? ''} placeholder="АБВГ.12345-00"
                    onChange={e => setTitlePage(p => ({ ...p, cipher: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Номер ГОСТа на титуле</label>
                  <input className="input" value={titlePage.gost_code ?? ''} placeholder="Заполняется из ГОСТа автоматически"
                    onChange={e => setTitlePage(p => ({ ...p, gost_code: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Стадия / редакция</label>
                  <input className="input" value={titlePage.stage ?? ''} placeholder="Версия 1.0 / Стадия П"
                    onChange={e => setTitlePage(p => ({ ...p, stage: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="text-xs text-dim mb-2 font-medium">Нижняя строка</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Город</label>
                  <input className="input" value={titlePage.city ?? ''} placeholder="Москва"
                    onChange={e => setTitlePage(p => ({ ...p, city: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Год</label>
                  <input className="input" value={titlePage.year ?? ''} placeholder={String(new Date().getFullYear())}
                    onChange={e => setTitlePage(p => ({ ...p, year: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {sections.length > 0 ? (
        <div className="space-y-4">
          {sections.map((s, i) => (
            <SectionField
              key={i}
              s={s}
              index={i}
              total={sections.length}
              onToggle={() => updateSection(i, { open: !s.open })}
              onRename={name => renameSection(i, name)}
              onAddAfter={() => addSectionAfter(i)}
              onRemove={() => removeSectionAt(i)}
              onMove={dir => moveSectionBy(i, dir)}
              onConvertToSubs={() => convertToSubsections(i)}
              onAddImage={() => addSectionImage(i)}
              onCaptionImage={(idx, v) => captionSectionImage(i, idx, v)}
              onRemoveImage={idx => removeSectionImage(i, idx)}
              onTextChange={text => {
                updateSection(i, { text })
                neuroContext.set({ activeSection: s.section, sectionText: text, sectionHint: s.hint })
              }}
              onFocus={() => neuroContext.set({ activeSection: s.section, sectionText: s.text, sectionHint: s.hint, applyText: (v: string) => updateSection(i, { text: v }) })}
              onImprove={() => improveText(s.text, s.hint, s.section, text => updateSection(i, { text }), s.section)}
              improvingKey={improvingKey}
              onNodeChange={(path, text) => {
                updateNodeText(i, path, text)
                const node = nodeAt(s.subsections, path)
                neuroContext.set({ activeSection: `${s.section} / ${node?.title ?? ''}`, sectionText: text, sectionHint: node?.description ?? s.hint })
              }}
              onNodeFocus={path => {
                const node = nodeAt(s.subsections, path)
                neuroContext.set({ activeSection: `${s.section} / ${node?.title ?? ''}`, sectionText: node?.text ?? '', sectionHint: node?.description ?? s.hint, applyText: (v: string) => updateNodeText(i, path, v) })
              }}
              onNodeImprove={path => {
                const node = nodeAt(s.subsections, path)
                if (node) improveText(node.text, node.description, `${i}-${path.join('-')}`, text => updateNodeText(i, path, text), `${s.section} / ${node.title}`)
              }}
              onNodeRename={(path, v) => renameNode(i, path, v)}
              onNodeRemove={path => removeNodeAt(i, path)}
              onNodeMove={(path, dir) => moveNodeAt(i, path, dir)}
              onNodeAddChild={path => addChildAt(i, path)}
              onNodeAddImage={path => addNodeImage(i, path)}
              onNodeCaptionImage={(path, idx, v) => captionNodeImage(i, path, idx, v)}
              onNodeRemoveImage={(path, idx) => removeNodeImage(i, path, idx)}
            />
          ))}

          <button onClick={() => addSectionAfter()} className="btn-ghost text-sm w-full justify-center py-2">
            <Plus size={14} /> Добавить раздел в конец
          </button>

          <div className="flex gap-3 pt-2 flex-wrap">
            {savedDocId ? (
              <>
                <button onClick={() => handleSave(false)} disabled={saving} className="btn-primary">
                  <Save size={14} />
                  {saving ? 'Сохраняю...' : 'Сохранить изменения'}
                </button>
                <button
                  onClick={() => downloadFile(`/docs/${savedDocId}/download/docx`, `${title || 'document'}.docx`)}
                  className="btn-ghost inline-flex items-center gap-1"
                >
                  <FileDown size={14} /> Скачать DOCX
                </button>
                <button
                  onClick={() => downloadFile(`/docs/${savedDocId}/download/pdf`, `${title || 'document'}.pdf`)}
                  className="btn-ghost inline-flex items-center gap-1"
                >
                  <FileDown size={14} /> Скачать PDF
                </button>
              </>
            ) : (
              <>
                <button onClick={() => handleSave(false)} disabled={saving} className="btn-primary">
                  <FilePlus size={14} />
                  {saving ? 'Формирую...' : 'Сформировать DOCX'}
                </button>
                <button onClick={() => handleSave(true)} disabled={saving} className="btn-ghost">
                  <FileDown size={14} />
                  С конвертацией в PDF
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="card text-center py-10 text-dim text-sm space-y-3">
          <div>Выберите шаблон документа выше — или начните писать с чистого листа, как в блокноте.</div>
          <button onClick={() => addSectionAfter()} className="btn-primary mx-auto">
            <Plus size={14} /> Начать с чистого листа
          </button>
        </div>
      )}
    </div>
  )
}
