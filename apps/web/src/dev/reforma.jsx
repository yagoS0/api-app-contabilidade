import React from 'react';
import { createRoot } from 'react-dom/client';
import { CadastroReforma } from '../features/reforma/CadastroReforma';
import { PainelCarteiraReforma } from '../features/reforma/PainelCarteiraReforma';
import { VerificadorNfse } from '../features/reforma/VerificadorNfse';
import { criarReformaFiscalMock } from '../api/mock/reformaFiscalMock';
import { criarApuracaoConsumoMock } from '../api/mock/apuracaoConsumoMock';
import '../index.css';
import '../App.css';
const api = { ...criarReformaFiscalMock([{ companyId: 'demo', razao: 'Empresa de demonstração', cnpj: '00.000.000/0001-00' }]), ...criarApuracaoConsumoMock() };
function Previa() {
  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
    <p>PRÉVIA LOCAL · Dados fictícios · Sem atos fiscais</p><h1>Preparação para a reforma tributária</h1>
    <PainelCarteiraReforma api={api} competencia="2027-01" />
    <CadastroReforma companyId="demo" api={api} />
    <VerificadorNfse api={api} companyId="demo" competencia="2026-10" />
  </main>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') createRoot(document.getElementById('root')).render(<Previa />);
