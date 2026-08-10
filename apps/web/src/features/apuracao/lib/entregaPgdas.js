// ONDE ESTÁ A DECLARAÇÃO DO PGDAS-D DESTA COMPETÊNCIA — uma leitura só, para todas as telas.
//
// ⚠ POR QUE ISTO EXISTE, E POR QUE É A PERGUNTA MAIS PERIGOSA DESTE MÓDULO
// A empresa sem faturamento também declara o PGDAS-D, zerado. Pelo PORTAL isso nunca saiu (a RFB
// recusava o formato que enviávamos), e o dono confirmou que as declarações **existem e foram
// entregues à mão**, no gov.br. Ou seja: o portal não estava impedindo entrega nenhuma — estava
// exibindo pendência que não existe, em ~190 competências.
//
// ⚠ PROCEDÊNCIA É A DISTINÇÃO, E ELA JÁ FOI PERDIDA UMA VEZ NESTE PROJETO (o RBT12 que não pode
// ser gravado como "veio da simulação" porque o número é nosso). São TRÊS origens, e elas não se
// equivalem:
//
//   · CAPTURADA DA RFB      — o extrato trouxe o número da declaração. Prova, e não é nossa.
//                             Medido: 15 zeradas já estão gravadas assim, entregues à mão.
//   · TRANSMITIDA POR NÓS   — o portal enviou e a RFB devolveu o número. Prova.
//   · AFIRMADA PELO CONTADOR— ele diz que entregou, sem extrato. É palavra, não prova.
//
// ⚠ E EXISTE UM QUARTO ESTADO QUE NÃO PODE SE PARECER COM "ESTÁ DEVENDO": **não sabemos**. Se
// ninguém consultou o extrato daquela competência, ausência de número não é ausência de entrega —
// é ausência de consulta. (Medido: 20 de 102 circulares com marca de PGDAS-D perderam o PDF do
// `metadata`; o número da declaração, que é COLUNA (`pgdasNumeroDeclaracao`), sobreviveu — por isso
// a leitura se ancora nele, nunca no PDF.) Vermelho fica reservado para o único caso em que a
// Receita FOI perguntada e respondeu que não há declaração.
//
// ⚠ Nada aqui transmite coisa alguma, e nenhum estado daqui autoriza transmitir. Fechar a
// competência como zerada resolve o mês DO NOSSO LADO; a obrigação perante a Receita é outra
// pergunta, e é justamente a que estas cinco respostas separam.

/**
 * Verde = provado (por quem quer que seja). Neutro = afirmado pelo contador. Âmbar = falta
 * consultar o extrato. Vermelho = a Receita foi consultada e não há declaração.
 */
export const TOM_ENTREGA = {
  ok: "ok",
  declarado: "declarado",
  desconhecido: "desconhecido",
  nao_entregue: "nao_entregue",
};

/** A Receita chegou a ser consultada para esta competência? */
function extratoFoiConsultado(extratoStatus, extratoConsultadoEm) {
  return Boolean(extratoConsultadoEm) || ["SUCCESS", "NOT_FOUND"].includes(String(extratoStatus || ""));
}

/**
 * @param {object} f fatos crus (nenhum veredito) — vêm do `getDadosFechamento`
 * @param {string|null} f.estadoApuracao   `ApuracaoSnapshot.estado` desta competência
 * @param {string|null} f.numeroDeclaracaoPortal  `ApuracaoSnapshot.numeroDeclaracao` (o que NÓS transmitimos)
 * @param {string|null} f.numeroDeclaracaoRfb     `CompanyMonthlyCircular.pgdasNumeroDeclaracao` (o que a RFB devolveu no extrato)
 * @param {string|null} f.extratoStatus           `CompanyMonthlyCircular.serproSyncStatus`
 * @param {string|Date|null} f.extratoConsultadoEm `serproLastSyncAt`
 * @param {string|Date|null} f.declaradaForaEm    marca manual do contador
 * @param {boolean} f.temPdfDaDeclaracao          `pgdasDeclaracaoFileId` presente
 * @returns {{chave:string, rotulo:string, detalhe:string, tom:string, provada:boolean, origem:string}}
 */
