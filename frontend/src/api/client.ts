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
// --- Assistant ---
export const assistantApi = {
  chat: (content: string, page_context?: string, section_context?: string) =>
    api.post<{ reply: string }>('/assistant/chat', { content, page_context, section_context }).then(r => r.data),
  draftSection: (section: string, gost_hint: string, doc_title: string, text = '', topic = '') =>
    api.post<{ improved: string }>('/assistant/improve', { text, section, gost_hint, doc_title, topic, mode: 'draft' }).then(r => r.data),
  suggestGost: (title: string) =>
    api.post<{ gost_id: string | null; gost_code: string | null; message: string | null }>('/assistant/suggest-gost', { title }).then(r => r.data),
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
export interface DocFormat {
  font?: string
  size?: number
  align?: 'justify' | 'left' | 'center' | 'right'
  line_spacing?: number
}

export interface TitlePageData {
  org_name?: string
  executor?: string
  approve_label?: string
  approve_position?: string
  approve_name?: string
  approve_date?: string
  doc_title?: string
  cipher?: string
  gost_code?: string
  stage?: string
  city?: string
  year?: string
}

export interface DocTemplateSection {
  id: string
  title: string
  level?: number
  subsections?: DocTemplateSection[]
}
export interface DocTemplateStructure {
  sections: DocTemplateSection[]
}
export interface DocTemplate {
  id: string
  name: string
  doc_type: string
  gost_id?: string | null
  structure?: DocTemplateStructure | null
}
export interface DocTemplateInfo {
  id: string
  name: string
  doc_type: string
  sections_count: number
}

// API загружаемых .docx-шаблонов документов
export const docTemplatesApi = {
  list: () => api.get<DocTemplateInfo[]>('/doc-templates/').then(r => r.data),
  get: (id: string) => api.get<DocTemplate>(`/doc-templates/${id}`).then(r => r.data),
  updateStructure: (id: string, structure: DocTemplateStructure) =>
    api.put<DocTemplate>(`/doc-templates/${id}/structure`, { structure }).then(r => r.data),
  upload: (file: File, name: string, doc_type = '', gost_id = '') => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    form.append('doc_type', doc_type)
    form.append('gost_id', gost_id)
    return slowApi.post<DocTemplate>('/doc-templates/upload', form).then(r => r.data)
  },
  remove: (id: string) => api.delete(`/doc-templates/${id}`).then(r => r.data),
}

export const docsApi = {
  list: () => api.get<Doc[]>('/docs/').then(r => r.data),
  generate: (session_id: string, doc_title: string, make_pdf = false) =>
    api.post<Doc>('/docs/generate', { session_id, doc_title, make_pdf }).then(r => r.data),
  createFromTemplate: (gost_id: string | null, title: string, sections: DocSection[], make_pdf = false, fmt?: DocFormat, title_page?: TitlePageData, template_id?: string | null) =>
    slowApi.post<Doc>('/docs/from-template', { gost_id, template_id, title, sections, make_pdf, fmt, title_page }).then(r => r.data),
  getContent: (id: string) => api.get<{ sections: DocSection[]; title?: string; fmt?: DocFormat; title_page?: TitlePageData }>(`/docs/${id}/content`).then(r => r.data),
  updateContent: (id: string, sections: DocSection[], title?: string, fmt?: DocFormat, title_page?: TitlePageData) =>
    api.put<Doc>(`/docs/${id}/content`, { sections, title, fmt, title_page }).then(r => r.data),
  duplicate: (id: string) => slowApi.post<Doc>(`/docs/${id}/duplicate`).then(r => r.data),
  uploadImage: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ path: string; id: string }>('/docs/upload-image', form).then(r => r.data)
  },
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
