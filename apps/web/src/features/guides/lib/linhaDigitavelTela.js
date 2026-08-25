// ⚠⚠ ESPELHO — ESTE ARQUIVO TEM UMA CÓPIA DELIBERADA NO PORTAL DO CLIENTE.
//
//   `apps/portal-cliente-web/src/features/guias/lib/linhaDigitavelTela.js`
//
// As três ausências (`NAO_TENTADA` / `NAO_ENCONTRADA` / `DIVERGENTE`) são as mesmas. ⚠⚠ O TEXTO
// diverge de propósito: o cliente **não vê os dois valores** da divergência — são material de
// TRABALHO do contador, e mostrá-los entregaria um problema sem entregar a ação.
//
// ⚠ Os dois frontends NÃO compartilham código; a obrigação de sincronizar é de quem edita, e a
// tabela "mudou lá, muda aqui" vive em `apps/portal-cliente-web/CLAUDE.md`. ⚠ Duas leituras da
// mesma regra divergem na primeira correção — e a divergência aparece como as duas telas afirmando
// coisas diferentes sobre a MESMA empresa, que é o defeito mais caro de achar.
//
// ⚠ Este aviso foi acrescentado em 24/08/2026: até então **12 dos 13 originais eram mudos** sobre
// ter cópia, e a tabela do `CLAUDE.md` só é consultada por quem já sabe que ela existe.

// A LINHA DIGITÁVEL NA TELA DO CONTADOR — e, sobretudo, as TRÊS AUSÊNCIAS.
//
// ⚠⚠ AUSÊNCIA É RESPOSTA, E ELA TEM TRÊS SIGNIFICADOS QUE NÃO PODEM SER DESENHADOS IGUAIS:
//
//   1. NÃO TENTAMOS      — guia antiga (anterior a esta leitura) ou sem PDF guardado. Ninguém
//                          olhou o documento. Dizer "não foi possível ler" aqui seria afirmar uma
//                          tentativa que não houve.
//   2. NÃO ENCONTRADA    — olhamos e o documento não traz linha de arrecadação legível. É o caso do
//                          boleto bancário de cobrança (47 dígitos, outro layout, deliberadamente
//                          fora do escopo) e do PDF sem texto.
//   3. DIVERGENTE        — ⚠ o caso que existe de verdade na base. Lemos uma linha ÍNTEGRA (os cinco
//                          dígitos verificadores fecham) cujo valor DISCORDA do valor da guia.
//                          Não sabemos qual dos dois números está errado, então a linha NUNCA é
//                          mostrada — mas ESCONDER O CONFLITO É PIOR QUE NÃO TER O NÚMERO. Aqui, e
//                          só aqui, os dois valores aparecem.
//
// ⚠ DE-PARA DE LISTA FECHADA, como em `apuracao-v2/lib/pendenciaTela.js` e `list/lib/estadoVazioGuias.js`:
// motivo não catalogado NÃO ganha frase inventada. Vira texto neutro, com o valor cru sobrevivendo
// no `title` para uma auditoria poder recuperá-lo. Enum novo não se conclui por semelhança.
//
// ⚠ CORES: verde é CONCLUÍDO neste portal, e nunca ação primária — ter a linha não é uma etapa
// concluída, é um dado disponível, então ele é NEUTRO. A divergência é pendência (âmbar), não
// bloqueio: vermelho aqui é o que trava o fechamento, e uma linha que não bate não trava nada.

export const SITUACAO = Object.freeze({
  DISPONIVEL: "DISPONIVEL",
  NAO_TENTADA: "NAO_TENTADA",
  DIVERGENTE: "DIVERGENTE",
  NAO_ENCONTRADA: "NAO_ENCONTRADA",
});

/**
 * Lista FECHADA de motivos de recusa. A chave é o valor gravado em `Guide.linhaDigitavelMotivo`
 * (vocabulário de `application/guides/linhaDigitavelArrecadacao.js` + `lerLinhaDigitavelDoPdf.js`).
 * ⚠ Motivo ausente desta tabela NÃO recebe frase: ver `frasePorMotivo`.
 */
export const FRASE_POR_MOTIVO = Object.freeze({
  linha_digitavel_nao_encontrada_no_texto: "o documento não traz uma linha de arrecadação legível",
  sem_pdf_guardado: "não há PDF guardado desta guia",
  pdf_ilegivel: "não foi possível abrir o PDF",
  sem_valor_na_guia_para_conferir: "a guia não tem valor gravado para conferir a linha",
  tamanho_diferente_de_48: "o número encontrado não tem os 48 dígitos da arrecadação",
  primeiro_digito_nao_e_8: "o número encontrado não é de arrecadação",
  identificador_de_valor_desconhecido: "o número encontrado usa um identificador de valor desconhecido",
  dv_de_bloco_nao_confere: "um dígito verificador do número não fecha",
  dv_geral_nao_confere: "o dígito verificador geral do número não fecha",
  valor_nao_e_efetivo_em_reais: "a linha não codifica valor em reais, então não há como conferi-la",
  linhas_digitaveis_divergentes_no_documento: "o documento traz duas linhas diferentes",
  vencimento_divergente_do_documento: "o vencimento da linha discorda do vencimento da guia",
});

