// A prévia de vencimentos das duas telas de obrigação — a da empresa e a da regra do escritório.
//
// Ela existe para o contador conferir a configuração VENDO as datas, em vez de reler os campos. Por
// isso ela é literalmente a promessa da tela, e mentir aqui é pior que não mostrar nada.
//
// Estava escrita DUAS vezes, uma em cada componente, com o mesmo defeito nas duas: a janela começa
// no mês corrente e a data desse mês pode já ter passado, então o dia 15 cadastrado no dia 16
// aparecia como "próximo vencimento: 14/08" — no passado — e o backend criava aquela ocorrência,
// que a listagem mostra em vermelho, "Vencida", no instante do cadastro. Numa regra do escritório
// isso acusa atraso na carteira inteira de uma vez.
//
// ⚠ O QUE ESTA CONTA NÃO SABE: FERIADO. Ela roda no navegador e os feriados vivem na tabela
// `Feriado` do servidor (semeada por `apps/api/scripts/semear-feriados.mjs`); os MUNICIPAIS ainda
// dependem do município de cada empresa, e uma regra que pega a carteira inteira não tem uma data
// só que sirva a todas. Quem aplica feriado é `ajustarParaDiaUtil`, no servidor, ao gerar as
// ocorrências. Aqui a resposta é fim de semana — e a tela DIZ isso, em vez de inventar calendário.

/** Último dia do mês (UTC): dia 31 em fevereiro é 28/29, nunca transborda para março. */
function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

const ehFimDeSemana = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Date (UTC) → "YYYY-MM-DD". */
export const paraISO = (d) => d.toISOString().slice(0, 10);

/**
 * @param {object} config  { periodicidade, mesReferencia, diaVencimento, ajusteDiaUtil }
 * @param {Date} hoje      referência (UTC). Parâmetro, e não `new Date()` aqui dentro, para a
 *                         regra ser exercível numa data fixa — é o que permite testar o 16/08.
 * @param {number} quantas quantos vencimentos futuros devolver
 * @returns {{proximas: string[], jaVencida: string|null}}  `jaVencida` é o vencimento do mês
 *   corrente que já passou — informação, nunca prazo. `null` quando não há.
 */
export function calcularPreviaVencimentos(config = {}, hoje = new Date(), quantas = 3) {
  const periodicidade = String(config.periodicidade || "MENSAL").toUpperCase();
  const mesReferencia = Number(config.mesReferencia);
  const diaPedido = Number(config.diaVencimento) || 1;
  const corte = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());

  const datas = [];
  // 13 meses (e não 12) para que a anual cujo mês de referência é o CORRENTE e já venceu ainda
  // tenha o que mostrar: a próxima dela é a do ano que vem.
  for (let i = 0; i < 13 && datas.length < quantas + 1; i += 1) {
    const bruto = hoje.getUTCMonth() + i;
    const ano = hoje.getUTCFullYear() + Math.floor(bruto / 12);
    const mes = (bruto % 12) + 1;
    if (periodicidade === "ANUAL" && mes !== mesReferencia) continue;
    if (periodicidade === "TRIMESTRAL" && (((mes - mesReferencia) % 3) + 3) % 3 !== 0) continue;

    const d = new Date(Date.UTC(ano, mes - 1, Math.min(diaPedido, ultimoDiaDoMes(ano, mes))));
    if (config.ajusteDiaUtil !== "MANTER") {
      const passo = config.ajusteDiaUtil === "POSTERGAR" ? 1 : -1;
      while (ehFimDeSemana(d)) d.setUTCDate(d.getUTCDate() + passo);
    }
    datas.push(d);
  }

  const passada = datas.find((d) => d.getTime() < corte) || null;
  return {
    proximas: datas.filter((d) => d.getTime() >= corte).slice(0, quantas).map(paraISO),
    jaVencida: passada ? paraISO(passada) : null,
  };
}
