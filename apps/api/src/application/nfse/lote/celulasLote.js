// AS CÉLULAS QUE O EXCEL ESTRAGA — documento, valor e competência.
//
// ⚠⚠ **NADA AQUI EMITE NOTA.** São leitores de célula: recebem o que veio da planilha e devolvem o
// valor ou a RECUSA nomeada. Nenhuma função deste arquivo escreve em banco nem chama a rede.
//
// ⚠ A REGRA GERAL DOS TRÊS: **o que tem duas leituras possíveis não é convertido.** Não se
// "conserta" adivinhando — devolve-se a recusa com o motivo, e a linha vira pendência para ajuste.
// Um número plausível e errado numa nota fiscal não se desfaz: cancelar é outro ato fiscal, com
// prazo e motivo.

import { cpfTemDvValido } from "../../../utils/cpf.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O DOCUMENTO — e o zero que o Excel come
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠⚠ O EXCEL COME O ZERO À ESQUERDA. Numa célula de formato Geral, `01234567890` vira o NÚMERO
// 1234567890 — 10 dígitos —, e o validador recusa com `tomador_documento_invalido`. Com o DV do CPF
// agora conferido (pedido do dono, 18/08/2026), isso bate em toda linha de CPF começando com zero.
//
// A defesa é dupla e as duas metades são necessárias:
//   • o MODELO nasce com a coluna formatada como texto (`modeloPlanilhaLote.js`) — evita o caso;
//   • a LEITURA trata o caso — porque a planilha pode vir de outro lugar, ser recriada, ser colada.
//
// ⚠⚠ **O REENCAIXE DO ZERO SÓ ACONTECE SE O DV FECHAR, E NUNCA PARA CNPJ.**
//   • CPF: existe UM candidato por comprimento (preencher com zeros à esquerda até 11), e o dígito
//     verificador é a prova. Se ele não fechar, não há conserto — inventar dígito de CPF emite nota
//     contra outra pessoa, e a NFS-e não tem inutilização.
//   • CNPJ: este projeto **não valida DV de CNPJ** (decisão registrada em `nfsePayload.js`: *"sua
//     validação de DV não foi pedida e não foi inventada"*). Sem prova, reencaixar zero num CNPJ de
//     13 dígitos seria adivinhação pura. Não se faz.
//
// ⚠ O reencaixe é limitado a UM ou DOIS zeros (9 ou 10 dígitos). Não é o DV que limita — ele custa
// o mesmo em qualquer comprimento —, é a honestidade: com três ou mais zeros comidos o palpite
// deixa de descrever um erro típico do Excel e vira reconstrução. Nesses casos a recusa nomeia a
// causa, e o conserto de verdade (formatar a coluna como texto) fica dito.
//
// ⚠ E MESMO QUANDO O DV FECHA, A LINHA NÃO SAI COMO "PRONTA": ela sai para CONFERÊNCIA. Nós
// mudamos o número que a pessoa entregou — isso se mostra, nunca se assume.

export const RECUSA_DOCUMENTO = Object.freeze({
  AUSENTE: "documento_ausente",
  FORA_DE_FORMA: "documento_fora_de_forma",
  CPF_DV_INVALIDO: "cpf_dv_invalido",
  ZERO_A_ESQUERDA: "documento_zero_a_esquerda",
});

/** Comprimentos a partir dos quais o reencaixe de zeros ainda descreve o erro do Excel. */
const MENOR_COMPRIMENTO_RECUPERAVEL = 9;

/**
 * O CNPJ/CPF de uma linha.
 *
 * @returns {{ok: true, documento: string, tipo: "CPF"|"CNPJ", zeroRecuperado: boolean}
 *          | {ok: false, motivo: string, texto: string}}
 */
