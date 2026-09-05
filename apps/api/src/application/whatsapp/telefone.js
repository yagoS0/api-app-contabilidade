// Telefone brasileiro → E.164, e a comparação que o webhook precisa.
//
// ⚠ POR QUE ISTO NÃO É `replace(/\D/g,"")` E PRONTO
// A Meta devolve o `wa_id` do remetente, e no Brasil ele NEM SEMPRE bate dígito a dígito com o
// número que o cliente informou. Celulares brasileiros ganharam o nono dígito em 2012, e a base da
// Meta guarda muitos contatos ainda no formato de 8 dígitos: um contato cadastrado como
// `5521999998888` pode chegar no webhook como `552199998888`. Comparar as strings cruas faz a
// mensagem recebida não encontrar o contato — e ela cai em "não vinculados" sem motivo aparente.
//
// Por isso são DUAS funções: uma que normaliza para gravar, outra que compara tolerando o 9.

const DDI_BR = "55";

/** Só os dígitos. */
const digitos = (v) => String(v || "").replace(/\D+/g, "");

/**
 * O MESMO `digitos` deste arquivo, exportado.
 *
 * ⚠ Existe para que `vinculoTelefone.js` compare números pela MESMA leitura de "só os dígitos" que
 * a normalização usa. Uma segunda regex lá divergiria no primeiro formato novo — e divergir na
 * comparação de telefone é a diferença entre achar a empresa certa e achar outra.
 */
export const somenteDigitos = digitos;

/**
 * Normaliza para E.164 (sem o `+`, que é o formato que a Cloud API espera no campo `to`).
 *
 * Aceita o que o contador digita: "(21) 99999-8888", "21999998888", "5521999998888".
 * Devolve `null` quando não dá para afirmar que é um telefone — melhor recusar no cadastro do que
 * gravar lixo e descobrir na hora do envio.
 */
/**
 * ⚠⚠ POR QUE O NÚMERO FOI RECUSADO — o motivo, não só o `null` (05/09/2026).
 *
 * `normalizarE164` devolve `null` para tudo que recusa, e "não é telefone" é a resposta certa para
 * coisas MUITO diferentes: campo vazio, número curto, e — o caso que motivou isto — o **zero de
 * operadora** (`021 99999-8888`), que é como meio Brasil escreve DDD.
 *
 * ⚠ O DEFEITO MEDIDO: até hoje, qualquer coisa com 12 a 15 dígitos e sem `+` era aceita como
 * "estrangeiro com DDI digitado solto". `021999998888` tem 12 dígitos, virava destino válido, a
 * Meta aceitava, devolvia wamid, e a mensagem ia para o vácuo. A tela ainda CONFIRMAVA o erro:
 * *"será gravado como +021999998888"*.
 *
 * ⚠ ESTRANGEIRO AGORA EXIGE O `+`, e isso não é aperto arbitrário: o `+` é o único desambiguador
 * de DDI, como o cabeçalho deste arquivo já defendia para o caso dos 11 dígitos. Sem ele, "12 a 15
 * dígitos" não distingue um número de outro país de um número brasileiro digitado errado — e a
 * segunda hipótese é ordens de grandeza mais provável na carteira de um escritório de contabilidade.
 */
export const RECUSA_TELEFONE = Object.freeze({
  VAZIO: "VAZIO",
  /** Começa com `0`: nenhum DDI do mundo começa com zero. É o zero de operadora. */
  ZERO_DE_OPERADORA: "ZERO_DE_OPERADORA",
  /** Curto demais para ser telefone com DDD. */
  CURTO: "CURTO",
  /** 12+ dígitos sem `+`: pode ser estrangeiro, pode ser brasileiro com um dígito a mais. */
  LONGO_SEM_MAIS: "LONGO_SEM_MAIS",
  /** Fora de qualquer forma reconhecida. */
  FORA_DE_FORMA: "FORA_DE_FORMA",
});