/**
 * ⚠ Motivo NÃO CATALOGADO não vira frase. Devolve `null`, e quem chama diz apenas que não foi
 * possível ler — com o valor cru no `title`. Concluir "deve ser parecido com aquele outro" é
 * exatamente como um enum novo passa a mentir.
 */
export function frasePorMotivo(motivo) {
  const chave = String(motivo || "");
  return Object.prototype.hasOwnProperty.call(FRASE_POR_MOTIVO, chave) ? FRASE_POR_MOTIVO[chave] : null;
}

/** Só os dígitos — é o que se digita no banco. */
export function somenteDigitos(v) {
  return String(v == null ? "" : v).replace(/\D+/g, "");
}

/**
 * Máscara de LEITURA HUMANA: 4 grupos de 11 dígitos + 1 verificador, como o documento imprime.
 * ⚠ Serve só para os olhos. O que se COPIA são os 48 dígitos limpos.
 */
export function formatarLinhaDigitavel(linha) {
  const d = somenteDigitos(linha);
  if (d.length !== 48) return null;
  return [d.slice(0, 12), d.slice(12, 24), d.slice(24, 36), d.slice(36, 48)]
    .map((b) => `${b.slice(0, 11)}-${b.slice(11)}`)
    .join(" ");
}

function brl(centavos) {
  if (!Number.isFinite(centavos)) return null;
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Traduz a guia do contrato (`toGuideResponse`) no que a linha da tabela precisa desenhar.
 *
 * @param {object} guia item de `getCompanyGuides`
 * @returns {{situacao: string, linhaLimpa: string|null, linhaFormatada: string|null,
 *            titulo: string, resumo: string, detalhe: string|null, tom: string,
 *            motivoCru: string|null}}
 */
export function linhaDigitavelDaGuia(guia) {
  const situacao = String(guia?.linhaDigitavelSituacao || SITUACAO.NAO_TENTADA);
  const motivoCru = guia?.linhaDigitavelMotivo || null;

  if (situacao === SITUACAO.DISPONIVEL && guia?.linhaDigitavel) {
    const limpa = somenteDigitos(guia.linhaDigitavel);
    return {
      situacao: SITUACAO.DISPONIVEL,
      linhaLimpa: limpa,
      linhaFormatada: formatarLinhaDigitavel(limpa),
      resumo: formatarLinhaDigitavel(limpa) || limpa,
      titulo: "Linha digitável lida do documento e conferida contra o valor da guia.",
      detalhe: null,
      tom: "var(--text-muted)",
      motivoCru,
    };
  }

  if (situacao === SITUACAO.DIVERGENTE) {
    // ⚠ O ÚNICO lugar onde os dois números aparecem juntos. A linha em si NÃO é mostrada.
    const naLinha = brl(Number(guia?.linhaDigitavelValorLidoCentavos));
    const naGuia = guia?.valor != null ? brl(Math.round(Number(guia.valor) * 100)) : null;
    const detalhe =
      naLinha && naGuia
        ? `o documento traz ${naLinha} e a guia está com ${naGuia}`
        : naLinha
          ? `o documento traz ${naLinha}, diferente do valor da guia`
          : "o valor do documento discorda do valor da guia";
    return {
      situacao: SITUACAO.DIVERGENTE,
      linhaLimpa: null,
      linhaFormatada: null,
      resumo: "confira: valores divergentes",
      titulo:
        `A linha impressa no documento não bate com o valor da guia — ${detalhe}. `
        + "Não mostramos o número porque não se sabe qual dos dois está errado. "
        + "Recapturar ou corrigir o valor da guia refaz a leitura.",
      detalhe,
      tom: "var(--state-warn)",
      motivoCru,
    };
  }

  if (situacao === SITUACAO.NAO_ENCONTRADA) {
    const frase = frasePorMotivo(motivoCru);
    return {
      situacao: SITUACAO.NAO_ENCONTRADA,
      linhaLimpa: null,
      linhaFormatada: null,
      resumo: "sem linha no documento",
      // Frase só quando o motivo está catalogado; senão, a afirmação para no que se sabe.
      titulo: frase
        ? `Lemos o documento e ${frase}.`
        : "Lemos o documento e não foi possível obter a linha digitável.",
      detalhe: null,
      tom: "var(--text-muted)",
      motivoCru,
    };
  }

  return {
    situacao: SITUACAO.NAO_TENTADA,
    linhaLimpa: null,
    linhaFormatada: null,
    resumo: "não lida",
    titulo:
      "Ainda não lemos o documento desta guia — ela é anterior à leitura da linha digitável, ou não "
      + "tem PDF guardado. Isto não quer dizer que o documento não tenha a linha.",
    detalhe: null,
    tom: "var(--text-muted)",
    motivoCru,
  };
}
