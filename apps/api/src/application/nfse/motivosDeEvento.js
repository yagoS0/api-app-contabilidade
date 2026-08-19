// OS MOTIVOS DE UM EVENTO DE NFS-e — listas FECHADAS, lidas do XSD oficial versionado.
//
// ⚠⚠ AS DUAS LISTAS SÃO DIFERENTES, E CONFUNDI-LAS É FALHA DE SCHEMA. Este arquivo existe porque
// elas estavam implícitas em `NfseService.js`, uma em cada ramo de um ternário, e o ramo do
// cancelamento **não tinha lista nenhuma** — ele arbitrava `"1"`.
//
// ═══ A FONTE (primária, versionada no repositório em 19/08/2026) ═════════════════════════════
//
// `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01/`
//
// | evento    | elemento   | tipo no XSD       | onde                            | valores          |
// |-----------|------------|-------------------|---------------------------------|------------------|
// | `e101101` | `cMotivo`  | `TSCodJustCanc`   | `tiposEventos_v1.01.xsd:233`    | `1` `2` `9`      |
// | `e105102` | `cMotivo`  | `TSCodJustSubst`  | `tiposEventos_v1.01.xsd:267`    | `01`…`05` `99`   |
// | ambos     | `xMotivo`  | `TSMotivo`        | `tiposEventos_v1.01.xsd:243`    | 15 a 255 chars   |
//
// As enumerações estão em `tiposSimples_v1.01.xsd`: `TSCodJustCanc` na linha 219 (**um** caractere),
// `TSCodJustSubst` na 235 (**dois**), `TSMotivo` na 348 (`minLength=15`, `maxLength=255`).
//
// ⚠ O CANCELAMENTO **NÃO** USA `01…05, 99`. Essa é a lista da SUBSTITUIÇÃO, e o projeto já
// acreditou que valia para os dois — havia comentário afirmando que "o código é uma justificativa
// FISCAL de lista fechada (01…05, 99)" no caminho que também atende o cancelamento. Não vale: são
// tipos distintos, com cardinalidade distinta, e mandar `"01"` num `e101101` é rejeição de schema.
//
// ⚠ O ANEXO_I NÃO COBRE ISTO, e a varredura está feita, não suposta: ele é o leiaute da DPS/NFS-e,
// não dos eventos. Os **87 comentários de célula** do `.xlsx` (55 em `EXPORTACAO_EMISSÃO_NFS-e`,
// 32 em `RN DPS_NFS-e`) foram extraídos de `xl/comments1.xml`/`comments2.xml` e varridos por
// `cancel|cMotivo|justificativ|101101`: **zero ocorrências**. O **ANEXO_II** (eventos), que traria
// as regras de negócio do cancelamento, **não está versionado** — está nomeado como próximo
// candidato no README daquela pasta. Enquanto ele não entrar, o XSD é a fonte, e ele é primário.
//
// ⚠ E HÁ PRECEDENTE PARA O XSD VENCER: no `cMotivo` da substituição o ANEXO_I declara `TAM. = 1` e
// lista `99` na mesma célula — internamente incoerente. O README daquela pasta já concluiu "vale o
// XSD". A mesma regra vale aqui.

/** `TSCodJustCanc` — `tiposSimples_v1.01.xsd:219`. ⚠ UM caractere, sem zero à esquerda. */
export const MOTIVOS_CANCELAMENTO = Object.freeze([
  Object.freeze({ codigo: "1", rotulo: "Erro na emissão" }),
  Object.freeze({ codigo: "2", rotulo: "Serviço não prestado" }),
  Object.freeze({ codigo: "9", rotulo: "Outros" }),
]);

/** `TSCodJustSubst` — `tiposSimples_v1.01.xsd:235`. ⚠ DOIS caracteres, com zero à esquerda. */
export const MOTIVOS_SUBSTITUICAO = Object.freeze([
  Object.freeze({ codigo: "01", rotulo: "Desenquadramento de NFS-e do Simples Nacional" }),
  Object.freeze({ codigo: "02", rotulo: "Enquadramento de NFS-e no Simples Nacional" }),
  Object.freeze({ codigo: "03", rotulo: "Inclusão retroativa de imunidade/isenção para NFS-e" }),
  Object.freeze({ codigo: "04", rotulo: "Exclusão retroativa de imunidade/isenção para NFS-e" }),
  Object.freeze({
    codigo: "05",
    rotulo: "Rejeição de NFS-e pelo tomador ou pelo intermediário responsável pelo recolhimento",
  }),
  Object.freeze({ codigo: "99", rotulo: "Outros" }),
]);

/** `TSMotivo` — `tiposSimples_v1.01.xsd:348`. */
export const JUSTIFICATIVA = Object.freeze({ MIN: 15, MAX: 255 });

const CODIGOS_CANCELAMENTO = new Set(MOTIVOS_CANCELAMENTO.map((m) => m.codigo));
const CODIGOS_SUBSTITUICAO = new Set(MOTIVOS_SUBSTITUICAO.map((m) => m.codigo));

/** A lista fechada do evento, ou `null` se o evento não for um dos dois. */
export function motivosDoEvento(tipoEvento) {
  const t = String(tipoEvento || "").toLowerCase();
  if (t === "e101101") return MOTIVOS_CANCELAMENTO;
  if (t === "e105102") return MOTIVOS_SUBSTITUICAO;
  return null;
}

/**
 * O `cMotivo` pertence à lista fechada DESTE evento?
 *
 * ⚠ COMPARAÇÃO EXATA, sem `padStart` e sem `Number()`. Normalizar aqui é o que faria `"01"` passar
 * por `"1"` num cancelamento: as duas listas usam larguras diferentes de propósito, e "consertar" a
 * largura mandaria ao sistema nacional um código que o schema dele não aceita — a rejeição chegaria
 * como erro de schema, sem dizer que o motivo era de outra lista.
 */
export function motivoValido(tipoEvento, cMotivo) {
  const t = String(tipoEvento || "").toLowerCase();
  const c = String(cMotivo ?? "");
  if (t === "e101101") return CODIGOS_CANCELAMENTO.has(c);
  if (t === "e105102") return CODIGOS_SUBSTITUICAO.has(c);
  return false;
}

/**
 * A justificativa (`xMotivo`) cabe no `TSMotivo`?
 *
 * ⚠ ISTO É CONFERIDO **ANTES DE ASSINAR**, e é o ponto. Sem esta trava, uma justificativa de quatro
 * letras é montada, ASSINADA com o certificado da empresa, transmitida, e volta rejeitada por
 * schema — um round-trip ao sistema nacional para descobrir uma regra que está escrita no XSD que
 * temos no disco. Pior: a rejeição de schema não diz "faltam 11 caracteres".
 *
 * @returns {{ok: true}|{ok: false, codigo: string, mensagem: string}}
 */
export function validarJustificativa(texto) {
  const t = String(texto ?? "").trim();
  if (t.length < JUSTIFICATIVA.MIN) {
    return {
      ok: false,
      codigo: "NFSE_JUSTIFICATIVA_CURTA",
      mensagem:
        `A justificativa precisa ter pelo menos ${JUSTIFICATIVA.MIN} caracteres `
        + `(tem ${t.length}). É exigência do leiaute nacional, não nossa.`,
    };
  }
  if (t.length > JUSTIFICATIVA.MAX) {
    return {
      ok: false,
      codigo: "NFSE_JUSTIFICATIVA_LONGA",
      mensagem:
        `A justificativa pode ter no máximo ${JUSTIFICATIVA.MAX} caracteres (tem ${t.length}).`,
    };
  }
  return { ok: true };
}
