import { documentosPgdas, whereDasSalvo } from '../fiscal/serpro/pgdasDocumentos.js';
import { comContextoSerpro, contextoSerproAtual } from '../fiscal/serpro/serproCallContext.js';

const documentIdentity = circular => ({ id: circular?.id || null, portalClientId: circular?.portalClientId || null,
  competencia: circular?.competencia || null, numeroDeclaracao: circular?.pgdasNumeroDeclaracao || null,
  declaracaoFileId: circular?.pgdasDeclaracaoFileId || null, reciboFileId: circular?.pgdasReciboFileId || null });

// Uma recusa da guarda encerra esta tentativa composta, sem tentar outro serviço.
// Mensagens são locais: não guardar texto livre devolvido por provedores.
export const motivosBloqueioDocumental = {
  CICLO_FISCAL_PAUSADO: 'Ciclo fiscal pausado. Documentos salvos preservados; nenhuma próxima busca autorizada.',
  CICLO_FISCAL_INDISPONIVEL: 'Pausa do ciclo indisponível. Busca documental interrompida.',
  CICLO_FISCAL_REVISAO_ALTERADA: 'A política do ciclo mudou. Confira os documentos antes de continuar.',
  CICLO_FISCAL_HORARIO_ANTERIOR: 'Esta tentativa é anterior à retomada. Busca documental interrompida.',
  AUTOMACAO_EMPRESA_PAUSADA: 'Automação empresarial pausada. Documentos salvos preservados.',
  AUTOMACAO_EMPRESA_INDISPONIVEL: 'Não foi possível conferir a automação empresarial. Busca interrompida.',
  AUTOMACAO_EMPRESA_REVISAO_ALTERADA: 'A automação empresarial mudou. Busca documental interrompida.',
  AUTOMACAO_EMPRESA_HORARIO_ANTERIOR: 'Tentativa anterior à retomada empresarial. Busca interrompida.',
  AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL: 'Liberação não confirmada no despacho. Confira os resultados.',
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
    const reason = motivosBloqueioDocumental[error?.code] || (/^(CICLO_FISCAL_|AUTOMACAO_EMPRESA_)/.test(error?.code || '') ? 'Verificação automática bloqueada. Nenhuma próxima busca documental autorizada.' : null);
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
      const snapshot = await db.apuracaoSnapshot?.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } });
      const transmitted = snapshot?.estado === 'transmitida' && Boolean(snapshot.numeroDeclaracao);
      const previous = documentIdentity(await db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } }));
      // A consulta anterior à transmissão pode ter retornado ausência. Só a entrega
      // persistida permite atualizar esse índice; reservas incertas continuam bloqueadas.
      const result = await comContextoSerpro({ ...contextoSerproAtual(), ...(transmitted ? { atualizar: true, reconsultarAposTransmissao: true } : {}) },
        () => sync({ portalClientId, competencia, indiceExistente, somenteDocumentos: true }));
      out.extrato = { ok: (await read()).extrato };
      if (!out.extrato.ok) out.extrato.skipped = true;
      if (out.extrato.ok && !previous.numeroDeclaracao && contextoSerproAtual().registrarEvolucaoDocumental) {
        await contextoSerproAtual().registrarEvolucaoDocumental({ before: previous, result });
      }
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
