/**
 * O REMETENTE e a codificação de cabeçalho de e-mail — regra pura, sem config (30/08/2026)
 *
 * ⚠ POR QUE É UM MÓDULO PRÓPRIO, e não uma função dentro de `EmailService.js`:
 * `scripts/verificar-delegacao-gmail.mjs` monta o MIME dele próprio de propósito — ele existe para
 * rodar QUANDO A CONFIG ESTÁ QUEBRADA (é o script que se usa antes de trocar `SMTP_FROM` no
 * Railway). Importar `EmailService` arrastaria `config.js`, que valida o ambiente inteiro ao ser
 * importado, e o verificador morreria justamente no caso que ele existe para diagnosticar.
 * Sem este módulo, a alternativa é duplicar as regras do RFC nos dois lugares — e uma cópia só é
 * corrigida quando alguém descobre o e-mail torto na caixa de um cliente.
 */

/**
 * ⚠ RFC 2047: cabeçalho é ASCII. Qualquer coisa fora de `\x20-\x7E` vira `encoded-word`, senão o
 * cliente de e-mail mostra mojibake — e o e-mail SAI, então não há erro nenhum para ler.
 */
export function encodeHeaderUtf8(value) {
  const s = String(value ?? "");
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * ⚠ O NOME DE EXIBIÇÃO do remetente — o que a caixa de entrada mostra em negrito.
 *
 * > Dono: *"o email aparece na caixa de entrada como: envio, conseguimos mudar isso?"*
 *
 * O `From` saía como endereço puro (`envio@altan.company`) e o Gmail mostrava a parte antes do `@`.
 * Com `SMTP_FROM="Altan Contabilidade <envio@altan.company>"` ele passa a mostrar o nome.
 *
 * ⚠⚠ Esta função existe porque o cabeçalho NÃO é texto livre. Dois modos de quebrar, os dois
 * silenciosos — o e-mail sai, e sai errado:
 *   1. **acento** (`Contabilidade Endereço`) vai cru e vira mojibake no cliente de e-mail;
 *   2. **vírgula ou ponto** (`Altan Contabilidade, Ltda.`) são `specials` do RFC 5322 dentro de um
 *      `phrase` — o parser lê a vírgula como SEPARADOR e o `From` vira DOIS remetentes.
 *
 * ⚠ `encoded-word` (`=?UTF-8?B?…?=`) NUNCA pode ir entre aspas: entre aspas ele deixa de ser
 * decodificado e o cliente mostra a base64 literal. Por isso os dois ramos são exclusivos.
 */
const ESPECIAIS_DO_PHRASE = /[()<>@,;:\\".[\]]/;

export function montarRemetente(from) {
  const bruto = String(from ?? "").trim();
  const m = bruto.match(/^(.*)<([^>]+)>\s*$/);
  // Endereço puro (o formato de antes) segue intocado — é o caminho de quem não configurou nome.
  if (!m) return bruto;
  const nome = m[1].trim().replace(/^"(.*)"$/, "$1");
  const endereco = m[2].trim();
  if (!nome) return endereco;
  const codificado = encodeHeaderUtf8(nome);
  if (codificado !== nome) return `${codificado} <${endereco}>`;
  if (ESPECIAIS_DO_PHRASE.test(nome)) return `"${nome.replace(/"/g, '\\"')}" <${endereco}>`;
  return `${nome} <${endereco}>`;
}

/**
 * O remetente a usar quando só se conhece a CAIXA que assina (o caso do verificador de delegação).
 *
 * ⚠⚠ O nome de `SMTP_FROM` só é aproveitado se ele apontar para ESTA MESMA caixa. O Gmail API
 * recusa um `From` cujo endereço não seja o do usuário impersonado — então herdar o nome de um
 * `SMTP_FROM` que aponta para outro endereço trocaria "e-mail sem nome" por "e-mail que não sai".
 */
export function remetenteDaCaixa(caixa, smtpFrom) {
  const alvo = String(caixa ?? "").trim();
  const bruto = String(smtpFrom ?? "").trim();
  const m = bruto.match(/^(.*)<([^>]+)>\s*$/);
  if (!m) return alvo;
  if (m[2].trim().toLowerCase() !== alvo.toLowerCase()) return alvo;
  return montarRemetente(bruto);
}
