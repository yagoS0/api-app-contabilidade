import { Button } from '../components/ui/Button';
import { GuiaEmissaoLink } from '../features/companies/detail/components/GuiaEmissaoLink';
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorPerfilEmissao } from '../features/companies/detail/components/EditorPerfilEmissao';
import { ParametrosMunicipais } from '../features/companies/detail/components/ParametrosMunicipais';
import { EmitirNfseWizard } from '../features/notas/components/EmitirNfseWizard';
import { NBS } from '../../../api/src/application/fiscal/nbs/nbs.data';
import { TABELAS_RTC } from '../../../api/src/application/fiscal/ibscbs/tabelasRtc.data';
import '../index.css';
import '../App.css';
import '../features/companies/detail/components/emissao-nfse.css';

// Entrada exclusivamente local: catálogos versionados e os mesmos componentes do
// contador. Nenhum método desta API chama a rede, persiste dados ou emite NFS-e.
const perfilInicial = { id: 'perfil-demo', nome: 'Gestão de campanhas e tráfego pago', ativo: true, padrao: true,
  cLocPrestacao: '3304557', categoriaObrigacaoIbscbs: 'SERVICO_ISS',
  codigoServicoNacional: '170601', codigoServicoMunicipal: '001', codigoNbs: '1.1406.11.00',
  ibscbsCIndOp: '100301', ibscbsCst: '000', ibscbsCClassTrib: '000001', regApTribSN: '1', tribISSQN: '1' };
const sugestoes = { fonte: 'Catálogos versionados — demonstração local',
  nbs: NBS.filter(n => n.codigo.replace(/\D/g, '').length === 9),
  tabelasRtc: { ...TABELAS_RTC, classificacoes: TABELAS_RTC.classificacoes.filter(c => c.nfse) },
  porServico: [{ codigo: '170601', descricao: 'Propaganda e publicidade, planejamento de campanhas publicitárias', nbs: NBS.filter(n => n.codigo === '1.1406.11.00'), combinacoes: [] }] };
const semConsultaExterna = async () => ({ ok: false, status: 404 });
function Verificacao() {
  const [perfil, setPerfil] = useState(perfilInicial);
  const [emitindo, setEmitindo] = useState(false);
  const api = useMemo(() => ({
    getPerfisEmissao: async () => ({ integracaoLigada: true, perfis: [perfil] }),
    previaEmissaoNfse: async (_, entrada) => ({ ok: true, pendencias: [], demonstracao: true,
      competencia: entrada.competencia, perfil, codigoServico: perfil.codigoServicoNacional,
      regimeVigente: { regime: 'SIMPLES', vigenciaInicio: '2025-01-14' },
      configuracaoFiscal: { perfil }, iss: { ok: true, informar: false, retido: false },
      contextoFiscal: { ibscbs: { ok: true, informar: true } } }),
    getParametrosMunicipais: async () => ({ demonstracao: true, habilitado: true, municipio: '3304557', servicos: ['170601'], consultas: [] }),
    consultarParametrosMunicipais: async () => { throw new Error('Consulta externa desativada nesta demonstração.'); },
  }), [perfil]);
  return <main className="nfse-settings" style={{ maxWidth: 1000, margin: 'auto', padding: 24 }}>
    <GuiaEmissaoLink />
    <p role="status" style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 24px' }}>PRÉVIA LOCAL · Dados de demonstração · Emissão desativada</p>
    <EditorPerfilEmissao dados={{ perfis: [perfil], sugestoes }} podeEditar onSalvar={async (_, corpo) => setPerfil({ ...perfil, ...corpo })} />
    <details className="nfse-section nfse-municipal-disclosure"><summary>Consultar parâmetros municipais de ISS</summary><ParametrosMunicipais companyId="demo" api={api} podeConsultar /></details>
    <div className="nfse-preview-actions"><Button type="button" onClick={() => setEmitindo(true)}>Verificar fluxo até a conferência</Button></div>
    {emitindo && <EmitirNfseWizard companyId="demo" regime="SIMPLES" codigoMunicipioIbge="3304557" apiPerfis={api}
      cadastroEmissao={{ cnpj: '39254243000191', inscricaoMunicipal: '12345678', codigoServicoNacional: '170601', codigoServicoMunicipal: '001', rpsSerie: '00001' }}
      valoresIniciais={{ tomador: { cnpjCpf: '12345678000199', nome: 'Tomador de demonstração' }, servico: { descricao: 'Gestão de campanhas de anúncios e tráfego pago', valorServicos: '1,00' } }}
      fetchCnpj={semConsultaExterna} onClose={() => setEmitindo(false)} onEmitir={async () => { throw new Error('Emissão desativada na verificação local.'); }} />}
  </main>;
}
if (import.meta.env.DEV && import.meta.env.VITE_API_MODE === 'mock') createRoot(document.getElementById('root')).render(<Verificacao />);