export function lerDocumentoDaPlanilha(celula) {
  const original = celula === null || celula === undefined ? "" : String(celula).trim();
  const digitos = original.replace(/\D+/g, "");

  if (!digitos) return { ok: false, motivo: RECUSA_DOCUMENTO.AUSENTE, texto: original };

  if (digitos.length === 14) {
    return { ok: true, documento: digitos, tipo: "CNPJ", zeroRecuperado: false };
  }

  if (digitos.length === 11) {
    if (!cpfTemDvValido(digitos)) {
      return { ok: false, motivo: RECUSA_DOCUMENTO.CPF_DV_INVALIDO, texto: original };
    }
    return { ok: true, documento: digitos, tipo: "CPF", zeroRecuperado: false };
  }

  // ⚠ O CASO DO EXCEL. Só CPF, só com um ou dois zeros, e só se o DV fechar.
  if (digitos.length >= MENOR_COMPRIMENTO_RECUPERAVEL && digitos.length < 11) {
    const candidato = digitos.padStart(11, "0");
    if (cpfTemDvValido(candidato)) {
      return { ok: true, documento: candidato, tipo: "CPF", zeroRecuperado: true };
    }
    return { ok: false, motivo: RECUSA_DOCUMENTO.ZERO_A_ESQUERDA, texto: original };
  }

  return { ok: false, motivo: RECUSA_DOCUMENTO.FORA_DE_FORMA, texto: original };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O VALOR — e o problema do `1.500`, agora do lado de cá do Excel
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ A GRAMÁTICA É A MESMA de `lerValorColado`
// (`apps/portal-cliente-web/src/features/emitir/lib/valorDaNota.js` — o módulo que consertou o campo
// da tela em 19/08/2026). MESMA REGRA, apps separados e sem código compartilhado: é o mesmo arranjo
// de `consultaTomador.js`, `reaproveitarNota.js` e `municipioIbge.js`. **Mudou lá, muda aqui.**
//
// As formas ACEITAS, cada uma com UMA leitura possível:
//   `1500`      inteiro sem separador — não existe idioma em que isso seja 15
//   `1500,00`   vírgula decimal com 1 ou 2 casas — pt-BR
//   `1.500,00`  milhar com ponto + decimal com vírgula — pt-BR completo
//   `1,500.00`  milhar com vírgula + decimal com ponto — en-US completo
//   `1500.00`   ponto com 1 ou 2 casas: não pode ser milhar pt-BR, que agrupa de 3 em 3
//
// As RECUSADAS, porque as duas leituras são legítimas:
//   `1.500`     pt-BR: 1500 · en-US: 1,5
//   `1,500`     pt-BR: 1,5 · en-US: 1500
//
// ⚠⚠ **NA PLANILHA HÁ UM CASO QUE NÃO EXISTE NA TELA, E ELE É PIOR: O EXCEL JÁ CONVERTEU.** Quando
// a célula chega como NÚMERO, a ambiguidade já foi resolvida — pelo Excel, com a configuração
// regional da máquina de quem preencheu, antes de nós. Não há como desfazer e não há o que recusar:
// nós aceitamos o número.
//
// E aceitar é o certo, não uma resignação: o número da célula é **o que a pessoa viu na tela do
// Excel**. Se ela digitou `1.500` numa máquina en-US, a célula mostrou `1,5` e foi isso que ela
// conferiu. Recusar aqui recusaria um valor legítimo por causa de uma dúvida que já não existe.
//
// O que ainda dá para pegar — e é onde mora o risco de verdade — é a célula de TEXTO. Ela chega
// como a pessoa escreveu, com a ambiguidade intacta, e é aí que a gramática fechada trabalha. É
// também o caso mais provável no nosso modelo: a coluna de documento nasce como texto e quem
// formata a planilha inteira como texto (ou cola de um sistema) traz o valor como texto também.

export const RECUSA_VALOR = Object.freeze({
  AUSENTE: "valor_ausente",
  AMBIGUO: "valor_ambiguo",
  ILEGIVEL: "valor_ilegivel",
  LONGO: "valor_longo",
  NAO_POSITIVO: "valor_nao_positivo",
  CASAS_DEMAIS: "valor_casas_demais",
});

/** 15 dígitos de centavos ≈ R$ 9.999.999.999.999,99 — o teto do inteiro seguro do JS. */
const MAX_DIGITOS_VALOR = 15;

function aceitarCentavos(bruta, original) {
  const d = String(bruta).replace(/^0+(?=\d)/, "");
  if (d.length > MAX_DIGITOS_VALOR) return { ok: false, motivo: RECUSA_VALOR.LONGO, texto: original };
  const valor = Number(d) / 100;
  if (!(valor > 0)) return { ok: false, motivo: RECUSA_VALOR.NAO_POSITIVO, texto: original };
  return { ok: true, valor };
}

/**
 * O valor de uma linha.
 *
 * @returns {{ok: true, valor: number} | {ok: false, motivo: string, texto: string}}
 */
export function lerValorDaPlanilha(celula) {
  if (celula === null || celula === undefined || celula === "") {
    return { ok: false, motivo: RECUSA_VALOR.AUSENTE, texto: "" };
  }

  // ── CÉLULA NUMÉRICA: o Excel já decidiu, e o que ele decidiu foi o que a pessoa viu.
  if (typeof celula === "number") {
    const original = String(celula);
    if (!Number.isFinite(celula)) return { ok: false, motivo: RECUSA_VALOR.ILEGIVEL, texto: original };
    if (!(celula > 0)) return { ok: false, motivo: RECUSA_VALOR.NAO_POSITIVO, texto: original };
    // ⚠ MOEDA TEM DUAS CASAS. `1500,005` não é um valor em reais: ou é outra unidade, ou é um
    // arredondamento que alguém espera que nós façamos — e arredondar o valor de uma nota fiscal em
    // silêncio é exatamente o que este arquivo existe para não fazer. Vira pendência, com o motivo.
    const centavos = celula * 100;
    if (Math.abs(centavos - Math.round(centavos)) > 1e-6) {
      return { ok: false, motivo: RECUSA_VALOR.CASAS_DEMAIS, texto: original };
    }
    const arredondado = Math.round(centavos) / 100;
    if (String(Math.round(centavos)).length > MAX_DIGITOS_VALOR) {
      return { ok: false, motivo: RECUSA_VALOR.LONGO, texto: original };
    }
    return { ok: true, valor: arredondado };
  }

  // ── CÉLULA DE TEXTO: a ambiguidade chegou intacta. Gramática fechada.
  const original = String(celula);
  const t = original.replace(/[\s  ]/g, "").replace(/^R\$/i, "");
  if (!t) return { ok: false, motivo: RECUSA_VALOR.AUSENTE, texto: original };

  let m;
  if ((m = /^(\d+)$/.exec(t))) return aceitarCentavos(`${m[1]}00`, original);
  if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(t))) {
    return aceitarCentavos(`${m[1].replace(/\./g, "")}${m[2].padEnd(2, "0")}`, original);
  }
  if ((m = /^(\d+),(\d{1,2})$/.exec(t))) return aceitarCentavos(`${m[1]}${m[2].padEnd(2, "0")}`, original);
  if ((m = /^(\d{1,3}(?:,\d{3})+)\.(\d{1,2})$/.exec(t))) {
    return aceitarCentavos(`${m[1].replace(/,/g, "")}${m[2].padEnd(2, "0")}`, original);
  }
  if ((m = /^(\d+)\.(\d{1,2})$/.exec(t))) return aceitarCentavos(`${m[1]}${m[2].padEnd(2, "0")}`, original);

  // ⚠ AS DUAS AMBIGUIDADES QUE O DONO NOMEOU ganham motivo PRÓPRIO, para a tela poder dizer qual é
  // a dúvida em vez de um "valor inválido" que não ensina nada.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) return { ok: false, motivo: RECUSA_VALOR.AMBIGUO, texto: original };
  if (/^\d{1,3}(?:,\d{3})+$/.test(t)) return { ok: false, motivo: RECUSA_VALOR.AMBIGUO, texto: original };

  return { ok: false, motivo: RECUSA_VALOR.ILEGIVEL, texto: original };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A COMPETÊNCIA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ DATA CIVIL, não instante. `utils/dataCivil.js` registra o defeito que isto evita: uma `Date`
