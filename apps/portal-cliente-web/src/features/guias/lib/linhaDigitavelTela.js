// A LINHA DIGITÁVEL NA TELA DO CLIENTE — quem paga é ele, então esta é a tela que mais importa.
//
// ⚠⚠ AS TRÊS AUSÊNCIAS TÊM SIGNIFICADOS DIFERENTES E NÃO PODEM SER DESENHADAS IGUAIS:
//   1. NÃO TENTAMOS      — guia antiga ou sem PDF guardado. Ninguém olhou o documento.
//   2. NÃO ENCONTRADA    — olhamos e o documento não traz linha de arrecadação legível.
//   3. DIVERGENTE        — lemos uma linha íntegra que DISCORDA do valor da guia.
//
// ⚠ A DIFERENÇA EM RELAÇÃO AO PORTAL DO CONTADOR É DELIBERADA, e é a coisa mais importante deste
// arquivo: **o cliente NÃO vê os dois valores da divergência.** Os dois números são material de
// TRABALHO do contador (é ele quem descobre qual dos dois está errado e conserta); mostrá-los ao
// cliente entregaria um problema sem entregar a ação, e ainda por cima com dois valores em conflito
// numa tela cujo assunto é "quanto eu pago". O que o cliente precisa saber é que aquele número está
// sendo conferido e por isso não está disponível — que é a verdade.
//
// ⚠⚠ **E A FRASE SÓ PROMETE O PDF QUANDO O PDF EXISTE PARA ESTE CLIENTE (30/08/2026).** Desde que a
// aba passou a listar guia não liberada, o download dela responde 404 — e a linha exibia
// *"Baixe o PDF para pagar"* ao lado de um botão desabilitado, duas frases da mesma linha se
// contradizendo. Achado no NAVEGADOR, com a suíte verde.
// ⚠ A frase encurta, e não repete o motivo: ele já está na célula de ações
// (`motivoDaGuiaNaoLiberada`), e dizer a mesma coisa duas vezes na mesma linha é o defeito que o
// `ESCOPO` de `notas/lib/impedimento.js` já nomeia neste app.
//
// ⚠ Nos TRÊS casos o "Baixar PDF" continua sendo a saída, e a frase diz isso. Ausência de linha
// nunca pode virar ausência de caminho para pagar.
//
// ⚠ De-para de LISTA FECHADA (mesma disciplina do portal do contador): o cliente nunca vê o motivo
// técnico, mas motivo desconhecido também não vira frase inventada — cai no texto neutro.

import { liberadaAoCliente } from "./recalculoDaGuia.js";

export const SITUACAO = Object.freeze({
  DISPONIVEL: "DISPONIVEL",
  NAO_TENTADA: "NAO_TENTADA",
  DIVERGENTE: "DIVERGENTE",
  NAO_ENCONTRADA: "NAO_ENCONTRADA",
});

/** Só os dígitos — é o que se digita no aplicativo do banco. */
export function somenteDigitos(v) {
  return String(v == null ? "" : v).replace(/\D+/g, "");
}

/**
 * Máscara de LEITURA: 4 grupos de 11 dígitos + 1 verificador, como o documento imprime.
 * ⚠ Só para o olho conferir. O que se COPIA são os 48 dígitos limpos.
 */
export function formatarLinhaDigitavel(linha) {
  const d = somenteDigitos(linha);
  if (d.length !== 48) return null;
  return [d.slice(0, 12), d.slice(12, 24), d.slice(24, 36), d.slice(36, 48)]
    .map((b) => `${b.slice(0, 11)}-${b.slice(11)}`)
    .join(" ");
}

/**
 * @param {object} guia item de `GET /client/companies/:id/guides` (`toGuideResponse`)
 * @returns {{situacao: string, linhaLimpa: string|null, linhaFormatada: string|null,
 *            aviso: string|null, tom: "neutro"|"atencao"}}
 */
/**
 * ⚠ A promessa do PDF, ou nada. Guia não liberada não tem download (o servidor devolve 404), e
 * mandar o cliente baixá-lo seria oferecer uma saída que não abre.
 */
function saidaPeloPdf(guia) {
  return liberadaAoCliente(guia) ? " Baixe o PDF para pagar." : "";
}

export function linhaDigitavelDaGuia(guia) {
  const situacao = String(guia?.linhaDigitavelSituacao || SITUACAO.NAO_TENTADA);

  if (situacao === SITUACAO.DISPONIVEL && guia?.linhaDigitavel) {
    const limpa = somenteDigitos(guia.linhaDigitavel);
    return {
      situacao: SITUACAO.DISPONIVEL,
      linhaLimpa: limpa,
      linhaFormatada: formatarLinhaDigitavel(limpa),
      aviso: null,
      tom: "neutro",
    };
  }

  if (situacao === SITUACAO.DIVERGENTE) {
    return {
      situacao: SITUACAO.DIVERGENTE,
      linhaLimpa: null,
      linhaFormatada: null,
      // ⚠ Sem os dois números, e sem sugerir que o cliente pague "assim mesmo".
      aviso:
        "Em conferência com o contador — o número impresso no documento não confere com o valor "
        + "desta guia."
        + (liberadaAoCliente(guia) ? " Enquanto isso, use o PDF para pagar." : ""),
      tom: "atencao",
    };
  }

  if (situacao === SITUACAO.NAO_ENCONTRADA) {
    return {
      situacao: SITUACAO.NAO_ENCONTRADA,
      linhaLimpa: null,
      linhaFormatada: null,
      aviso: `Este documento não traz linha digitável.${saidaPeloPdf(guia)}`,
      tom: "neutro",
    };
  }

  return {
    situacao: SITUACAO.NAO_TENTADA,
    linhaLimpa: null,
    linhaFormatada: null,
    // ⚠ NÃO diz "não tem" — diz que ainda não foi lida. São coisas diferentes.
    aviso: `Ainda não lemos a linha digitável desta guia.${saidaPeloPdf(guia)}`,
    tom: "neutro",
  };
}
