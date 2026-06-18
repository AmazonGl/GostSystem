import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { assistantApi } from '../api/client'
import { neuroContext } from '../store/neuroContext'
import { Bot, X, Send, Minimize2, Sparkles } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const PAGE_LABELS: Record<string, string> = {
  '/chat': 'Чат — заполнение документа по роадмапу',
  '/docs': 'Документы — генерация и редактирование DOCX/PDF',
  '/docs/editor': 'Редактор — создание нового документа по шаблону ГОСТа',
  '/profile': 'Профиль пользователя',
  '/admin/gosts': 'ГОСТы — загрузка стандартов',
  '/admin/storage': 'Хранилище — ГОСТы с мета-информацией',
  '/admin/templates': 'Шаблоны — промпты по ГОСТам',
  '/admin/prompts': 'Промпты — инструкции для нейросети',
  '/admin/roadmaps': 'Роадмапы — структура вопросов',
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
      content: 'Привет! Я нейропомощник. Помогу разобраться с сайтом, подскажу как заполнить раздел или улучшить текст.',
    },
  ])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return neuroContext.subscribe(() => {
      const newCtx = neuroContext.get()
      setCtx(newCtx)
      if (newCtx.activeSection && !open) {
        setHasHint(true)
      }
    })
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const buildSectionContext = () => {
    const c = neuroContext.get()
    if (!c.activeSection) return ''
    let s = `Раздел: ${c.activeSection}`
    if (c.gostCode) s += ` (${c.gostCode})`
    if (c.documentTitle) s += ` | Документ: «${c.documentTitle}»`
    if (c.sectionText) s += `\nНаписано: ${c.sectionText.slice(0, 400)}`
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
            <div className="px-3 pt-2 pb-1 shrink-0">
              <button
                onClick={handleQuickHelp}
                disabled={loading}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/15 transition-colors"
              >
                <Sparkles size={11} />
                <span className="truncate">Помочь с разделом «{ctx.activeSection}»</span>
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-xs rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto bg-accent/15 text-text'
                    : 'mr-auto bg-card text-dim border border-border'
                }`}
              >
                {m.content}
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
