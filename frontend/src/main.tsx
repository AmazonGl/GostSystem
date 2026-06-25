import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#1a1d27', color: '#e2e4f0', border: '1px solid #252836', fontSize: '14px' },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
)