// construída no fuso LOCAL do processo (que é o que o `cellDates: true` do SheetJS entrega) gravada
// onde o sistema guarda meia-noite UTC sai um dia antes sob `TZ=America/Sao_Paulo` — e num fuso
// positivo sairia o dia anterior sempre, em silêncio. A leitura usa os componentes LOCAIS, que são
// os que a pessoa viu na célula, e monta meia-noite UTC.
//
// ⚠ SÓ DUAS GRAFIAS DE TEXTO, e nenhuma delas é ambígua: `dd/mm/aaaa` (o rótulo do modelo diz isso)
// e `aaaa-mm-dd` (ISO). **`mm/aaaa` é RECUSADO**: a competência da DPS é uma data, e escolher o dia
// 1º por conta própria seria fabricar um componente que ninguém escreveu. A recusa nomeia os
// formatos aceitos, que é o que resolve de verdade.
//
// ⚠ `dd/mm` NUNCA é lido como `mm/dd`. É a mesma família de erro do `1.500`: as duas leituras
// existem e a errada é plausível. O modelo diz `dd/mm/aaaa` no cabeçalho e a leitura só faz isso.

export const RECUSA_COMPETENCIA = Object.freeze({
  AUSENTE: "competencia_ausente",
  ILEGIVEL: "competencia_ilegivel",
});