export const FRASE_RECUSA_TELEFONE = Object.freeze({
  [RECUSA_TELEFONE.VAZIO]: "Informe o telefone com DDD.",
  [RECUSA_TELEFONE.ZERO_DE_OPERADORA]:
    "Tire o zero da frente do DDD: digite 21 99999-8888, não 021 99999-8888.",
  [RECUSA_TELEFONE.CURTO]: "Faltam dígitos: informe DDD + número (10 ou 11 dígitos).",
  [RECUSA_TELEFONE.LONGO_SEM_MAIS]:
    "Número com dígitos demais para um telefone brasileiro. Se for de outro país, comece com + e o "
    + "código do país; se for do Brasil, confira se não sobrou um dígito.",
  [RECUSA_TELEFONE.FORA_DE_FORMA]: "Este número não está numa forma reconhecida.",
});

/**
 * A leitura completa: o número e o motivo da recusa. `normalizarE164` é o atalho que devolve só o
 * número.
 *
 * ⚠ O contrato de `normalizarE164` NÃO mudou (continua `string | null`) — sete chamadores dependem
 * dele, e trocar o retorno por objeto seria mexer em todos por causa de uma mensagem de tela.
 */
export function lerTelefone(entrada) {
  const bruto = String(entrada || "").trim();
  const d = digitos(bruto);
  if (!d) return { e164: null, motivo: RECUSA_TELEFONE.VAZIO };

  const temMaisExplicito = bruto.startsWith("+");
  if (temMaisExplicito) {
    if (d.startsWith("0")) return { e164: null, motivo: RECUSA_TELEFONE.ZERO_DE_OPERADORA };
    if (d.length < 8) return { e164: null, motivo: RECUSA_TELEFONE.CURTO };
    if (d.length > 15) return { e164: null, motivo: RECUSA_TELEFONE.FORA_DE_FORMA };
    return { e164: d, motivo: null };
  }

  // ⚠ O zero de operadora é conferido ANTES do comprimento: `021999998888` tem 12 dígitos e caía
  // no ramo "estrangeiro". Dizer "tire o zero" é o conserto; "número inválido" manda procurar erro
  // onde não há.
  if (d.startsWith("0")) return { e164: null, motivo: RECUSA_TELEFONE.ZERO_DE_OPERADORA };

  if (d.startsWith(DDI_BR) && (d.length === 12 || d.length === 13)) return { e164: d, motivo: null };
  if (d.length === 10 || d.length === 11) return { e164: DDI_BR + d, motivo: null };
  if (d.length < 10) return { e164: null, motivo: RECUSA_TELEFONE.CURTO };
  return { e164: null, motivo: RECUSA_TELEFONE.LONGO_SEM_MAIS };
}

export function normalizarE164(entrada) {
  return lerTelefone(entrada).e164;
}

/** Formata para leitura: `5521999998888` → `+55 (21) 99999-8888`. */
export function formatarTelefone(e164) {
  const d = digitos(e164);
  if (d.startsWith(DDI_BR) && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
    const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);
    return `+55 (${ddd}) ${meio}-${fim}`;
  }
  // ⚠⚠ NÃO LEGITIMAR LIXO COM UM `+`. Isto devolvia `+021999998888` — que tem cara de número
  // internacional válido — e a tela o exibia em *"será gravado como…"*, CONFIRMANDO o erro a quem
  // cadastrava. Nenhum DDI do mundo começa com zero, e fora de 8 a 15 dígitos não é E.164.
  if (!d || d.startsWith("0") || d.length < 8 || d.length > 15) return "";
  return "+" + d;
}

/**
 * As formas em que o MESMO número brasileiro pode chegar da Meta — com e sem o nono dígito.
 *
 * Usada pelo webhook para achar o contato: em vez de uma comparação que falha em silêncio, uma
 * busca `in` com as duas variantes.
 */
export function variantesE164(e164) {
  const d = digitos(e164);
  if (!d) return [];
  const fora = new Set([d]);

  if (d.startsWith(DDI_BR)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    // 9 dígitos começando com 9 → também a forma antiga, sem ele.
    if (resto.length === 9 && resto.startsWith("9")) fora.add(`${DDI_BR}${ddd}${resto.slice(1)}`);
    // 8 dígitos → também a forma nova, com o 9 na frente.
    if (resto.length === 8) fora.add(`${DDI_BR}${ddd}9${resto}`);
  }
  return [...fora];
}
