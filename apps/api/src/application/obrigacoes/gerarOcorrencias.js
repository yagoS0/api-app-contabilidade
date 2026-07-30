// Geração das datas de vencimento de uma obrigação.
//
// Função PURA de propósito: recebe a configuração e devolve datas. Sem Prisma, sem `new Date()`
// implícito — quem chama diz de quando parte. É o que permite testar a regra do dia 31 em
// fevereiro e o ajuste de dia útil sem banco no meio.

import { ajustarParaDiaUtil, paraISO } from "./diaUtil.js";

export const PERIODICIDADES = ["MENSAL", "TRIMESTRAL", "ANUAL"];
export const AJUSTES_DIA_UTIL = ["ANTECIPAR", "POSTERGAR", "MANTER"];

/** Último dia do mês (UTC). Fevereiro devolve 28 ou 29 conforme o ano. */
export function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Os meses que a obrigação ocupa, dentro da janela pedida.
 *
 * @param {"MENSAL"|"TRIMESTRAL"|"ANUAL"} periodicidade
 * @param {number|null} mesReferencia  1–12. Obrigatório em TRIMESTRAL (1º mês do ciclo) e ANUAL.
 * @param {{ano: number, mes: number}} inicio  primeiro mês da janela
 * @param {number} quantidadeMeses  tamanho da janela
 */
export function mesesDaJanela(periodicidade, mesReferencia, inicio, quantidadeMeses) {
  const p = String(periodicidade || "").toUpperCase();
  if (!PERIODICIDADES.includes(p)) {
    throw new Error(`periodicidade_invalida: ${periodicidade}`);
  }
  // TRIMESTRAL e ANUAL sem mês de referência não têm resposta certa. Assumir janeiro produziria
  // uma agenda plausível e errada — o tipo de defeito que ninguém nota. Falha alto, aqui mesmo.
  if (p !== "MENSAL" && !(mesReferencia >= 1 && mesReferencia <= 12)) {
    throw new Error(`mes_referencia_obrigatorio_para_${p.toLowerCase()}`);
  }

  const meses = [];
  for (let i = 0; i < quantidadeMeses; i += 1) {
    const bruto = inicio.mes - 1 + i;
    const ano = inicio.ano + Math.floor(bruto / 12);
    const mes = (bruto % 12) + 1;
    if (p === "MENSAL") meses.push({ ano, mes });
    else if (p === "ANUAL" && mes === mesReferencia) meses.push({ ano, mes });
    else if (p === "TRIMESTRAL" && ((mes - mesReferencia) % 3 + 3) % 3 === 0) meses.push({ ano, mes });
  }
  return meses;
}

/** Recua `meses` a partir de {ano, mes} e devolve "YYYY-MM". Aritmética pura, sem `Date`. */
export function competenciaComDefasagem(ano, mes, defasagemMeses) {
  const bruto = (ano * 12 + (mes - 1)) - Math.max(0, Number(defasagemMeses) || 0);
  return `${Math.floor(bruto / 12)}-${String((bruto % 12) + 1).padStart(2, "0")}`;
}

/**
 * Datas de vencimento da obrigação na janela.
 *
 * @param {object} obrigacao  { periodicidade, mesReferencia, diaVencimento, ajusteDiaUtil, defasagemMeses }
 * @param {object} janela     { inicio: {ano, mes}, quantidadeMeses }
 * @param {(iso: string) => boolean} ehFeriado
 * @returns {Array<{ mesVencimento: string, competenciaRef: string, data: Date, iso: string }>}
 */
export function calcularVencimentos(obrigacao, janela, ehFeriado = () => false) {
  const meses = mesesDaJanela(
    obrigacao.periodicidade,
    obrigacao.mesReferencia,
    janela.inicio,
    janela.quantidadeMeses,
  );

  const diaPedido = Number(obrigacao.diaVencimento);
  if (!(diaPedido >= 1 && diaPedido <= 31)) {
    throw new Error(`dia_vencimento_invalido: ${obrigacao.diaVencimento}`);
  }

  return meses.map(({ ano, mes }) => {
    // Dia 31 em fevereiro vira o ÚLTIMO dia de fevereiro, não 2 ou 3 de março. Deixar o Date
    // transbordar jogaria o vencimento para o mês seguinte — mudando a competência do prazo.
    const dia = Math.min(diaPedido, ultimoDiaDoMes(ano, mes));
    const bruta = new Date(Date.UTC(ano, mes - 1, dia));
    const data = ajustarParaDiaUtil(bruta, obrigacao.ajusteDiaUtil, ehFeriado);
    return {
      // O mês em que VENCE e a competência a que o serviço SE REFERE são coisas distintas, e
      // confundi-las faria o verificador olhar o mês errado.
      mesVencimento: `${ano}-${String(mes).padStart(2, "0")}`,
      competenciaRef: competenciaComDefasagem(ano, mes, obrigacao.defasagemMeses ?? 1),
      data,
      iso: paraISO(data),
    };
  });
}

/** Data do lembrete: N dias corridos antes do vencimento (não é prazo legal, é aviso interno). */
export function dataDoLembrete(vencimento, antecedenciaDias) {
  const d = new Date(vencimento.getTime());
  d.setUTCDate(d.getUTCDate() - Math.max(0, Number(antecedenciaDias) || 0));
  return d;
}
