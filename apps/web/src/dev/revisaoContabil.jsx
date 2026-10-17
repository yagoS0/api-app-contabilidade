import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CircularTab } from '../features/accounting/circular/components/renderCircularTab';
import { AccountingEntriesTab } from '../features/accounting/entries/components/renderAccountingEntriesTab';
import { ParcelamentoTab } from '../features/accounting/parcelamento/pages/renderParcelamentoTab';
import { RelatoriosTab } from '../features/relatorios/components/RelatoriosTab';
import { analisePlanejamentoMock } from '../api/mock/analisePlanejamentoMock';
import { Button } from '../components/ui/Button';
import '../index.css';
import '../App.css';

const noop = () => {};
const comp = '2026-09';
const api = {
 getFechamentosRelatorio: async () => ({ ok: true, competenciasFechadas: [comp] }),
 getAnalisePlanejamento: async (_, filtro) => {
   const r = analisePlanejamentoMock('demo-comparacao-aberta', filtro);
   r.anterior.indisponivel = true;
   return r;
 },
};
const circular = { receitas: { [comp]: 12000 }, extrato: {}, entries: [], acrescimos: {}, fechamentos: { [comp]: { fechadoEm: '2026-10-01' } }, provisoes: [
 { id: 'das', subtipo: 'DAS', competencia: comp, statusPagamento: 'ABERTO', valor: 1234.56, baixas: [], sourceGuide: { id: 'guia-das', tipo: 'DAS', valor: 1234.56, vencimento: '2026-10-01', paymentStatus: 'OVERDUE' } },
 { id: 'inss', subtipo: 'INSS', competencia: comp, statusPagamento: 'ABERTO', valor: 300, baixas: [], sourceGuide: { id: 'guia-inss', tipo: 'INSS', valor: 300, vencimento: '2026-10-20', paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE' } },
] };
const parcelamentos = { parcelamentos: [], loading: false, load: noop, listConferencia: async () => [] };
export function Preview() {
 const [view, setView] = useState('lancamentos');
 const props = { companyId: 'dev-contabil', competencia: comp, accounts: [], onLoad: noop, onCompetenciaChange: noop };
 return <main style={{ maxWidth: 1440, padding: 16, margin: 'auto', minWidth: 0 }}>
   <header><h1 style={{ fontSize: '1.2rem' }}>Horizonte Serviços · 09/2026</h1><nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{['lancamentos', 'circular', 'parcelamentos', 'relatorios'].map(v => <Button key={v} onClick={() => setView(v)} aria-pressed={view === v}>{v}</Button>)}</nav></header>
   {view === 'lancamentos' && <AccountingEntriesTab {...props} entries={[]} total={0} loading={false} filters={{ competencia: comp }} onFilterChange={noop} onCreateEntry={noop} onUpdateEntry={noop} onDeleteEntry={noop} onLoadAccounts={noop}/>}
   {view === 'circular' && <CircularTab {...props} circularData={circular} loading={false} year={2026} companyRegime="SIMPLES" onYearChange={noop} onCreateBaixa={noop} onUpdateEntry={noop} onSaveCircular={noop}/>}
   {view === 'parcelamentos' && <ParcelamentoTab {...props} parcelamentos={parcelamentos}/>}
   {view === 'relatorios' && <RelatoriosTab {...props} api={api} razaoSocial="Horizonte Serviços"/>}
 </main>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') createRoot(document.getElementById('root')).render(<BrowserRouter><Preview/></BrowserRouter>);
