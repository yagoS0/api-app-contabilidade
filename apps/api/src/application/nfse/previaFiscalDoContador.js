import { prisma } from '../../infrastructure/db/prisma.js';
import { NFSE_ENV, INTEGRACAO_PERFIL_EMISSAO_NFSE, INTEGRACAO_NFSE_IBSCBS } from '../../config.js';
import { regimeDaCompetencia } from './regimeDaCompetencia.js';
import { resolverPerfilDeEmissao } from './perfilEmissao/resolverPerfilDeEmissao.js';
import { escolherCodigoServicoNacional } from './codigoServicoDaNota.js';
import { resolverContextoFiscalDaNota } from './resolverContextoFiscalDaNota.js';
import { resolverOpSimpNac, resolverTpRetIssqn, RESOLUCAO } from './dpsCodigos.js';
import { pAliqDaDps } from './pAliqDaDps.js';
import { snapshotFiscal } from './snapshotFiscal.js';

// Somente leitura. Usa os resolvedores da emissão, sem reservar DPS, assinar ou consultar o ADN.
// A validação integral do payload e a revalidação fiscal continuam obrigatórias na emissão.
export async function previaFiscalDoContador({ portalClientId, competencia, perfilId = null, servico = {} }, {
  db = prisma, resolverPerfil = resolverPerfilDeEmissao, ambiente = NFSE_ENV,
  perfisHabilitados = INTEGRACAO_PERFIL_EMISSAO_NFSE, ibscbsLigado = INTEGRACAO_NFSE_IBSCBS,
} = {}) {
  const previa = { ok: false, competencia, ambiente, pendencias: [], validacaoIntegral: false };
  const recusar = (codigo, mensagem, correcao) => ({ ...previa, pendencias: [{ codigo, mensagem, correcao }] });
  const portal = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
  if (!portal?.companyId) return recusar('CADASTRO_FISCAL_INDISPONIVEL', 'Cadastro fiscal indisponível.');
  const company = await db.company.findUnique({ where: { id: portal.companyId }, select: {
    regimeHistorico: true, codigoServicoNacional: true, codigosServicoNacional: true,
    codigoMunicipioIbge: true, beneficioMunicipalNumero: true, codigoServicoMunicipal: true,
    rpsSerie: true, pTotTribFed: true, pTotTribEst: true, pTotTribMun: true,
  } });
  if (!company) return recusar('CADASTRO_FISCAL_INDISPONIVEL', 'Cadastro fiscal indisponível.');
  const historico = regimeDaCompetencia({ historico: company.regimeHistorico, competencia });
  if (!historico.ok) return recusar(historico.codigo, historico.message, historico.correcao);
  previa.regimeVigente = historico;
  previa.opcaoIbsCbs = { apuracao: historico.apuracaoIbsCbs, fonte: historico.fonte,
    vigenciaInicio: historico.vigenciaInicio, vigenciaFim: historico.vigenciaFim,
    hibrido: historico.apuracaoIbsCbs === 'REGULAR' && historico.regime === 'SIMPLES' };
  const regimeDps = resolverOpSimpNac(historico.regime);
  if (regimeDps.resolucao !== RESOLUCAO.RESOLVIDO) return recusar('NFSE_REGIME_INDEFINIDO', 'O regime do período não tem correspondência confirmada para emissão de NFS-e.');
  let perfil = null;
  if (!perfisHabilitados && perfilId) return recusar('NFSE_PERFIL_INDISPONIVEL', 'Perfis desabilitados neste ambiente.');
  if (perfisHabilitados) {
    const r = await resolverPerfil({ portalClientId, perfilId, exigirDisponibilidade: true });
    if (typeof r?.temPerfil !== 'boolean' || !Number.isInteger(r.perfisAtivos) || (r.perfisAtivos === 1 && !r.temPerfil)) {
      return recusar('NFSE_PERFIL_INDISPONIVEL', 'Não foi possível conferir os perfis de emissão.');
    }
    if (!perfilId && r.perfisAtivos > 1) return recusar('ESCOLHER_PERFIL_EMISSAO', 'Escolha o perfil de serviço desta nota.');
    if (perfilId && (!r.temPerfil || r.perfil?.id !== perfilId)) return recusar('NFSE_PERFIL_INDISPONIVEL', 'Perfil indisponível nesta empresa.');
    perfil = r.temPerfil ? r.perfil : null;
  }
  previa.perfil = perfil ? { id: perfil.id, nome: perfil.nome, codigoNbs: perfil.codigoNbs,
    ibscbsCIndOp: perfil.ibscbsCIndOp, ibscbsCst: perfil.ibscbsCst, ibscbsCClassTrib: perfil.ibscbsCClassTrib } : null;
  const escolha = escolherCodigoServicoNacional({ escolhido: perfil?.codigoServicoNacional || servico.codigoServicoNacional,
    lista: company.codigosServicoNacional, singular: company.codigoServicoNacional });
  if (!escolha.ok || !escolha.codigo) return recusar('NFSE_CODIGO_SERVICO_PENDENTE', 'Confira o código nacional de serviço no cadastro e no perfil.');
  previa.codigoServico = escolha.codigo;
  const contexto = resolverContextoFiscalDaNota({ company, perfil, regime: historico.regime, competencia,
    codigoServico: escolha.codigo, servico, ibscbsLigado });
  previa.contextoFiscal = contexto;
  previa.configuracaoFiscal = snapshotFiscal({ company, perfil, regime: historico.regime, codigoServico: escolha.codigo,
    ibscbsLigado, contextoFiscal: contexto, regimeVigente: historico });
  if (!contexto.ok) {
    return recusar(contexto.codigo, contexto.message, contexto.correcao);
  }
  const aliquota = perfil?.pAliq ?? servico.aliquota;
  previa.iss = { retido: servico.issRetido === true, fonteAliquota: perfil?.pAliq != null ? 'PERFIL' : 'OPERACAO',
    ...pAliqDaDps({ opSimpNac: regimeDps.opSimpNac, regApTribSN: perfil?.regApTribSN || '1',
      tpRetISSQN: resolverTpRetIssqn(servico.issRetido === true).tpRetISSQN, aliquota }) };
  if (!previa.iss.ok) return recusar(previa.iss.codigo, previa.iss.message || 'Confira a alíquota do ISS retido.');
  return { ...previa, ok: true };
}
