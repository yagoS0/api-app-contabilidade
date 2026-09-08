export const chaveDoEvento = (item) => `${item.tipo}|${item.id}`;
export const ehTarefa = (item) => item.tipo === "tarefa" || item.natureza === "TAREFA";
export const inicioDoEvento = (item) => (item.dataInicio || item.data || "").slice(0, 10);
export const fimDoEvento = (item) => (item.dataFim || item.data || "").slice(0, 10);
export const temIntervalo = (item) => inicioDoEvento(item) < fimDoEvento(item);
export const eventosUnicos = (itens) => [...new Map(itens.map((item) => [chaveDoEvento(item), item])).values()];
const dataLegivel = (data) => data.split("-").reverse().join("/");
export const periodoDoEvento = (item) => temIntervalo(item)
  ? `${dataLegivel(inicioDoEvento(item))} – ${dataLegivel(fimDoEvento(item))}`
  : dataLegivel(inicioDoEvento(item));

/** Navegação civil: 31 de janeiro deve chegar em fevereiro, sem estourar para março. */
export function deslocarMes(referencia, passo) {
  const [ano, mes] = referencia.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 + passo, 1)).toISOString().slice(0, 10);
}

/** Um segmento por semana e identidade; alocação estável em faixas sem sobreposição. */
export function segmentosDaSemana(semana, porDia) {
  const primeiro = semana[0].data;
  const ultimo = semana[semana.length - 1].data;
  const itens = eventosUnicos(semana.flatMap((dia) => porDia[dia.data] || []))
    .filter(temIntervalo)
    .sort((a, b) => inicioDoEvento(a).localeCompare(inicioDoEvento(b))
      || fimDoEvento(b).localeCompare(fimDoEvento(a)) || chaveDoEvento(a).localeCompare(chaveDoEvento(b)));
  const ocupacao = [];
  return itens.map((item) => {
    const inicio = inicioDoEvento(item);
    const fim = fimDoEvento(item);
    const colunaInicio = Math.max(0, semana.findIndex((dia) => dia.data >= inicio));
    const colunaFim = fim >= ultimo ? semana.length - 1 : semana.findIndex((dia) => dia.data === fim);
    let linha = ocupacao.findIndex((ate) => ate < colunaInicio);
    if (linha < 0) linha = ocupacao.length;
    ocupacao[linha] = colunaFim;
    return { item, colunaInicio, colunaFim, linha, continuaAntes: inicio < primeiro, continuaDepois: fim > ultimo };
  });
}

/** Agenda preserva uma linha por ocorrência mesmo quando ela atravessa todos os dias do mês. */
export function agendaDoMes(competencia, porDia) {
  const vistos = new Set();
  return Object.entries(porDia).filter(([data]) => data.startsWith(competencia)).sort(([a], [b]) => a.localeCompare(b))
    .map(([data, itens]) => ({ data, dia: Number(data.slice(8)), itens: itens.filter((item) => {
      const chave = chaveDoEvento(item);
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    }) })).filter((dia) => dia.itens.length);
}
