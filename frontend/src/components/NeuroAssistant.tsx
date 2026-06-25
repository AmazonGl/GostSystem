import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { assistantApi } from '../api/client'
import { neuroContext } from '../store/neuroContext'
import { Bot, X, Send, Minimize2, Sparkles } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  draft?: string  // если задано — это предложенный черновик, можно вставить в раздел
}

const PAGE_LABELS: Record<string, string> = {
  '/docs': 'Документы — список созданных документов, создание и редактирование',
  '/docs/editor': 'Редактор — создание документа по шаблону',
  '/profile': 'Профиль пользователя',
  '/admin/storage': 'Стандарты (ГОСТы) — загруженные стандарты для справки',
  '/admin/templates': 'Шаблоны — загруженные .docx-бланки документов',
  '/admin/structures': 'Структура документов — разделы, разобранные из шаблонов',
  '/admin/users': 'Пользователи',
  '/admin/stats': 'Статистика',
}

export default function NeuroAssistant() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasHint, setHasHint] = useState(false)
  const [ctx, setCtx] = useState(neuroContext.get())
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Я помогу с документацией по ЕСПД и ЕСКД: подскажу, что писать в разделе, или составлю черновик по требованиям ГОСТа. Откройте раздел документа и нажмите кнопку ниже.',
    },
  ])
  const bottomRef = useRef<HTMLDivElement>(null)

  const [proactive, setProactive] = useState(true)
  const proactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProactiveSection = useRef<string>('')

  useEffect(() => {
    return neuroContext.subscribe(() => {
      const newCtx = neuroContext.get()
      setCtx(newCtx)
      if (newCtx.activeSection && !open) {
        setHasHint(true)
      }
      // Проактивный режим: при заходе в новый раздел через паузу предлагаем помощь
      if (!proactive) return
      if (newCtx.activeSection && newCtx.activeSection !== lastProactiveSection.current) {
        if (proactiveTimer.current) clearTimeout(proactiveTimer.current)
        const section = newCtx.activeSection
        proactiveTimer.current = setTimeout(() => {
          const c = neuroContext.get()
          if (c.activeSection !== section) return
          lastProactiveSection.current = section
          const tip = c.sectionText
            ? `Вижу, вы заполняете «${section}». Хотите, проверю и помогу улучшить текст?`
            : `Подсказать, что обычно пишут в разделе «${section}»?`
          setMessages(prev => {
            // не повторяем одинаковую подсказку подряд
            if (prev.length && prev[prev.length - 1].content === tip) return prev
            return [...prev, { role: 'assistant', content: tip }]
          })
          if (!open) setHasHint(true)
        }, 3500)
      }
    })
  }, [open, proactive])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const buildSectionContext = () => {
    const c = neuroContext.get()
    if (!c.activeSection && !c.projectTopic) return ''
    let s = ''
    if (c.projectTopic) s += `О чём документ (тема разработки): ${c.projectTopic}\n`
    if (c.activeSection) s += `Раздел: ${c.activeSection}`
    if (c.gostCode) s += ` (${c.gostCode})`
    if (c.documentTitle) s += ` | Документ: «${c.documentTitle}»`
    if (c.sectionHint) s += `\nНазначение раздела: ${c.sectionHint.slice(0, 200)}`
    if (c.sectionText) s += `\nНаписано пользователем: ${c.sectionText.slice(0, 400)}`
    else if (c.activeSection) s += `\nПоле пока пустое — пользователь ещё ничего не написал.`
    return s
  }

  const buildPageContext = () => {
    const base = PAGE_LABELS[location.pathname] || location.pathname
    const c = neuroContext.get()
    let extra = ''
    if (c.gostCode) extra += ` | ГОСТ: ${c.gostCode}`
    if (c.documentTitle) extra += ` | Документ: «${c.documentTitle}»`
    if (c.activeSection) extra += ` | Раздел: ${c.activeSection}`
    return base + extra
  }

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content }])
    setLoading(true)
    try {
      const { reply } = await assistantApi.chat(content, buildPageContext(), buildSectionContext())
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Не удалось получить ответ. Проверьте, что Ollama запущена.',
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleQuickHelp = () => {
    const c = neuroContext.get()
    if (!c.activeSection) return
    const prompt = c.sectionText
      ? `Помоги улучшить текст раздела «${c.activeSection}»: ${c.sectionText.slice(0, 200)}`
      : `Что нужно написать в разделе «${c.activeSection}»? Подскажи кратко.`
    send(prompt)
  }

  const writeDraft = async () => {
    const c = neuroContext.get()
    if (!c.activeSection || loading) return
    setMessages(prev => [...prev, { role: 'user', content: `Напиши черновик раздела «${c.activeSection}»` }])
    setLoading(true)
    try {
      const { improved } = await assistantApi.draftSection(
        c.activeSection, c.sectionHint || '', c.documentTitle || '', c.sectionText || '', c.projectTopic || ''
      )
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Вот вариант для этого раздела:',
        draft: improved,
      }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Не удалось составить черновик. Проверьте, что Ollama запущена.' }])
    } finally {
      setLoading(false)
    }
  }

  const applyDraft = (text: string) => {
    const c = neuroContext.get()
    if (c.applyText) {
      c.applyText(text)
      setMessages(prev => [...prev, { role: 'assistant', content: '✓ Вставил текст в раздел. Можете отредактировать его в форме.' }])
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setHasHint(false) }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-accent text-bg shadow-lg hover:bg-accent/90 transition-all font-medium text-sm"
      >
        <Bot size={18} />
        Помощник
        {hasHint && (
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
        )}
      </button>
    )
  }

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 flex flex-col bg-surface border border-border rounded-xl shadow-2xl transition-all ${
        minimized ? 'w-72 h-12' : 'w-80 h-[440px]'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0 rounded-t-xl bg-accent/5">
        <Bot size={16} className="text-accent" />
        <span className="text-sm font-medium text-text flex-1">Нейропомощник</span>
        <button
          onClick={() => setProactive(p => !p)}
          title={proactive ? 'Подсказки включены — нажмите, чтобы отключить' : 'Подсказки отключены'}
          className={proactive ? 'text-accent' : 'text-dim hover:text-text'}
        >
          <Sparkles size={14} />
        </button>
        <button onClick={() => setMinimized(!minimized)} className="text-dim hover:text-text">
          <Minimize2 size={14} />
        </button>
        <button onClick={() => setOpen(false)} className="text-dim hover:text-text">
          <X size={14} />
        </button>
      </div>

      {!minimized && (
        <>
          {ctx.activeSection && (
            <div className="px-3 pt-2 pb-1 shrink-0 space-y-1.5">
              <button
                onClick={handleQuickHelp}
                disabled={loading}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/15 transition-colors"
              >
                <Sparkles size={11} />
                <span className="truncate">Помочь с разделом «{ctx.activeSection}»</span>
              </button>
              <button
                onClick={writeDraft}
                disabled={loading}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/15 transition-colors"
              >
                <Bot size={11} />
                <span className="truncate">Написать черновик по ГОСТу</span>
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`max-w-[90%] ${m.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
                <div
                  className={`text-xs rounded-lg px-3 py-2 whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-accent/15 text-text'
                      : 'bg-card text-dim border border-border'
                  }`}
                >
                  {m.content}
                  {m.draft && (
                    <div className="mt-2 pt-2 border-t border-border text-text whitespace-pre-wrap">{m.draft}</div>
                  )}
                </div>
                {m.draft && (
                  <button
                    onClick={() => applyDraft(m.draft!)}
                    className="mt-1 text-xs text-accent hover:underline inline-flex items-center gap-1"
                  >
                    <Sparkles size={11} /> Вставить в раздел
                  </button>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-xs text-muted animate-pulse px-3">Думаю...</div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-3 border-t border-border shrink-0 flex gap-2">
            <input
              className="input text-xs flex-1 py-1.5"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Задайте вопрос..."
              disabled={loading}
            />
            <button onClick={() => send()} disabled={loading || !input.trim()} className="btn-primary px-2 py-1.5">
              <Send size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