function dataCivilUTC(ano, mes, dia) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // ⚠ Confere que a data EXISTE: `31/02` viraria 3 de março no `Date`, em silêncio.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d;
}

/**
 * A competência de uma linha.
 *
 * @returns {{ok: true, competencia: Date} | {ok: false, motivo: string, texto: string}}
 */
export function lerCompetenciaDaPlanilha(celula) {
  if (celula === null || celula === undefined || celula === "") {
    return { ok: false, motivo: RECUSA_COMPETENCIA.AUSENTE, texto: "" };
  }

  // Célula de data de verdade (`XLSX.read(..., { cellDates: true })`).
  if (celula instanceof Date) {
    if (Number.isNaN(celula.getTime())) {
      return { ok: false, motivo: RECUSA_COMPETENCIA.ILEGIVEL, texto: String(celula) };
    }
    const d = dataCivilUTC(celula.getFullYear(), celula.getMonth() + 1, celula.getDate());
    return d ? { ok: true, competencia: d } : { ok: false, motivo: RECUSA_COMPETENCIA.ILEGIVEL, texto: String(celula) };
  }

  const texto = String(celula).trim();
  if (!texto) return { ok: false, motivo: RECUSA_COMPETENCIA.AUSENTE, texto: "" };

  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto))) {
    const d = dataCivilUTC(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { ok: true, competencia: d } : { ok: false, motivo: RECUSA_COMPETENCIA.ILEGIVEL, texto };
  }
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(texto))) {
    const d = dataCivilUTC(Number(m[3]), Number(m[2]), Number(m[1]));
    return d ? { ok: true, competencia: d } : { ok: false, motivo: RECUSA_COMPETENCIA.ILEGIVEL, texto };
  }

  // ⚠ Serial do Excel que escapou como número (planilha sem `cellDates`). Aceito porque é a MESMA
  // data que a célula mostrava, e a conversão não tem grafia ambígua: é aritmética do formato.
  // O serial 1 é 01/01/1900 e o 2958465 é 31/12/9999 — fora disso não é data.
  if (typeof celula === "number" && Number.isInteger(celula) && celula >= 1 && celula <= 2958465) {
    // Época do Excel: o dia 1 é 01/01/1900, e o formato tem o bug do 29/02/1900 inexistente.
    const ms = Date.UTC(1899, 11, 30) + celula * 86400000;
    const d = new Date(ms);
    return { ok: true, competencia: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) };
  }

  return { ok: false, motivo: RECUSA_COMPETENCIA.ILEGIVEL, texto };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O E-MAIL — forma, e só a forma
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ **O MESMO CRITÉRIO DO VALIDADOR, NEM UM GRAU A MAIS.** `validateNfsePayload` recusa com
// `tomador_email_invalido` quando o e-mail vem preenchido e **não contém `@`** — só isso. Inventar
// aqui uma regra mais estrita (regex de RFC, checagem de domínio) faria a planilha recusar um
// e-mail que a emissão aceita, e a divergência apareceria como uma linha pendente sem explicação.
//
// ⚠ AUSENTE É NORMAL, e não é pendência: o validador não exige e-mail, e não há equivalente ao
// `MISSING_TOMADOR_ADDRESS` para ele. Linha sem e-mail é linha PRONTA.
//
// ⚠ MALFORMADO NÃO DERRUBA A LINHA: a nota sai sem e-mail e a linha vai para CONFERÊNCIA. Perder
// uma emissão por causa de um campo que a emissão não exige seria trocar um problema por outro
// maior.

export const RECUSA_EMAIL = Object.freeze({ FORA_DE_FORMA: "email_fora_de_forma" });

/**
 * @returns {{ok: true, email: string|null} | {ok: false, motivo: string, texto: string}}
 *   `email: null` = a planilha não trouxe. É ausência, nunca recusa.
 */
export function lerEmailDaPlanilha(celula) {
  const texto = celula === null || celula === undefined ? "" : String(celula).trim();
  if (!texto) return { ok: true, email: null };
  if (!texto.includes("@")) return { ok: false, motivo: RECUSA_EMAIL.FORA_DE_FORMA, texto };
  return { ok: true, email: texto };
}
