import { documentosPgdas, whereDasSalvo } from '../fiscal/serpro/pgdasDocumentos.js';

// Uma recusa da guarda encerra esta tentativa composta, sem tentar outro serviço.
// Mensagens são locais: não guardar texto livre devolvido por provedores.
export const motivosBloqueioDocumental = {
  SERPRO_EMPRESA_PAUSADA: 'Operações SERPRO pausadas nesta empresa. Confira a configuração de Automação; os documentos salvos foram preservados.',
  SERPRO_POLITICA_INVALIDA: 'Não foi possível conferir a política da empresa. Nenhuma nova busca documental foi autorizada.',
  SERPRO_IDENTIDADE_INVALIDA: 'Não foi possível identificar a empresa para autorizar a consulta. Confira seu cadastro.',
  SERPRO_IDENTIDADE_AMBIGUA: 'Há mais de um cadastro para o contribuinte. Confira a empresa antes de consultar.',
  SERPRO_MEDICAO_INDISPONIVEL: 'Registro de consumo indisponível. A busca documental foi interrompida.',
  SERPRO_REGISTRO_INDETERMINADO: 'Resultado da consulta não confirmado. Confira a tentativa anterior antes de buscar documentos novamente.',
  SERPRO_CHAMADA_EM_ANDAMENTO: 'Existe uma consulta em andamento ou com resultado desconhecido. Confira a tentativa anterior.',
  SERPRO_CHAMADA_REPETIDA: 'Esta consulta foi realizada há pouco. A busca documental foi interrompida para evitar repetição.',
  SERPRO_TETO_DIARIO: 'Limite diário de consultas atingido. A busca documental foi interrompida.',
  SERPRO_TETO_MENSAL_ESCRITORIO: 'Limite mensal de consultas atingido. A busca documental foi interrompida.',
};

export async function completarDocumentosOperacao(db, { portalClientId, competencia, indiceExistente }, deps = {}) {
  const read = async () => {
    const [circular, guide] = await Promise.all([
      db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } }),
      db.guide.findFirst({ where: whereDasSalvo(portalClientId, competencia) }),
    ]);
    return documentosPgdas(circular, guide);
  };
  const before = await read(), out = { extrato: { ok: before.extrato, reutilizado: before.extrato }, guia: { ok: before.das, reutilizado: before.das } };
  const interromper = async error => {
    const reason = motivosBloqueioDocumental[error?.code];
    if (!reason) return false;
    const current = await read();
    for (const [key, exists] of [['extrato', current.extrato], ['guia', current.das]]) {
      out[key] = exists ? { ok: true, reutilizado: key === 'extrato' ? before.extrato : before.das }
        : { ok: false, skipped: true, code: error.code, reason };
    }
    return true;
  };
  if (before.extrato && before.das) return out;
  if (!before.extrato) {
    try {
      const sync = deps.sync || (await import('../fiscal/serpro/SerproPgdasDeclaracaoService.js')).syncPgdasByCompetencia;
      await sync({ portalClientId, competencia, indiceExistente, somenteDocumentos: true });
      out.extrato = { ok: (await read()).extrato };
      if (!out.extrato.ok) out.extrato.skipped = true;
    } catch (error) {
      if (await interromper(error)) return out;
      out.extrato = { skipped: true, reason: 'Extrato não confirmado. Confira os documentos da empresa.' };
    }
  }
  if ((await read()).das) out.guia = { ok: true, reutilizado: before.das };
  else {
    try {
      const capture = deps.capture || (await import('../fiscal/serpro/CaptureSerproGuidesService.js')).capturePgdasGuideForCompany;
      await capture({ portalClientId, competencia, somenteDocumentos: true });
      out.guia = { ok: (await read()).das };
      if (!out.guia.ok) out.guia.skipped = true;
    } catch (error) {
      if (await interromper(error)) return out;
      out.guia = { skipped: true, reason: 'DAS não confirmado. Confira os documentos da empresa.' };
    }
  }
  return out;
}
