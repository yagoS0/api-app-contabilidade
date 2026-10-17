import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CompaniesTable } from '../features/companies/list/components/renderCompaniesTable';
import { OperationsPage } from '../features/operacoes/OperationsPage';
import { createMockApi } from '../api/mock/mockApi';
import { Button } from '../components/ui/Button';
import '../index.css';
import '../App.css';
import '../features/companies/list/carteira.css';

const node = (state, guideId) => ({ required: true, state, guideId, ok: state !== 'missing' });
const initial = [
  { companyId: 'demo-a', razao: 'Horizonte Serviços e Consultoria Empresarial Ltda', cnpj: '11222333000181', legacyCompany: { regimeTributario: 'LUCRO_PRESUMIDO' }, apuracao: { competencia: '2026-09', apurada: false },
    guideCompliance: { irpj: node('enviada', 'a'), csll: node('enviada', 'b'), pisCofins: { ...node('falhou', 'c'), canalEnvio: 'WHATSAPP', envioStatus: 'falhou', envioErro: 'Destino inválido', envioPodeTentarDeNovo: true }, iss: node('missing') } },
  { companyId: 'demo-b', razao: 'Bosque Tecnologia Ltda', cnpj: '22333444000181', empresaZerada: true, legacyCompany: { regimeTributario: 'SIMPLES' }, guideCompliance: { das: node('vazio'), inss: node('missing') } },
  { companyId: 'demo-c', razao: 'Aurora Comércio Ltda', cnpj: '33444555000181', legacyCompany: { regimeTributario: 'SIMPLES' }, guideCompliance: null },
  { companyId: 'demo-d', razao: 'Lagoa Participações Ltda', cnpj: '44555666000181', legacyCompany: { regimeTributario: 'SIMPLES' }, guideCompliance: { das: { required: false, state: 'na' } } },
];
const storage = 'altan:revisao:fixture:v1';
export function Preview() {
  const [companies, setCompanies] = useState(() => { try { return JSON.parse(localStorage.getItem(storage)) || initial; } catch { return initial; } });
  const [view, setView] = useState('empresas');
  const [state, setState] = useState('normal');
  const [competencia, setCompetencia] = useState('2026-09');
  const [message, setMessage] = useState('');
  const api = useMemo(() => ({ ...createMockApi(),
    getPendenciasSuporte: async () => ({ ok: true, porEmpresa: {} }),
    getOperationManualInss: async () => ({ items: [] }),
    getOperationRoutines: async () => ({ routines: [{ key: 'das', label: 'DAS' }], items: initial.map(c => ({ companyId: c.companyId, enabledKeys: [], applicableKeys: ['das'] })) }),
    getOperationAlerts: async () => ({ total: 1, items: [{ id: 'nota-demo', portalClientId: 'demo-a', portalClient: { razao: initial[0].razao }, competencia: '2026-08', situacaoPeriodo: 'TRANSMITIDA', observacoes: 'Documento de agosto recebido depois da transmissão. Conferir impacto antes de retificar.' }] }),
  }), []);
  function update(next) { setCompanies(next); localStorage.setItem(storage, JSON.stringify(next)); }
  function validateFourth() {
    update(companies.map(c => c.companyId !== 'demo-a' ? c : { ...c, guideCompliance: { ...c.guideCompliance, iss: node('gerada', 'd') } }));
    setMessage('Documento fictício validado. Confira a carteira e a fila de envio.');
  }
  async function send(guideId) {
    update(companies.map(c => ({ ...c, guideCompliance: c.guideCompliance && Object.fromEntries(Object.entries(c.guideCompliance).map(([key, value]) => [key, value.guideId === guideId ? { ...value, state: 'enviada', envioStatus: 'entregue', envioErro: null } : value])) })));
    return { ok: true, message: 'Envio simulado confirmado. Nenhuma mensagem foi enviada.' };
  }
  const data = state === 'vazio' ? [] : companies;
  const error = state === 'erro' ? 'Não foi possível atualizar as empresas.' : null;
  return <main style={{ width: '90%', margin: '24px auto', color: 'var(--text)' }}>
    <header><h1 style={{ fontSize: '1.35rem', fontWeight: 600 }}>Altan · revisão em desenvolvimento</h1><p>Dados fictícios · ações simuladas e salvas apenas neste navegador</p></header>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBlock: 20 }}>
      <Button variant={view === 'empresas' ? 'primary' : 'secondary'} onClick={() => setView('empresas')}>Empresas</Button>
      <Button variant={view === 'operacoes' ? 'primary' : 'secondary'} onClick={() => setView('operacoes')}>Operações</Button>
      <label>Estado de teste <select value={state} onChange={e => setState(e.target.value)}><option value="normal">Normal</option><option value="vazio">Vazio</option><option value="erro">Erro</option><option value="carregando">Carregando</option></select></label>
      <Button variant="secondary" onClick={validateFourth}>Simular quarta guia validada</Button>
      <Button variant="secondary" onClick={() => { update(initial); setMessage('Cenário reiniciado.'); }}>Reiniciar cenário</Button>
    </div>
    {message && <p role="status">{message}</p>}
    {view === 'empresas' ? <CompaniesTable api={api} companies={data} competencia={competencia} carregando={state === 'carregando'} erroDeCarga={error} busca="" acoesGuia={{ onEnviarWhatsapp: send, onEnviar: send }} onOpenCompany={() => setMessage('Esta bancada valida a carteira. O aplicativo completo está na página inicial.')} onFluxo={() => setMessage('Fluxo fiscal preservado; esta bancada não transmite declarações.')} />
      : <OperationsPage api={api} companies={data} competencia={competencia} loading={state === 'carregando'} error={error} onRefresh={() => setMessage('Leitura simulada atualizada.')} onChangeCompetencia={setCompetencia} acoesGuia={{ onEnviarWhatsapp: send, onEnviar: send }} />}
  </main>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') createRoot(document.getElementById('root')).render(<BrowserRouter><Preview/></BrowserRouter>);

