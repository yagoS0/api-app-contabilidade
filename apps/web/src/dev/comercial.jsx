import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { createMockApi } from '../api/mock/mockApi';
import { ComercialPage } from '../features/comercial/ComercialPage';
import { WhatsappPage } from '../features/whatsapp/pages/renderWhatsappPage';
import { OnboardingDetailPage } from '../features/onboarding/pages/renderOnboardingDetailPage';
import { OnboardingWizardPage } from '../features/onboarding/pages/renderOnboardingWizardPage';
import { OnboardingsPage } from '../features/onboarding/pages/renderOnboardingsPage';
import { BibliotecaComercialPage } from '../features/onboarding/pages/BibliotecaComercialPage';
import { OfficeNavigation } from '../app/navigation/OfficeNavigation';
import { WorkspaceNavigationProvider } from '../app/navigation/WorkspaceNavigation';
import '../index.css';
import '../App.css';
import '../features/onboarding/jornada-comercial.css';
import '../features/whatsapp/whatsapp.css';

const api = createMockApi();
function Previa() {
  const { pathname } = useLocation(), navigate = useNavigate();
  const [mensagemBiblioteca, setMensagemBiblioteca] = useState(null);
  const voltar = () => navigate('/comercial');
  const abrir = item => navigate(`/onboardings/${encodeURIComponent(item.id)}`);
  const id = decodeURIComponent(pathname.split('/')[2] || '');
  const criar = async ({ origem, modo }) => { const r = await api.criarOnboarding(origem); navigate(`/onboardings/${r.onboarding.id}${modo === 'escritorio' ? '/editar' : ''}`); };
  let pagina = <main className="commercial-workspace"><h1>Prévia do atendimento</h1><p>Esta aba demonstra Suporte e Comercial.</p><button onClick={voltar}>Abrir Comercial</button></main>;
  if (pathname === '/comercial' || pathname.startsWith('/comercial/')) pagina = <ComercialPage api={api} usuarioId="mock-user-1" mensagemBiblioteca={mensagemBiblioteca} onMensagemBibliotecaAberta={() => setMensagemBiblioteca(null)} />;
  if (pathname === '/suporte' || pathname === '/whatsapp') pagina = <WhatsappPage key="suporte" api={api} area="suporte" usuarioId="mock-user-1" />;
  else if (pathname === '/onboardings') pagina = <OnboardingsPage api={api} onVoltar={voltar} onAbrir={abrir} onNovo={criar} />;
  else if (pathname.startsWith('/onboardings/') && pathname.endsWith('/editar')) pagina = <OnboardingWizardPage api={api} onboardingId={id} onVoltar={voltar} onAbrirDetalhe={() => abrir({ id })} />;
  else if (pathname.startsWith('/onboardings/')) pagina = <OnboardingDetailPage api={api} onboardingId={id} onVoltar={voltar} onEditar={() => navigate(`/onboardings/${id}/editar`)} onAbrirEmpresa={() => navigate('/suporte')} />;
  else if (pathname === '/biblioteca') pagina = <BibliotecaComercialPage api={api} onBack={voltar} onUsarMensagem={mensagem => { setMensagemBiblioteca(mensagem); navigate('/comercial/conversas'); }} />;
  return <><div style={{padding:'5px 16px',fontSize:11,textAlign:'right',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}}>DEV · Dados fictícios · Sem envios reais</div><OfficeNavigation />{pagina}</>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') {
  // Esta entrada isolada não autentica nem chama uma API real.
  if (location.pathname === '/comercial-dev.html') history.replaceState({}, '', '/comercial');
  createRoot(document.getElementById('root')).render(<BrowserRouter><WorkspaceNavigationProvider><Previa /></WorkspaceNavigationProvider></BrowserRouter>);
}
