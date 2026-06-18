import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { chatApi, gostsApi, api, type Message, type Session } from '../../api/client'
import { Send, Plus, MessageSquare, CheckCircle, Sparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const parts = msg.content.split(/(\*\*[^*]+\*\*)/)
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
        isUser ? 'bg-accent/10 text-text border border-accent/20' : 'bg-card text-text border border-border'
      }`}>
        {parts.map((part, i) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={i} className="text-accent">{part.slice(2, -2)}</strong>
            : <span key={i}>{part}</span>
        )}
      </div>
    </div>
  )
}

function ImproveModal({ original, improved, onUseImproved, onKeepOriginal, onClose }: {
  original: string
  improved: string
  onUseImproved: () => void
  onKeepOriginal: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <span className="text-sm font-medium text-text">Нейропомощник предлагает улучшение</span>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs font-mono text-dim uppercase tracking-widest">Ваш вариант</div>
            <div className="bg-surface rounded p-3 text-sm text-text leading-relaxed min-h-[120px]">
              {original}
            </div>
            <button onClick={onKeepOriginal} className="btn-ghost w-full text-sm">
              Оставить мой вариант
            </button>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-mono text-accent uppercase tracking-widest">✨ Улучшенный вариант</div>
            <div className="bg-accent/5 border border-accent/20 rounded p-3 text-sm text-text leading-relaxed min-h-[120px]">
              {improved}
            </div>
            <button onClick={onUseImproved} className="btn-primary w-full text-sm">
              Использовать улучшенный
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewSessionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (sid: string) => void }) {
  const [gostId, setGostId] = useState('')
  const [roadmapId, setRoadmapId] = useState('')
  const { data: gosts = [] } = useQuery({ queryKey: ['gosts'], queryFn: gostsApi.list })
  const { data: roadmaps = [] } = useQuery({
    queryKey: ['roadmaps'],
    queryFn: () => api.get('/roadmaps/').then(r => r.data),
  })

  const mut = useMutation({
    mutationFn: () => chatApi.createSession(gostId || undefined, roadmapId || undefined),
    onSuccess: (s) => { onCreated(s.id); onClose() },
    onError: () => toast.error('Ошибка создания сессии'),
  })

  return (
    <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md space-y-4">
        <div className="text-sm font-medium text-text">Новый чат</div>
        <div>
          <label className="label">ГОСТ (необязательно)</label>
          <select className="input" value={gostId} onChange={e => setGostId(e.target.value)}>
            <option value="">Без ГОСТа</option>
            {(gosts as any[]).map(g => <option key={g.id} value={g.id}>{g.code} — {g.title}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Роадмап (необязательно)</label>
          <select className="input" value={roadmapId} onChange={e => setRoadmapId(e.target.value)}>
            <option value="">Свободный чат</option>
            {(roadmaps as any[]).map(r => (
              <option key={r.id} value={r.id}>
                {r.name || r.id.slice(0, 8)} · {r.structure.length} вопросов
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending} className="btn-primary">Создать</button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [improving, setImproving] = useState(false)
  const [improveResult, setImproveResult] = useState<{original: string; improved: string} | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions'], queryFn: chatApi.sessions,
  })
  const { data: roadmaps = [] } = useQuery({
    queryKey: ['roadmaps'],
    queryFn: () => api.get('/roadmaps/').then(r => r.data),
  })
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages', activeSession],
    queryFn: () => chatApi.messages(activeSession!),
    enabled: !!activeSession,
  })
  const { data: progress, refetch: refetchProgress } = useQuery({
    queryKey: ['progress', activeSession],
    queryFn: () => chatApi.progress(activeSession!),
    enabled: !!activeSession,
    refetchInterval: 5000,
  })

  // Получаем последний вопрос от бота для контекста
  useEffect(() => {
    const msgs = messages as Message[]
    const lastBot = [...msgs].reverse().find(m => m.role === 'assistant')
    if (lastBot) setCurrentQuestion(lastBot.content.slice(0, 200))
  }, [messages])

  const sendMut = useMutation({
    mutationFn: (content: string) => chatApi.send(activeSession!, content),
    onSuccess: () => { refetchMessages(); refetchProgress(); setInput('') },
    onError: () => toast.error('Ошибка отправки'),
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !activeSession) return
    sendMut.mutate(input.trim())
  }

  const handleImprove = async () => {
    if (!input.trim()) {
      toast.error('Сначала введите текст ответа')
      return
    }
    setImproving(true)
    try {
      const resp = await api.post('/chat/improve', {
        text: input.trim(),
        question: currentQuestion,
      })
      setImproveResult(resp.data)
    } catch {
      toast.error('Ошибка нейропомощника')
    } finally {
      setImproving(false)
    }
  }

  const getRoadmapName = (session: Session) => {
    if (!session.roadmap_id) return null
    const rm = (roadmaps as any[]).find(r => r.id === session.roadmap_id)
    return rm?.name || 'роадмап'
  }

  return (
    <div className="flex h-full">
      {showModal && (
        <NewSessionModal
          onClose={() => setShowModal(false)}
          onCreated={id => { setActiveSession(id); refetchSessions() }}
        />
      )}

      {improveResult && (
        <ImproveModal
          original={improveResult.original}
          improved={improveResult.improved}
          onUseImproved={() => {
            setInput(improveResult.improved)
            setImproveResult(null)
          }}
          onKeepOriginal={() => {
            setImproveResult(null)
          }}
          onClose={() => setImproveResult(null)}
        />
      )}

      {/* Sessions sidebar */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col bg-surface">
        <div className="p-3 border-b border-border">
          <button onClick={() => setShowModal(true)} className="btn-primary w-full justify-center text-xs">
            <Plus size={13} /> Новый чат
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {(sessions as Session[]).length === 0 && (
            <div className="text-xs text-muted text-center py-4">Нет сессий</div>
          )}
          {(sessions as Session[]).map(s => {
            const rmName = getRoadmapName(s)
            return (
              <button
                key={s.id}
                onClick={() => setActiveSession(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded text-xs transition-all ${
                  activeSession === s.id
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'text-dim hover:text-text hover:bg-card'
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={11} />
                  <span className="font-mono truncate">{s.id.slice(0, 12)}</span>
                </div>
                {rmName && <div className="text-[10px] text-muted mt-0.5 pl-4 truncate">{rmName}</div>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {!activeSession ? (
          <div className="flex-1 flex items-center justify-center text-dim text-sm">
            Выберите чат или создайте новый
          </div>
        ) : (
          <>
            {/* Progress bar */}
            {progress && progress.total > 0 && (
              <div className="border-b border-border px-4 py-2 flex items-center gap-3">
                <div className="flex-1 bg-surface rounded-full h-1.5">
                  <div
                    className="bg-accent h-1.5 rounded-full transition-all"
                    style={{ width: `${(progress.answered / progress.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-dim shrink-0">
                  {progress.answered}/{progress.total} вопросов
                </span>
                {progress.done && <CheckCircle size={14} className="text-success" />}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(messages as Message[]).map(m => <MessageBubble key={m.id} msg={m} />)}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={send} className="border-t border-border p-3 space-y-2">
              <textarea
                className="input w-full resize-none"
                rows={3}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Введите ответ..."
                disabled={sendMut.isPending}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (input.trim()) sendMut.mutate(input.trim())
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleImprove}
                  disabled={improving || !input.trim()}
                  className="btn-ghost text-xs flex items-center gap-1.5"
                >
                  <Sparkles size={13} className={improving ? 'animate-pulse text-accent' : ''} />
                  {improving ? 'Улучшаю...' : 'Улучшить с ИИ'}
                </button>
                <div className="flex-1" />
                <button type="submit" disabled={!input.trim() || sendMut.isPending} className="btn-primary px-4">
                  <Send size={14} />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
