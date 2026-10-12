import { createHash } from 'node:crypto';
import { BASES_PARAMETROS } from './parametrosMunicipaisClient.js';
import { diaFiscal } from './regimeDaCompetencia.js';

// ResultadoConsultaConfiguracoesConvenio não possui datas de vigência.
// Não converter aderenteEmissorNacional, aderenteAmbienteNacional ou créditos em permissão de dedução.
export function conferirConvenioMunicipal({ consultas = [], companyId, ambiente, municipio, competencia }) {
  const base = { estado: 'PENDENTE', vigenciaComprovada: false, permissoesComprovadas: false,
    pendencias: ['CONVENIO_POR_COMPETENCIA', 'ADMISSAO_AJUSTES_POR_COMPETENCIA'], observacoes: [] };
  if (!companyId || !BASES_PARAMETROS[ambiente] || !/^\d{7}$/.test(municipio || '') || !diaFiscal(competencia)) return { ...base, motivo: 'ESCOPO_INVALIDO' };
  const registros = consultas.filter(r => r.companyId === companyId && r.ambiente === ambiente && r.municipio === municipio
    && r.recurso === 'convenio' && r.caminho === `/${municipio}/convenio` && r.origem === BASES_PARAMETROS[ambiente]
    && r.status === 'RECEBIDO_PARA_CONFERENCIA' && r.httpStatus === 200);
  if (!registros.length) return { ...base, motivo: 'CONVENIO_NAO_CONSULTADO' };
  const campos = ['aderenteAmbienteNacional', 'aderenteEmissorNacional', 'situacaoEmissaoPadraoContribuintesRFB', 'aderenteMAN'];
  for (const r of registros) {
    const p = r.resposta?.parametrosConvenio;
    if (!p || typeof p !== 'object' || Array.isArray(p) || campos.some(k => ![-1, 0, 1].includes(p[k]))) return { ...base, motivo: 'CONVENIO_CONTRATO_NAO_RECONHECIDO', observacoes: [] };
    base.observacoes.push({ referencia: r.id, consultadoEm: r.concluidaEm || null,
      sha256: createHash('sha256').update(JSON.stringify(r.resposta)).digest('hex'),
      parametros: Object.fromEntries(campos.map(k => [k, p[k]])) });
  }
  const valores = new Set(base.observacoes.map(o => JSON.stringify(o.parametros)));
  return { ...base, motivo: valores.size > 1 ? 'CONVENIO_RESPOSTAS_DIVERGENTES' : 'CONTRATO_ADN_SEM_VIGENCIA_E_PERMISSOES' };
}
