import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageCircle, X, Send, Bot, Loader, Minimize2 } from 'lucide-react'
import { chatApi } from '../api/client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const PAGE_CONTEXTS: Record<string, string> = {
  '/chat': 'Пользователь находится на странице Чат. Помоги ему заполнить опросник для генерации технического документа. Объясни, что нужно отвечать на вопросы нейросети, и документ будет сформирован автоматически.',
  '/docs': 'Пользователь находится на странице Документы. Здесь можно: выбрать сессию с роадмапом и сгенерировать DOCX/PDF, просмотреть документ, отредактировать его (кнопка "Редактировать"), скачать. Если что-то не нравится в документе — его можно отредактировать прямо здесь.',
  '/profile': 'Пользователь на странице Профиль.',
  '/admin/gosts': 'Пользователь на странице ГОСТы. Здесь можно загружать стандарты (PDF/DOCX) с указанием кода, названия и категории.',
  '/admin/storage': 'Пользователь на странице Хранилище. Вкладка ГОСТы — загружать, просматривать и удалять ГОСТы с мета-информацией (для ГОСТ 19 и ГОСТ 2 есть готовые схемы). Вкладка Папки — управление структурой папок.',
  '/admin/prompts': 'Пользователь на странице Промпты. Можно создавать промпты и привязывать их к ГОСТам.',
  '/admin/roadmaps': 'Пользователь на странице Роадмапы. Можно генерировать структуры вопросов для документов на основе ГОСТа и промпта.',
  '/admin/users': 'Пользователь на странице Пользователи. Управление аккаунтами и ролями.',
  '/admin/stats': 'Пользователь на странице Статистика. Здесь отображается активность системы.',
  '/admin/templates': 'Пользователь на странице Шаблоны. Здесь хранятся шаблоны документов по ГОСТам с промптами. Можно редактировать промпт под себя или сбросить к стандартному кнопкой "Сбросить".',
}

const SYSTEM_PROMPT = `Ты — нейропомощник системы генерации технической документации по ГОСТам РФ. 
Твоя задача — помогать пользователям разобраться с интерфейсом, объяснять как работают функции, 
подсказывать следующие шаги, дополнять содержимое документов и отвечать на вопросы по стандартам.

Ты знаешь:
- ГОСТ 19 (ЕСПД) — программная документация
- ГОСТ 2 (ЕСКД) — конструкторская документация  
- ГОСТ 34 — автоматизированные системы

Отвечай кратко и по делу. Используй русский язык. Если спрашивают о технической документации — помогай составить разделы.`

export default function NeuralAssistant() {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [unread, setUnread] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const location = useLocation()

  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Приветствие при открытии
  useEffect(() => {
    if (open && messages.length === 0) {
      const pageCtx = PAGE_CONTEXTS[location.pathname] || ''
      const greeting = pageCtx
        ? `Привет! Я нейропомощник. ${pageCtx.split('.')[0]}. Чем могу помочь?`
        : 'Привет! Я нейропомощник системы документации по ГОСТам. Задайте вопрос о работе с системой или попросите помочь с содержимым документа.'
      setMessages([{ role: 'assistant', content: greeting }])
    }
  }, [open])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    try {
      const pageCtx = PAGE_CONTEXTS[location.pathname] || ''
      const systemWithCtx = SYSTEM_PROMPT + (pageCtx ? `\n\nТекущий контекст: ${pageCtx}` : '')

      const data = await chatApi.assistant(userMsg, systemWithCtx, messages)
      const text = data.text || 'Извините, не удалось получить ответ.'
      setMessages(prev => [...prev, { role: 'assistant', content: text }])
      if (!open) setUnread(n => n + 1)
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Не удалось связаться с сервером помощника. Проверьте, что backend запущен, а затем попробуйте еще раз.'
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      {/* Кнопка открытия */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setMinimized(false) }}
          className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-accent text-bg shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        >
          <MessageCircle size={20} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white text-[10px] rounded-full flex items-center justify-center font-mono">
              {unread}
            </span>
          )}
        </button>
      )}

      {/* Панель чата */}
      {open && (
        <div
          className={`fixed bottom-5 right-5 z-50 w-80 bg-surface border border-border rounded-xl shadow-2xl flex flex-col transition-all ${
            minimized ? 'h-12' : 'h-[460px]'
          }`}
        >
          {/* Шапка */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border rounded-t-xl bg-surface">
            <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
              <Bot size={14} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-text">Нейропомощник</div>
              <div className="text-[10px] text-dim font-mono truncate">
                {PAGE_CONTEXTS[location.pathname] ? location.pathname.replace(/^\//, '') : 'ГОСТ-документация'}
              </div>
            </div>
            <button onClick={() => setMinimized(v => !v)} className="text-dim hover:text-text p-1">
              <Minimize2 size={12} />
            </button>
            <button onClick={() => setOpen(false)} className="text-dim hover:text-text p-1">
              <X size={14} />
            </button>
          </div>

          {!minimized && (
            <>
              {/* Сообщения */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    {m.role === 'assistant' && (
                      <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot size={10} className="text-accent" />
                      </div>
                    )}
                    <div className={`text-xs rounded-xl px-3 py-2 max-w-[85%] leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-accent text-bg ml-auto'
                        : 'bg-card text-text'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-2">
                    <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                      <Bot size={10} className="text-accent" />
                    </div>
                    <div className="bg-card text-dim text-xs rounded-xl px-3 py-2 flex items-center gap-1.5">
                      <Loader size={10} className="animate-spin" />
                      Думаю...
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Ввод */}
              <div className="p-2 border-t border-border">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    className="flex-1 bg-card border border-border rounded-lg text-xs text-text px-3 py-2 resize-none focus:outline-none focus:border-accent/50 transition-colors"
                    rows={2}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Задайте вопрос... (Enter — отправить)"
                    disabled={loading}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || loading}
                    className="w-8 h-8 rounded-lg bg-accent text-bg flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0"
                  >
                    <Send size={13} />
                  </button>
                </div>
                <div className="text-[10px] text-muted mt-1 text-center font-mono">Shift+Enter — новая строка</div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
