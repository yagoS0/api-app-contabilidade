import './features/whatsapp/comunicados.css';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './features/onboarding/jornada-comercial.css'
import App from './App.jsx'
import './styles/conferencia.css'

// Q8.C: BrowserRouter habilita deep links, browser back/forward e refresh sem perder contexto.
// A navegação interna usa o adaptador session.page ↔ URL definido em useManageAuthSession.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Manifest específico: escritório mantém sua identidade; instalação do chat abre o atendimento.
if (window.location.pathname === "/whatsapp" || new URLSearchParams(window.location.search).get("redirect")?.startsWith("/whatsapp")) {
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/atendimento.webmanifest");
  document.title = "Altan Atendimento";
}
