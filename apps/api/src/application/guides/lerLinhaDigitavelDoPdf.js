// Ponte entre o PDF que acabou de chegar e as quatro colunas de linha digitável da `Guide`.
//
// A matemática NÃO está aqui — está em `linhaDigitavelArrecadacao.js`, que é pura e só sabe LER e
// RECUSAR. Este módulo faz o que aquele não pode fazer: abrir o PDF, escolher contra QUEM conferir,
// e traduzir o resultado para o formato que vai ao banco. **Nada aqui monta linha digitável.**
//
// ⚠⚠ AS QUATRO COLUNAS SÃO UMA MÁQUINA DE ESTADOS, NÃO QUATRO CAMPOS SOLTOS
// (a tabela completa está no cabeçalho de `20260818230000_add_linha_digitavel_motivo_guia`):
//
//   lidaEm NULL                              → NÃO TENTAMOS
//   lidaEm + linha                           → TEMOS A LINHA
//   lidaEm + motivo + valorLido              → DIVERGÊNCIA (mostra os dois valores)
//   lidaEm + motivo                          → TENTAMOS E NÃO DEU
//
// `linhaDigitavelLidaEm` é gravado em TODA tentativa, inclusive nas que recusam — é ele, sozinho,
// que separa "não tentamos" de "tentamos e não deu".
//
// ⚠ `linhaDigitavelValorLidoCentavos` é preenchido EXCLUSIVAMENTE na recusa por valor divergente,
// onde os cinco DVs fecharam e o número codificado é confiável. Em recusa de DV/tamanho/produto a
// sequência já se provou corrompida, e imprimir um valor tirado dela seria inventar pela porta dos
// fundos. Travado em `__tests__/lerLinhaDigitavelDoPdf.test.js`.

import {
  MOTIVOS,
  conferirContraDocumento,
  extrairLinhaDigitavelDoTexto,
} from "./linhaDigitavelArrecadacao.js";

/**
 * As quatro situações que a tela precisa distinguir. Nomes fechados: a tela faz de-para explícito e
 * um valor não catalogado NÃO ganha frase inventada.
 */
export const SITUACAO_LINHA = Object.freeze({
  DISPONIVEL: "DISPONIVEL", // temos a linha, conferida
  NAO_TENTADA: "NAO_TENTADA", // guia antiga, ou sem PDF — ninguém tentou ler
  DIVERGENTE: "DIVERGENTE", // lemos, e a linha discorda da guia — os dois valores importam
  NAO_ENCONTRADA: "NAO_ENCONTRADA", // tentamos e o documento não traz linha legível
});

/**
 * Traduz as quatro colunas gravadas na situação que a tela desenha. É a MESMA máquina de estados do
 * cabeçalho da migration, lida de volta — por isso mora aqui, ao lado de quem a escreve, e não no
 * serializador: as duas pontas não podem divergir.
 *
 * @param {{linhaDigitavel?: string|null, linhaDigitavelLidaEm?: any, linhaDigitavelMotivo?: string|null}} item
 * @returns {"DISPONIVEL"|"NAO_TENTADA"|"DIVERGENTE"|"NAO_ENCONTRADA"}
 */
export function situacaoDaLinhaDigitavel(item) {
  if (!item || !item.linhaDigitavelLidaEm) return SITUACAO_LINHA.NAO_TENTADA;
  if (item.linhaDigitavel) return SITUACAO_LINHA.DISPONIVEL;
  if (item.linhaDigitavelMotivo === MOTIVOS.VALOR_DIVERGENTE) return SITUACAO_LINHA.DIVERGENTE;
  return SITUACAO_LINHA.NAO_ENCONTRADA;
}

/** Motivos que este módulo acrescenta ao vocabulário do extrator puro. */
export const MOTIVOS_LEITURA = {
  SEM_PDF: "sem_pdf_guardado",
  PDF_ILEGIVEL: "pdf_ilegivel",
  SEM_VALOR_PARA_CONFERIR: "sem_valor_na_guia_para_conferir",
};

/** Estado "não tentamos": as quatro colunas nulas. Não é o mesmo que uma recusa. */
export const NAO_TENTADA = Object.freeze({
  linhaDigitavel: null,
  linhaDigitavelLidaEm: null,
  linhaDigitavelMotivo: null,
  linhaDigitavelValorLidoCentavos: null,
});

