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
import { useResumoWhatsapp } from '../features/whatsapp/hooks/useResumoWhatsapp';
import '../index.css';
import '../App.css';
import '../features/onboarding/jornada-comercial.css';
import '../features/whatsapp/whatsapp.css';

const api = createMockApi();
const pendencias = [{ id: 'suporte-demo-1', conversaId: 'mock-cv-1', estado: 'AGUARDANDO', empresa: 'Empresa de demonstração', motivo: 'Conferir o tomador antes da emissão', resumo: 'Cliente pediu uma nota de R$ 11.000,00 para Gusmed. A equipe precisa conferir o cadastro.' }];
api.getPendenciasSuporte = async () => ({ ok: true, total: pendencias.filter(p => p.estado !== 'RESOLVIDO').length, itens: pendencias.filter(p => p.estado !== 'RESOLVIDO').map(p => ({ ...p })) });
api.resolverSuporte = async id => { const p = pendencias.find(p => p.conversaId === id); if (p) p.estado = 'RESOLVIDO'; return { ok: true }; };
const assumirOriginal = api.assumirConversaWhatsapp, devolverOriginal = api.devolverConversaWhatsapp;
api.assumirConversaWhatsapp = async id => { const r = await assumirOriginal(id); const p = pendencias.find(p => p.conversaId === id); if (p) p.estado = 'EM_ATENDIMENTO'; return r; };
api.devolverConversaWhatsapp = async id => { const r = await devolverOriginal(id); await api.resolverSuporte(id); return r; };
api.getConsumoIaDetalhado = async () => ({ ok: true, consumo: { custoUsd: .009, reservaUsd: .05, itens: [{ area: 'Suporte', custoUsd: .0045, chamadas: 2 }, { area: 'Comercial', custoUsd: .0045, chamadas: 1 }] } });
function Previa() {
  const resumoSuporte = useResumoWhatsapp({ api, area: 'suporte' });
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
  return <><div style={{padding:'5px 16px',fontSize:11,textAlign:'right',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}}>DEV · Dados fictícios · Sem envios reais</div><OfficeNavigation resumoWhatsapp={resumoSuporte} />{pagina}</>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') {
  // Esta entrada isolada não autentica nem chama uma API real.
  if (location.pathname === '/comercial-dev.html') history.replaceState({}, '', '/comercial');
  createRoot(document.getElementById('root')).render(<BrowserRouter><WorkspaceNavigationProvider><Previa /></WorkspaceNavigationProvider></BrowserRouter>);
}
