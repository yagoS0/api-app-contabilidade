import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// Q8.C: BrowserRouter habilita deep links, browser back/forward e refresh sem perder contexto.
// A navegação interna usa o adaptador session.page ↔ URL definido em useManageAuthSession.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
