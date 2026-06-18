import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// --- Auth ---
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ access_token: string }>('/auth/login', new URLSearchParams({ username: email, password })),
  register: (email: string, password: string, name: string) =>
    api.post<{ access_token: string }>('/auth/register', { email, password, name }),
  me: () => api.get<{ id: string; email: string; name: string; role: string }>('/users/me'),
}

// --- GOSTs ---
export interface GostMetaSubsection {
  id: string
  title: string
  description: string
}

export interface GostMetaSection {
  id: string
  title: string
  type: string
  description: string
  required: boolean
  fields: string[]
  subsections?: GostMetaSubsection[]
}
export interface GostMetaSchema {
  gost_code: string
  title: string
  category: string
  series: string
  sections: GostMetaSection[]
  prompt_hints: string[]
}
export interface Gost {
  id: string
  code: string
  title: string
  file_type: string
  category: string
  folder_path: string
  meta_schema?: GostMetaSchema | null
  has_template?: boolean
}
export const gostsApi = {
  list: () => api.get<Gost[]>('/gosts/').then(r => r.data),
  upload: (form: FormData) => api.post<Gost>('/gosts/upload', form),
  remove: (id: string) => api.delete(`/gosts/${id}`),
  previewUrl: (id: string) => `/api/gosts/${id}/preview`,
  getMeta: (id: string) => api.get(`/gosts/${id}/meta`).then(r => r.data),
  updateMeta: (id: string, meta_schema: GostMetaSchema) =>
    api.put<Gost>(`/gosts/${id}/meta`, { meta_schema }).then(r => r.data),
  regenerateMeta: (id: string) => api.post(`/gosts/${id}/generate-meta`).then(r => r.data),
}

// --- Templates ---
export interface GostTemplate {
  id: string
  gost_id: string
  gost_code: string
  gost_title: string
  gost_category: string
  default_prompt: string
  current_prompt: string
  meta_schema?: GostMetaSchema | null
}
export const templatesApi = {
  list: () => api.get<GostTemplate[]>('/templates/').then(r => r.data),
  get: (id: string) => api.get<GostTemplate>(`/templates/${id}`).then(r => r.data),
  update: (id: string, current_prompt: string) =>
    api.put<GostTemplate>(`/templates/${id}`, { current_prompt }).then(r => r.data),
  reset: (id: string) => api.post<GostTemplate>(`/templates/${id}/reset`).then(r => r.data),
}

// --- Assistant ---
export const assistantApi = {
  chat: (content: string, page_context?: string, section_context?: string) =>
    api.post<{ reply: string }>('/assistant/chat', { content, page_context, section_context }).then(r => r.data),
  suggestGost: (title: string) =>
    api.post<{ gost_id: string | null; gost_code: string | null; message: string | null }>('/assistant/suggest-gost', { title }).then(r => r.data),
}

// --- Prompts ---
export interface Prompt { id: string; title: string; content: string }
export const promptsApi = {
  list: () => api.get<Prompt[]>('/prompts/').then(r => r.data),
  create: (title: string, content: string) => api.post<Prompt>('/prompts/', { title, content }),
  update: (id: string, title: string, content: string) => api.put<Prompt>(`/prompts/${id}`, { title, content }),
  remove: (id: string) => api.delete(`/prompts/${id}`),
  bind: (promptId: string, gostId: string) => api.post(`/prompts/${promptId}/bind`, { gost_id: gostId }),
  unbind: (promptId: string, gostId: string) => api.delete(`/prompts/${promptId}/bind/${gostId}`),
}

// --- Roadmaps ---
export interface RoadmapItem { section: string; description: string; question: string }
export interface Roadmap { id: string; gost_id: string; prompt_id: string; structure: RoadmapItem[] }
export const roadmapsApi = {
  list: () => api.get<Roadmap[]>('/roadmaps/').then(r => r.data),
  generate: (gost_id: string, prompt_id: string) => api.post<Roadmap>('/roadmaps/generate', { gost_id, prompt_id }),
  get: (id: string) => api.get<Roadmap>(`/roadmaps/${id}`).then(r => r.data),
}

// --- Chat ---
export interface Session { id: string; project_id: string | null; gost_id: string | null; roadmap_id: string | null }
export interface Message { id: string; role: 'user' | 'bot'; content: string }
export interface Progress { answered: number; total: number; done: boolean }
export const chatApi = {
  createSession: (gost_id?: string, roadmap_id?: string) =>
    api.post<Session>('/chat/sessions', { gost_id, roadmap_id }).then(r => r.data),
  sessions: () => api.get<Session[]>('/chat/sessions').then(r => r.data),
  messages: (sid: string) => api.get<Message[]>(`/chat/sessions/${sid}/messages`).then(r => r.data),
  send: (sid: string, content: string) =>
    api.post<Message[]>(`/chat/sessions/${sid}/messages`, { content }).then(r => r.data),
  progress: (sid: string) => api.get<Progress>(`/chat/sessions/${sid}/progress`).then(r => r.data),
}

// --- Docs ---
export interface DocSection { section: string; text: string }
export interface Doc {
  id: string
  session_id: string
  roadmap_id: string
  title: string
  docx_path: string | null
  pdf_path: string | null
  sections_content?: { sections: DocSection[] } | null
}
export const docsApi = {
  list: () => api.get<Doc[]>('/docs/').then(r => r.data),
  generate: (session_id: string, doc_title: string, make_pdf = false) =>
    api.post<Doc>('/docs/generate', { session_id, doc_title, make_pdf }).then(r => r.data),
  createFromTemplate: (gost_id: string, title: string, sections: DocSection[], make_pdf = false) =>
    slowApi.post<Doc>('/docs/from-template', { gost_id, title, sections, make_pdf }).then(r => r.data),
  getContent: (id: string) => api.get<{ sections: DocSection[]; title?: string }>(`/docs/${id}/content`).then(r => r.data),
  updateContent: (id: string, sections: DocSection[], title?: string) =>
    api.put<Doc>(`/docs/${id}/content`, { sections, title }).then(r => r.data),
  downloadDocx: (id: string) => `/api/docs/${id}/download/docx`,
  downloadPdf:  (id: string) => `/api/docs/${id}/download/pdf`,
}

// --- Ollama ---
export const ollamaApi = {
  health: () => api.get<{ status: string; active_model: string; available_models: string[] }>('/ollama/health').then(r => r.data),
}

// --- Storage ---
export interface StorageNode { name: string; type: 'file' | 'folder'; path: string; children?: StorageNode[] }
export const storageApi = {
  tree: () => api.get<{ root: string; children: StorageNode[] }>('/storage/tree').then(r => r.data),
  mkdir: (path: string) => api.post('/storage/folders', null, { params: { path } }),
  rmdir: (path: string) => api.delete('/storage/folders', { params: { path } }),
}


// Инстанс с большим таймаутом для долгих запросов (генерация роадмапов, документов)
export const slowApi = axios.create({ baseURL: '/api', timeout: 300000 })
slowApi.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})
