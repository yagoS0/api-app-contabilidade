import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotasFiscaisTab } from '../features/notas/components/renderNotasFiscaisTab';
import '../index.css';
import '../App.css';
const vazio = () => {};
const resumo = { ano: 2026, totals: { totalNotas: 0, totalEmitido: 0, totalRecebido: 0, countNfe: 0, countNfse: 0, countCanceladas: 0 } };
export function Previa() {
  const [filtros, setFiltros] = useState({ papel: 'EMIT', type: 'NFSE', competencia: '2026-09', limit: 100, offset: 0 });
  return <main>
    <header style={{ width: 'var(--content-wide)', margin: '24px auto 0' }}>
      <p style={{ color: 'var(--text-muted)' }}>Demonstração local · dados fictícios</p>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Notas fiscais</h1>
    </header>
    <NotasFiscaisTab competencia="2026-09" notasPanel={{ companyId: 'demo', notas: [], notasTotal: 0,
      notasFilters: filtros, setNotasFilters: setFiltros, notasSummary: resumo, notasRecebidas: resumo,
      reload: vazio, loadNotas: vazio, syncAdn: vazio, syncDfe: vazio, clearAdnError: vazio,
      clearDfeError: vazio, importNotas: vazio, marcarNotaStatus: vazio, abrirNota: vazio, fecharNota: vazio }} />
  </main>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') createRoot(document.getElementById('root')).render(<Previa />);
