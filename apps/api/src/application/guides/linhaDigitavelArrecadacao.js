// Linha digitável (representação numérica) do código de barras de ARRECADAÇÃO — leitura e
// validação. Função PURA (sem I/O, sem banco, sem rede).
//
// ⚠⚠ REGRA QUE VALE MAIS QUE A ENTREGA: **NADA AQUI CALCULA, DERIVA OU MONTA a linha digitável.**
// Este módulo só sabe fazer duas coisas: (1) LER um número que já está impresso no documento
// oficial e (2) RECUSAR o que não se prova. Com banco, valor, vencimento e número do documento em
// mãos dá para *parecer* que a linha se monta — e um dígito errado manda o dinheiro do cliente
// para o lugar errado ou faz o pagamento não ser reconhecido pela Receita.
// **Ausência é resposta; número errado não é.** (Mesma disciplina de `parseComprovanteArrecadacao`,
// que só devolve o rateio quando principal+juros+multa == total.)
//
// FONTE OFICIAL (não é memória nem exemplo de terceiro):
//   FEBRABAN — "Layout Padrão de Arrecadação/Recebimento com Utilização do Código de Barras",
//   VERSÃO 07, vigência a partir de 01.03.2023. Lido do PDF oficial em 2026-08-18:
//   https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%207%20-%2001_03_2023_mn.pdf
//
//   §04 CONTEÚDO DO CÓDIGO DE BARRAS (44 posições):
//     01–01 (1)  Identificação do Produto      → §05: constante "8" para identificar arrecadação
//     02–02 (1)  Identificação do Segmento     → 1 Prefeituras · 2 Saneamento · 3 Energia/Gás ·
//                                                4 Telecom · 5 Órgãos Governamentais · 6 Carnês e
//                                                demais (identificados por CNPJ) · 7 Multas de
//                                                trânsito · 9 Uso exclusivo do banco
//     03–03 (1)  Identificação do valor real ou referência (§05):
//                  "6" valor efetivo em reais, DV geral por MÓDULO 10
//                  "7" quantidade de moeda / valor a reajustar, DV geral por MÓDULO 10
//                  "8" valor efetivo em reais, DV geral por MÓDULO 11
//                  "9" quantidade de moeda / valor a reajustar, DV geral por MÓDULO 11
//     04–04 (1)  Dígito verificador geral (módulo 10 ou 11)
//     05–15 (11) Valor
//     16–19 (4)  Identificação da Empresa/Órgão
//     20–44 (25) Campo livre de utilização da Empresa/Órgão
//
//   §03-E: a representação numérica "deverá estar distribuída em campos de 11 posições dentro de
//   boxes, acrescido de 1 dígito verificador, módulo-10 ou módulo 11 de acordo com o código de
//   moeda escolhido, a cada grupo" → 4 × (11 + 1) = **48 dígitos**. "Os dígitos verificadores não
//   estarão representados no Código de Barras."
//
//   §07 DAC MÓDULO 10: multiplicadores 2,1,2,1… da direita para a esquerda; somam-se os
//   ALGARISMOS do produto (cada dígito individualmente); DAC = 10 − (resto da divisão por 10);
//   "quando o resto da divisão for 0 (zero), o DAC calculado é o 0 (zero)".
//   §09 DAC MÓDULO 11: multiplicadores 2,3,4,5,6,7,8,9,2,3,4… da direita para a esquerda; soma dos
//   PRODUTOS; DAC = 11 − resto; "Quando o resto da divisão for igual a 0 ou 1, atribuí-se ao DV o
//   dígito '0', e quando for 10, atribuí-se ao DV o dígito '1'".
//   §08/§10 DV GERAL: área auxiliar de 43 posições = as 3 primeiras + as 40 restantes (ou seja,
//   **sem** a 4ª posição, que é o próprio DV).
//
//   §03-G DATA DE VENCIMENTO: "No caso de ser utilizada a data de vencimento (AAAAMMDD), incluir
//   nas 8 primeiras posições do campo livre." — ⚠ é FACULTATIVO, e o DAS do Simples Nacional NÃO a
//   usa (medido: campo livre real começa em "26051072…", que não é data). Por isso a conferência
//   de vencimento aqui é CONDICIONAL: só existe quando o emissor codificou a data. Afirmar que o
//   vencimento está sempre lá seria inventar contrato.
//
// CONFERÊNCIA EXTERNA (o que impede um número lido "quase certo" de virar meio de pagamento):
//   o valor codificado nas posições 05–15 tem de bater com o total que já conhecemos da guia.
//   Divergiu → não devolve nada, com motivo nomeado.

