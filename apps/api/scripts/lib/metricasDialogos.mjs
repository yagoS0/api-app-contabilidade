import { precoDoModelo, somarUsage } from '../../src/application/assistente/precosIa.js';

export function metricasDialogos(resultados, modelo = 'gpt-5.4-mini') {
  const soma = (xs, campo) => xs.reduce((s, x) => s + x[campo], 0);
  const medir = xs => {
    const custos = xs.map(x => x.custoUsd).sort((a, b) => a - b);
    const tempos = xs.flatMap(x => x.turnos.flatMap(t => t.modelo || []).map(m => m.ms)).filter(Number.isFinite).sort((a, b) => a - b);
    const total = soma(xs, 'custoUsd'), media = xs.length ? total / xs.length : null;
    const usos = xs.flatMap(x => x.turnos.flatMap(t => t.modelo || []).map(m => m.usage)).filter(Boolean);
    const tokens = somarUsage(usos), preco = precoDoModelo(modelo);
    const semCache = usos.length ? ((tokens.input_tokens + tokens.cache_read_input_tokens) * preco.entrada + tokens.output_tokens * preco.saida + tokens.cache_creation_input_tokens * preco.cacheEscrita) / 100_000_000 : null;
    return { execucoes: xs.length, concluidos: xs.filter(x => x.concluido).length, aprovados: xs.filter(x => x.passou).length,
      custoTotalUsd: total, custoMedioPorLeadUsd: media, custoMaximoUsd: custos.at(-1) ?? null, custoP95Usd: custos[Math.ceil(custos.length * .95) - 1] ?? null,
      chamadas: soma(xs, 'chamadas'), chamadasMedias: xs.length ? soma(xs, 'chamadas') / xs.length : null,
      latenciaMediaModeloMs: tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null,
      latenciaP95ModeloMs: tempos[Math.ceil(tempos.length * .95) - 1] ?? null,
      chamadasComUsoConhecido: usos.length, tokens,
      custoTokensConhecidosSemCacheUsd: semCache,
      mediaSemCacheUsd: semCache !== null && usos.length === soma(xs, 'chamadas') ? semCache / xs.length : null,
      projecao100LeadsUsd: media === null ? null : media * 100, projecao1000LeadsUsd: media === null ? null : media * 1000 };
  };
  return { geral: medir(resultados), porGrupo: Object.fromEntries([...new Set(resultados.map(x => x.grupo))].map(g => [g, medir(resultados.filter(x => x.grupo === g))])) };
}
