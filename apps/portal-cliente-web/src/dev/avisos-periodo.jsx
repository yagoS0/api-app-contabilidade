import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmitirNotaPage } from '../features/emitir/EmitirNotaPage';
import { api } from '../api';
import '../styles/app.css';
if (import.meta.env.PROD || api.mode !== 'mock') throw Error('Demonstração somente local e sintética.');
api.emitirNfse = async () => { throw Error('Emissão desativada nesta demonstração.'); };
api.getSituacaoPeriodo = async (_, competencia) => ({ competencia: competencia.slice(0, 7), estado: 'TRANSMITIDA', exigeRevisao: true, mensagem: 'Demonstração: este período tem declaração transmitida. Confira a receita considerada; poderá ser necessária retificação.' });
api.getPerfisDeEmissao = async () => ({ habilitado: false, data: [], total: 0 });
const empresa = { companyId: 'pc-001', razao: 'Empresa de demonstração', cnpj: '11222333000181', myRole: 'OWNER', emissaoNfseLiberada: true,
 legacyCompany: { regimeTributario: 'SIMPLES_NACIONAL', inscricaoMunicipal: '1234567', codigoServicoNacional: '010101', codigoServicoMunicipal: '1.01', rpsSerie: '1' } };
createRoot(document.getElementById('root')).render(<main style={{ maxWidth: 1100, margin: 'auto', padding: 20 }}><p role="status">Prévia local · dados sintéticos · emissão desativada</p><EmitirNotaPage empresa={empresa} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} /></main>);
