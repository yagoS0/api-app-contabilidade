import { calcularVencimentos } from './gerarOcorrencias.js';
import { aplicarJanela, janelaDoCiclo, cicloDaOcorrencia, cicloPermitido, regraDoCiclo } from './agendaSerie.js';

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
  const preverCiclo = ciclo => {
    const [ano, mes] = ciclo.split('-').map(Number);
    return calcularVencimentos(regraDoCiclo(serie, ciclo), { inicio: { ano, mes }, quantidadeMeses: 1 }, ehFeriado)
      .map(p => aplicarJanela(p, janelaDoCiclo(serie, ciclo)))[0];
  };
  const primeiroCiclo = hoje.toISOString().slice(0, 7);
  // Fora da nova frequência não é cancelamento: mantém ID/histórico e pode voltar em outra versão.
  for (const oc of existentes) {
    const ciclo = cicloDaOcorrencia(oc, serie);
    if (ciclo < primeiroCiclo || oc.status !== 'PENDENTE' || oc.canceladaEm || oc.janelaPersonalizada) continue;
    const previsao = preverCiclo(ciclo);
    if (!previsao) {
      if (!oc.foraDaRecorrencia) await db.ocorrenciaObrigacao.update({ where: { id: oc.id }, data: { foraDaRecorrencia: true } });
    } else if (cicloPermitido(serie, ciclo)) {
      const mesma = !oc.foraDaRecorrencia && oc.cicloChave === ciclo && oc.competenciaRef === previsao.competenciaRef
        && ['dataInicio', 'dataFim'].every(k => Number(oc[k]) === Number(previsao[k])) && Number(oc.dataVencimento) === Number(previsao.data);
      if (!mesma) await db.ocorrenciaObrigacao.update({ where: { id: oc.id }, data: {
        foraDaRecorrencia: false, cicloChave: ciclo, dataInicio: previsao.dataInicio, dataFim: previsao.dataFim,
        dataVencimento: previsao.data, competenciaRef: previsao.competenciaRef,
      } });
    }
  }
  const previstas = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(inicio.ano, inicio.mes - 1 + i, 1)).toISOString().slice(0, 7))
    .map(preverCiclo).filter(Boolean)
    .filter(p => cicloPermitido(serie, p.mesVencimento))
    .filter(p => incluirVencidoDoMes || p.data >= hoje || p.dataFim >= hoje).slice(0, 12);
  let criadas = 0;
  for (const p of previstas) {
    const anterior = porCiclo.get(p.mesVencimento);
    if (!anterior) {
      const out = await db.ocorrenciaObrigacao.createMany({ data: [{ obrigacaoId: serie.id,
        cicloChave: p.mesVencimento, dataInicio: p.dataInicio, dataFim: p.dataFim,
        dataVencimento: p.data, competenciaRef: p.competenciaRef, status: 'PENDENTE' }], skipDuplicates: false });
      criadas += out.count;
    }
  }
  return { criadas, removidas: 0 };
}
