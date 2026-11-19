import { competenciaValida, motivoImpedimentoBackfill, competenciasProtegidasBackfill } from '../domain/backfillDeProvisoes.js';

const erro = code => Object.assign(new Error(code), { code });

export async function executarBackfillDeProvisoes({ portalClientId, competencia, executar = false, logger = console } = {}, portas) {
  if (typeof portalClientId !== 'string' || !portalClientId.trim() || !competenciaValida(competencia)) throw erro('ESCOPO_BACKFILL_OBRIGATORIO');
  if (typeof executar !== 'boolean') throw erro('EXECUCAO_BACKFILL_INVALIDA');
  const candidatas = await portas.listar({ portalClientId, competencia });
  const resultado = { scanned: candidatas.length, ok: 0, fail: 0, skipped: 0, preview: !executar, resultados: [] };
  for (const selecionada of candidatas) {
    if (!executar) {
      resultado.resultados.push({ guideId: selecionada.id, status: 'CANDIDATA_NAO_AUTORIZADA' });
      continue;
    }
    // Um conflito/erro interrompe o comando, sem retry e sem continuar outras guias.
    // Cada guia anterior concluída é um commit independente informado no progresso.
    const item = await portas.emTransacao(async p => {
      await p.bloquear(portalClientId);
      const guia = await p.ler(selecionada.id, portalClientId);
      const motivo = motivoImpedimentoBackfill(guia, selecionada);
      if (motivo) return { guideId: selecionada.id, status: motivo };
      const periodos = competenciasProtegidasBackfill(guia);
      if (!periodos) return { guideId: guia.id, status: 'DATA_CONTABIL_REQUER_REVISAO' };
      for (const periodo of periodos) {
        if (await p.mesFechado(portalClientId, periodo)) return { guideId: guia.id, status: 'MES_FECHADO' };
      }
      const gerado = await p.gerar(guia.id);
      if (!gerado?.ok) throw erro('BACKFILL_GERACAO_FALHOU');
      if (gerado.entries?.some(e => e.action !== 'created')) throw erro('BACKFILL_ESCRITA_INESPERADA');
      return { guideId: guia.id, status: gerado.entries?.length ? 'CRIADA' : 'SEM_PROVISAO', quantidade: gerado.entries?.length || 0 };
    });
    resultado.resultados.push(item);
    if (item.status === 'CRIADA') resultado.ok++;
    else resultado.skipped++;
    logger.info?.(item, 'Backfill supervisionado: resultado confirmado');
  }
  return resultado;
}
