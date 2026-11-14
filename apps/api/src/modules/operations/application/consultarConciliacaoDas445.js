import { projetarOperacoes445, lacunasCruzadas445 } from '../domain/evidenciasConciliacaoDas445.js';

const idValido = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
function validar(input) {
  if (!input || !idValido(input.companyId) || typeof input.competencia !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input.competencia)
    || (input.servico != null && !['GERARDAS12','GERARDASCOBRANCA17'].includes(input.servico))
    || (input.documentoId != null && !idValido(input.documentoId))
    || (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
    throw Object.assign(new Error('Entrada inválida para leitura DAS.'), { code: 'ENTRADA_INVALIDA' });
  }
  return { companyId: input.companyId, competencia: input.competencia, servico: input.servico || null,
    documentoId: input.documentoId || null, limit: input.limit ?? 50 };
}

// All capabilities are read-only. Authorization is outside source error handling: denial is fatal.
export async function consultarConciliacaoDas445(input, ports) {
  const args = validar(input);
  await ports.autorizar(args.companyId);
  const agora = ports.agora ? ports.agora() : new Date();
  const fontes = {};
  async function ler(nome, extra = {}) {
    try {
      fontes[nome] = { ...await ports[nome]({ ...args, agora, ...extra }), consulta: 'ok' };
    } catch {
      fontes[nome] = { consulta: 'falhou', items: null, truncated: null, limit: args.limit,
        lacunas: ['FALHA_DE_LEITURA_SEM_RETENTATIVA'], erro: 'FONTE_INDISPONIVEL' };
    }
  }
  await Promise.all([ler('chamadas'), ler('guias'), ler('circular'), ler('execucoes'), ler('worker')]);
  if (fontes.chamadas.consulta === 'ok') {
    await Promise.all([ler('cache', { chamadas: fontes.chamadas.items }), ler('despachos', { chamadas: fontes.chamadas.items })]);
  } else {
    for (const nome of ['cache','despachos']) fontes[nome] = { consulta: 'nao_consultada', items: null, truncated: null, limit: args.limit, lacunas: ['CHAMADAS_INDISPONIVEIS'] };
  }
  // Legacy unlinked entries can still be inspected when documentary reads fail, without inventing a link.
  await ler('lancamentos', { guias: fontes.guias.items || [] });
  if (fontes.guias.consulta === 'ok') await ler('pagamentos', { guias: fontes.guias.items });
  else fontes.pagamentos = { consulta: 'nao_consultada', items: null, truncated: null, limit: args.limit, lacunas: ['GUIAS_INDISPONIVEIS'] };
  const fiscal = ports.projetarFiscal(fontes);
  const guias = ports.projetarGuias(fontes.guias, fontes.pagamentos);
  const contabilidade = ports.projetarContabilidade(fontes.circular, fontes.lancamentos, fontes.guias);
  const operacoes = projetarOperacoes445(fontes.execucoes, fontes.worker);
  const lacunas = lacunasCruzadas445(fiscal, guias, contabilidade);
  for (const [nome, fonte] of Object.entries(fontes)) {
    if (fonte.consulta !== 'ok') lacunas.push(`FONTE_NAO_VERIFICAVEL:${nome}`);
    if (fonte.truncated) lacunas.push(`RECORTE_TRUNCADO:${nome}`);
  }
  return { contrato: 'conciliacao-das-leitura-4.4.5', ...args, consultadoEm: agora.toISOString(),
    consistencia: 'OBSERVACOES_INDEPENDENTES_SEM_SNAPSHOT_GLOBAL', fiscal, guias, contabilidade, operacoes, lacunas };
}
