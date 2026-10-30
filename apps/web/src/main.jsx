import './features/whatsapp/comunicados.css';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import './features/onboarding/jornada-comercial.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import './styles/conferencia.css'

// Uma instância por bootstrap; App continua responsável pelo mapa de telas.
// A navegação interna usa o adaptador session.page ↔ URL definido em useManageAuthSession.
const router = createBrowserRouter([
  { path: '*', element: <ErrorBoundary><App /></ErrorBoundary> },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// Manifest específico: escritório mantém sua identidade; instalação do chat abre o atendimento.
if (window.location.pathname === "/whatsapp" || new URLSearchParams(window.location.search).get("redirect")?.startsWith("/whatsapp")) {
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/atendimento.webmanifest");
  document.title = "Altan Atendimento";
}
