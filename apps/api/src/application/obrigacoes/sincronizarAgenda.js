import { calcularVencimentos } from './gerarOcorrencias.js';
import { aplicarJanela, janelaDoCiclo, cicloDaOcorrencia, cicloPermitido } from './agendaSerie.js';

// Chamador mantém lock da série na transação: cancelamento e geração não podem se cruzar.
export async function sincronizarAgenda(db, serie, { hoje, ehFeriado, incluirVencidoDoMes = false }) {
  const inicio = { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 };
  const existentes = await db.ocorrenciaObrigacao.findMany({ where: { obrigacaoId: serie.id } });
  const porCiclo = new Map();
  for (const oc of existentes) {
    const ciclo = cicloDaOcorrencia(oc, serie);
    // Legados ambíguos continuam todos no histórico; um deles já impede gerar outra cópia.
    if (!porCiclo.has(ciclo)) porCiclo.set(ciclo, oc);
  }
  const previstas = calcularVencimentos(serie, { inicio, quantidadeMeses: 24 }, ehFeriado)
    .map(p => aplicarJanela(p, janelaDoCiclo(serie, p.mesVencimento)))
    .filter(p => cicloPermitido(serie, p.mesVencimento))
    .filter(p => incluirVencidoDoMes || p.data >= hoje || p.dataFim >= hoje).slice(0, 12);
  let criadas = 0;
  for (const p of previstas) {
    const anterior = porCiclo.get(p.mesVencimento);
    if (anterior) {
      if (anterior.status !== 'PENDENTE' || anterior.canceladaEm || anterior.janelaPersonalizada) continue;
      await db.ocorrenciaObrigacao.update({ where: { id: anterior.id }, data: {
        cicloChave: p.mesVencimento, dataInicio: p.dataInicio, dataFim: p.dataFim,
        dataVencimento: p.data, competenciaRef: p.competenciaRef,
      } });
    } else {
      const out = await db.ocorrenciaObrigacao.createMany({ data: [{ obrigacaoId: serie.id,
        cicloChave: p.mesVencimento, dataInicio: p.dataInicio, dataFim: p.dataFim,
        dataVencimento: p.data, competenciaRef: p.competenciaRef, status: 'PENDENTE' }], skipDuplicates: true });
      criadas += out.count;
    }
  }
  return { criadas, removidas: 0 };
}
