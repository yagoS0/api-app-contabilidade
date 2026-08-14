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
export function normalizarE164(entrada) {
  const bruto = String(entrada || "").trim();
  const d = digitos(bruto);
  if (!d) return null;

  // ⚠ O `+` DESAMBIGUA, e sem ele não há como decidir.
  //
  // "14155552671" tem 11 dígitos — exatamente o formato de um celular brasileiro sem DDI
  // (DDD + 9 dígitos). É também um número americano com DDI. Nenhuma regra de comprimento separa os
  // dois; o que separa é o `+` que a pessoa digitou. Com ele, o DDI já está ali e prefixar 55
  // produziria um número que não existe.
  const temMaisExplicito = bruto.startsWith("+");
  if (temMaisExplicito) {
    return d.length >= 8 && d.length <= 15 ? d : null;
  }

  // Já veio com DDI do Brasil (sem `+`): 55 + DDD(2) + número(8 ou 9).
  if (d.startsWith(DDI_BR) && (d.length === 12 || d.length === 13)) return d;

  // Sem DDI: DDD(2) + número(8 ou 9). É o caso comum — o contador digita o número local.
  if (d.length === 10 || d.length === 11) return `${DDI_BR}${d}`;

  // Mais longo que um número brasileiro e sem `+`: só pode ser estrangeiro com DDI digitado solto.
  if (d.length >= 12 && d.length <= 15) return d;

  return null;
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
  return d ? `+${d}` : "";
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