/** Só os dígitos de uma string. */
function digitos(v) {
  return String(v == null ? "" : v).replace(/\D+/g, "");
}

/**
 * DAC módulo 10 (FEBRABAN §07). Soma os ALGARISMOS de cada produto.
 * @param {string} numero sequência só de dígitos
 * @returns {number} 0..9
 */
export function dacModulo10(numero) {
  let soma = 0;
  let peso = 2; // alterna 2,1,2,1… da direita para a esquerda
  for (let i = numero.length - 1; i >= 0; i--) {
    const produto = Number(numero[i]) * peso;
    soma += produto > 9 ? Math.floor(produto / 10) + (produto % 10) : produto;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/**
 * DAC módulo 11 (FEBRABAN §09). Soma os PRODUTOS; resto 0 ou 1 → "0"; resto 10 → "1".
 * @param {string} numero sequência só de dígitos
 * @returns {number} 0..9
 */
export function dacModulo11(numero) {
  let soma = 0;
  let peso = 2; // 2,3,4,5,6,7,8,9 ciclando, da direita para a esquerda
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  if (resto === 0 || resto === 1) return 0;
  if (resto === 10) return 1;
  return 11 - resto;
}

export const MOTIVOS = {
  TAMANHO: "tamanho_diferente_de_48",
  NAO_E_ARRECADACAO: "primeiro_digito_nao_e_8",
  IDENTIFICADOR_VALOR: "identificador_de_valor_desconhecido",
  DV_BLOCO: "dv_de_bloco_nao_confere",
  DV_GERAL: "dv_geral_nao_confere",
  VALOR_NAO_EFETIVO: "valor_nao_e_efetivo_em_reais",
  VALOR_DIVERGENTE: "valor_divergente_do_documento",
  VENCIMENTO_DIVERGENTE: "vencimento_divergente_do_documento",
  NAO_ENCONTRADA: "linha_digitavel_nao_encontrada_no_texto",
};

/**
 * Valida uma linha digitável de arrecadação (48 dígitos) e devolve o que ela CONTÉM.
 * Não conserta, não completa, não recalcula: ou os cinco dígitos verificadores fecham, ou recusa.
 *
 * @param {string} entrada linha digitável (com ou sem espaços/pontos/hífens)
 * @returns {{ok: true, linhaDigitavel: string, codigoBarras: string, segmento: number,
 *             identificadorValor: number, modulo: 10|11, valorCentavos: number|null,
 *             identificacaoOrgao: string, campoLivre: string, vencimentoCodificado: string|null}
 *          | {ok: false, motivo: string, detalhe?: any}}
 */
export function validarLinhaDigitavel(entrada) {
  const d = digitos(entrada);
  if (d.length !== 48) return { ok: false, motivo: MOTIVOS.TAMANHO, detalhe: d.length };

  const blocos = [d.slice(0, 11), d.slice(12, 23), d.slice(24, 35), d.slice(36, 47)];
  const dvs = [Number(d[11]), Number(d[23]), Number(d[35]), Number(d[47])];
  const codigoBarras = blocos.join("");

  if (codigoBarras[0] !== "8") return { ok: false, motivo: MOTIVOS.NAO_E_ARRECADACAO };

  const identificadorValor = Number(codigoBarras[2]);
  let modulo;
  if (identificadorValor === 6 || identificadorValor === 7) modulo = 10;
  else if (identificadorValor === 8 || identificadorValor === 9) modulo = 11;
  else return { ok: false, motivo: MOTIVOS.IDENTIFICADOR_VALOR, detalhe: identificadorValor };

  const dac = modulo === 10 ? dacModulo10 : dacModulo11;

  for (let i = 0; i < 4; i++) {
    const esperado = dac(blocos[i]);
    if (esperado !== dvs[i]) {
      return { ok: false, motivo: MOTIVOS.DV_BLOCO, detalhe: { bloco: i + 1, lido: dvs[i], calculado: esperado } };
    }
  }

  // DV geral: 43 posições = 3 primeiras + 40 restantes (a 4ª, que é o DV, fica de fora).
  const dvGeralLido = Number(codigoBarras[3]);
  const area43 = codigoBarras.slice(0, 3) + codigoBarras.slice(4);
  const dvGeralCalculado = dac(area43);
  if (dvGeralLido !== dvGeralCalculado) {
    return { ok: false, motivo: MOTIVOS.DV_GERAL, detalhe: { lido: dvGeralLido, calculado: dvGeralCalculado } };
  }

  // Valor: só é valor efetivo em reais quando o identificador é 6 ou 8 (§05). Em 7/9 o campo pode
  // ser quantidade de moeda ou zeros — ler como reais ali seria inventar.
  const valorEfetivo = identificadorValor === 6 || identificadorValor === 8;
  const valorCentavos = valorEfetivo ? Number(codigoBarras.slice(4, 15)) : null;

  const campoLivre = codigoBarras.slice(19); // posições 20–44
  const vencimentoCodificado = lerVencimentoDoCampoLivre(campoLivre);

  return {
    ok: true,
    linhaDigitavel: d,
    codigoBarras,
    segmento: Number(codigoBarras[1]),
    identificadorValor,
    modulo,
    valorCentavos,
    identificacaoOrgao: codigoBarras.slice(15, 19),
    campoLivre,
    vencimentoCodificado,
  };
}

/**
 * §03-G: a data de vencimento (AAAAMMDD), QUANDO USADA, ocupa as 8 primeiras posições do campo
 * livre. Como é facultativa, um campo livre que não forma data válida significa "o emissor não a
 * codificou" — não "documento inválido".
 * @returns {string|null} "YYYY-MM-DD"
 */
export function lerVencimentoDoCampoLivre(campoLivre) {
  const s = String(campoLivre || "").slice(0, 8);
  if (!/^\d{8}$/.test(s)) return null;
  const ano = Number(s.slice(0, 4));
  const mes = Number(s.slice(4, 6));
  const dia = Number(s.slice(6, 8));
  if (ano < 2000 || ano > 2099 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// Blocos de 11 dígitos + 1 DV, separados (ou não) por espaço, ponto ou hífen. Cobre tanto o
// formato impresso em boxes ("85850000013 4 67700328260 7 …") quanto os 48 dígitos contíguos.
const PADRAO_LINHA = /(\d{11})[\s. -]*(\d)[\s. -]*(\d{11})[\s. -]*(\d)[\s. -]*(\d{11})[\s. -]*(\d)[\s. -]*(\d{11})[\s. -]*(\d)/g;

/**
 * Procura, no texto extraído do PDF, uma linha digitável de arrecadação VÁLIDA.
 *
 * Varre todos os candidatos e devolve só o que passa nos cinco dígitos verificadores — não existe
 * "melhor palpite". Se dois candidatos válidos e DIFERENTES aparecerem, recusa: um documento com
 * duas linhas digitáveis discordantes não é dado, é ambiguidade (o DAS imprime a MESMA linha duas
 * vezes, e isso é o caso normal).
 *
 * @param {string} textoPdf texto extraído (pdf-parse / pdfplumber)
 * @returns {{ok: true, ...}|{ok: false, motivo: string, candidatos?: number, detalhe?: any}}
 */
export function extrairLinhaDigitavelDoTexto(textoPdf) {
  const texto = String(textoPdf || "");
  const validas = new Map();
  let tentativas = 0;
  let ultimaRecusa = null;

  PADRAO_LINHA.lastIndex = 0;
  let m;
  while ((m = PADRAO_LINHA.exec(texto)) !== null) {
    tentativas += 1;
    const candidato = m.slice(1, 9).join("");
    const r = validarLinhaDigitavel(candidato);
    if (r.ok) validas.set(r.linhaDigitavel, r);
    else ultimaRecusa = r;
    // Reposiciona 1 caractere à frente: um "run" longo de dígitos pode conter a linha deslocada.
    PADRAO_LINHA.lastIndex = m.index + 1;
  }

  if (validas.size === 1) return [...validas.values()][0];
  if (validas.size > 1) {
    return { ok: false, motivo: "linhas_digitaveis_divergentes_no_documento", candidatos: validas.size };
  }
  return { ok: false, motivo: MOTIVOS.NAO_ENCONTRADA, candidatos: tentativas, detalhe: ultimaRecusa || undefined };
}

/**
 * Confere a linha lida contra o que JÁ SABEMOS da guia. É esta função que decide se o número pode
 * virar meio de pagamento na tela do cliente.
 *
 * @param {object} lida resultado ok de `validarLinhaDigitavel`/`extrairLinhaDigitavelDoTexto`
 * @param {{valorTotal?: number|string|null, vencimento?: string|Date|null}} documento
 *        valores que vêm do documento/payload oficial (ex.: detalhamentoDas.valores.total e
 *        detalhamentoDas.dataVencimento), NUNCA de estimativa nossa
 * @returns {{ok: true, ...}|{ok: false, motivo: string, detalhe?: any}}
 */
export function conferirContraDocumento(lida, documento = {}) {
  if (!lida || !lida.ok) return lida || { ok: false, motivo: MOTIVOS.NAO_ENCONTRADA };

  const valorEsperado = documento.valorTotal;
  if (valorEsperado != null && String(valorEsperado).trim() !== "") {
    if (lida.valorCentavos == null) {
      // Identificador 7/9: o campo não é valor efetivo, então não há o que conferir — e uma guia
      // cujo valor não se confere não vai para a tela.
      return { ok: false, motivo: MOTIVOS.VALOR_NAO_EFETIVO, detalhe: lida.identificadorValor };
    }
    const esperadoCentavos = Math.round(Number(valorEsperado) * 100);
    if (!Number.isFinite(esperadoCentavos) || esperadoCentavos !== lida.valorCentavos) {
      return {
        ok: false,
        motivo: MOTIVOS.VALOR_DIVERGENTE,
        detalhe: { naLinha: lida.valorCentavos, noDocumento: esperadoCentavos },
      };
    }
  }

  const vencEsperado = normalizarData(documento.vencimento);
  if (vencEsperado && lida.vencimentoCodificado && vencEsperado !== lida.vencimentoCodificado) {
    return {
      ok: false,
      motivo: MOTIVOS.VENCIMENTO_DIVERGENTE,
      detalhe: { naLinha: lida.vencimentoCodificado, noDocumento: vencEsperado },
    };
  }

  return {
    ...lida,
    conferido: {
      valor: valorEsperado != null && String(valorEsperado).trim() !== "",
      // ⚠ false NÃO é "divergiu": é "este emissor não codificou a data no campo livre" (§03-G,
      // facultativo). O DAS do Simples não codifica.
      vencimento: Boolean(vencEsperado && lida.vencimentoCodificado),
    },
  };
}

/** "YYYY-MM-DD" | Date | "AAAAMMDD" | "DD/MM/AAAA" → "YYYY-MM-DD" | null */
function normalizarData(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Formatação de exibição: 4 grupos de 11+1, como o documento imprime. */
export function formatarLinhaDigitavel(linha) {
  const d = digitos(linha);
  if (d.length !== 48) return null;
  return [d.slice(0, 12), d.slice(12, 24), d.slice(24, 36), d.slice(36, 48)]
    .map((b) => `${b.slice(0, 11)}-${b.slice(11)}`)
    .join(" ");
}