export function estadoEntregaPgdas({
  estadoApuracao = null,
  numeroDeclaracaoPortal = null,
  numeroDeclaracaoRfb = null,
  extratoStatus = null,
  extratoConsultadoEm = null,
  declaradaForaEm = null,
  temPdfDaDeclaracao = false,
} = {}) {
  // 1. Transmitida por AQUI, com o número que a RFB devolveu na transmissão.
  if (estadoApuracao === "transmitida" && numeroDeclaracaoPortal) {
    return {
      chave: "transmitida_pelo_portal",
      rotulo: "Entregue pelo portal",
      detalhe: `Declaração ${numeroDeclaracaoPortal}, transmitida daqui.`,
      tom: TOM_ENTREGA.ok,
      provada: true,
      origem: "portal",
    };
  }
  // 2. Entregue FORA e CAPTURADA da Receita — a prova que já está no nosso banco.
  //    Dois caminhos, os dois com procedência da RFB e nenhum deles nosso:
  //      · o extrato trouxe o número da declaração daquele PA;
  //      · a transmissão daqui parou no "PA já declarado" (estado vira "transmitida" SEM número —
  //        quem entregou foi outro). Chamar isso de "entregue pelo portal" seria nos creditar de
  //        um envio que não fizemos.
  if (numeroDeclaracaoRfb || estadoApuracao === "transmitida") {
    return {
      chave: "capturada_da_rfb",
      rotulo: "Entregue fora do portal — capturada do extrato da Receita",
      detalhe: numeroDeclaracaoRfb
        ? `A Receita tem a declaração ${numeroDeclaracaoRfb} para esta competência`
          + `${temPdfDaDeclaracao ? ", e o PDF está guardado aqui" : ""}. Não foi transmitida daqui.`
        : "A Receita já tinha declaração para esta competência quando o portal consultou. Não foi transmitida daqui.",
      tom: TOM_ENTREGA.ok,
      provada: true,
      origem: "rfb",
    };
  }
  // 3. O contador AFIRMA que entregou fora.
  if (declaradaForaEm) {
    // ⚠ EVIDÊNCIA CONTRA A AFIRMAÇÃO. Se o extrato foi consultado DEPOIS do registro e a Receita
    // não achou declaração nenhuma, as duas coisas não podem conviver caladas — é a mesma regra
    // que faz `marcarSemFaturamento` recusar afirmação contra nota emitida. Só vale quando a
    // consulta é POSTERIOR: extrato antigo simplesmente não viu a entrega que veio depois.
    const consultaPosterior = String(extratoStatus || "") === "NOT_FOUND"
      && extratoConsultadoEm && declaradaForaEm
      && new Date(extratoConsultadoEm).getTime() > new Date(declaradaForaEm).getTime();
    if (consultaPosterior) {
      return {
        chave: "declarada_fora_desmentida",
        rotulo: "Entrega declarada, mas a Receita não achou a declaração",
        detalhe: "O registro diz que esta competência foi entregue fora do portal, e o extrato "
          + "consultado depois disso não encontrou declaração para o período. Confira no gov.br "
          + "antes de considerar o mês resolvido.",
        tom: TOM_ENTREGA.nao_entregue,
        provada: false,
        origem: "contador",
      };
    }
    return {
      chave: "declarada_fora",
      rotulo: "Entregue fora do portal — declarado pelo contador",
      detalhe: "Registro feito aqui a partir da sua afirmação; a Receita não confirmou nada. "
        + "Buscar o extrato do Simples traz o número da declaração e transforma isto em comprovação.",
      tom: TOM_ENTREGA.declarado,
      provada: false,
      origem: "contador",
    };
  }
  // 4. Ninguém perguntou à Receita. Ausência de consulta NÃO é ausência de entrega.
  if (!extratoFoiConsultado(extratoStatus, extratoConsultadoEm)) {
    return {
      chave: "sem_informacao",
      rotulo: "Entrega desconhecida — o extrato nunca foi consultado",
      detalhe: "O portal não sabe se a declaração desta competência foi entregue: ninguém buscou o "
        + "extrato do Simples aqui. Isto não é o mesmo que estar em aberto — buscar o extrato "
        + "responde, e o registro de entrega feita fora também.",
      tom: TOM_ENTREGA.desconhecido,
      provada: false,
      origem: "nenhuma",
    };
  }
  // 5. A Receita foi perguntada e não há declaração. É o único caso realmente em aberto.
  return {
    chave: "nao_entregue",
    rotulo: "PGDAS-D NÃO entregue",
    detalhe: "O extrato do Simples foi consultado e a Receita não tem declaração desta "
      + "competência. A obrigação está em aberto — fechar como empresa zerada resolve o mês aqui "
      + "dentro, não perante a Receita.",
    tom: TOM_ENTREGA.nao_entregue,
    provada: false,
    origem: "rfb",
  };
}

/** Cores por tom — tokens de ESTADO, cada um no significado dele (`apps/web/CLAUDE.md`). */
export const CORES_TOM = {
  [TOM_ENTREGA.ok]: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  [TOM_ENTREGA.declarado]: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  [TOM_ENTREGA.desconhecido]: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  [TOM_ENTREGA.nao_entregue]: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
};

/** Lê os fatos do payload do `getFechamento` sem espalhar o formato por três telas. */
export function entregaPgdasDoFechamento(dados) {
  const e = dados?.entregaPgdas || {};
  return estadoEntregaPgdas({
    estadoApuracao: dados?.estado || dados?.snapshot?.estado || null,
    numeroDeclaracaoPortal: dados?.snapshot?.numeroDeclaracao || null,
    numeroDeclaracaoRfb: e.numeroDeclaracaoRfb || null,
    extratoStatus: e.extratoStatus || null,
    extratoConsultadoEm: e.extratoConsultadoEm || null,
    declaradaForaEm: e.declaradaForaEm || null,
    temPdfDaDeclaracao: Boolean(e.temPdfDaDeclaracao),
  });
}