function recusa(motivo, lidaEm, valorLidoCentavos = null) {
  return {
    linhaDigitavel: null,
    linhaDigitavelLidaEm: lidaEm,
    linhaDigitavelMotivo: motivo,
    // ⚠ A invariante: só o caminho de valor divergente chega aqui com número.
    linhaDigitavelValorLidoCentavos:
      motivo === MOTIVOS.VALOR_DIVERGENTE && Number.isInteger(valorLidoCentavos) ? valorLidoCentavos : null,
  };
}

/**
 * Extrai o texto de um PDF. Isolado para o teste poder injetar um leitor e não depender de um
 * binário real — e porque `pdf-parse` é CJS e só pode entrar por import dinâmico.
 */
async function textoPadraoDoPdf(buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  return String((await pdfParse(buffer))?.text || "");
}

/**
 * Lê a linha digitável de arrecadação do PDF da guia e devolve o PATCH das quatro colunas, pronto
 * para ser espalhado no `data` do Prisma.
 *
 * NUNCA lança: uma guia não pode deixar de ser salva porque o PDF dela é ilegível. Falha vira
 * recusa nomeada — que é informação, não erro.
 *
 * @param {Buffer|Uint8Array|null|undefined} pdfBuffer PDF da guia
 * @param {{valorTotal?: number|string|null, vencimento?: string|Date|null}} referencia
 *        o que já sabemos da guia — o MESMO valor que está sendo gravado nesta operação
 * @param {{lerTexto?: (b:any)=>Promise<string>, agora?: Date}} [opcoes] injeção para teste
 * @returns {Promise<{linhaDigitavel: string|null, linhaDigitavelLidaEm: Date|null,
 *                    linhaDigitavelMotivo: string|null, linhaDigitavelValorLidoCentavos: number|null}>}
 */
export async function lerLinhaDigitavelDoPdf(pdfBuffer, referencia = {}, opcoes = {}) {
  const agora = opcoes.agora instanceof Date ? opcoes.agora : new Date();
  const lerTexto = opcoes.lerTexto || textoPadraoDoPdf;

  // Sem PDF não houve tentativa — e "não tentamos" NÃO é uma recusa. Guia de parcelamento sem DAS
  // emitido e marcador de "sem movimento" caem aqui, e a tela deve dizer que ninguém tentou.
  if (!pdfBuffer || !pdfBuffer.length) return { ...NAO_TENTADA };

  let texto;
  try {
    texto = await lerTexto(pdfBuffer);
  } catch {
    return recusa(MOTIVOS_LEITURA.PDF_ILEGIVEL, agora);
  }

  const lida = extrairLinhaDigitavelDoTexto(texto);
  if (!lida.ok) return recusa(lida.motivo, agora);

  // ⚠ SEM REFERÊNCIA NÃO HÁ CONFERÊNCIA, E SEM CONFERÊNCIA NÃO HÁ NÚMERO PAGÁVEL.
  // `conferirContraDocumento` pula a comparação quando o valor esperado é nulo — o que é correto
  // para um diagnóstico, mas aqui produziria uma linha "aprovada" que ninguém conferiu contra nada.
  // A guia sem valor (upload não identificado) fica sem linha, com motivo próprio.
  const valorTotal = referencia?.valorTotal;
  if (valorTotal == null || String(valorTotal).trim() === "") {
    return recusa(MOTIVOS_LEITURA.SEM_VALOR_PARA_CONFERIR, agora);
  }

  const conferida = conferirContraDocumento(lida, {
    valorTotal,
    vencimento: referencia?.vencimento ?? null,
  });

  if (!conferida.ok) {
    // Único caminho que carrega número: os DVs fecharam, então `lida.valorCentavos` é o que o
    // documento realmente imprime. Nas outras recusas nem chegamos aqui com linha íntegra.
    const valorLido =
      conferida.motivo === MOTIVOS.VALOR_DIVERGENTE && Number.isInteger(lida.valorCentavos)
        ? lida.valorCentavos
        : null;
    return recusa(conferida.motivo, agora, valorLido);
  }

  return {
    linhaDigitavel: conferida.linhaDigitavel,
    linhaDigitavelLidaEm: agora,
    linhaDigitavelMotivo: null,
    linhaDigitavelValorLidoCentavos: null,
  };
}
