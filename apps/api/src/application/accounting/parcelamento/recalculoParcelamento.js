// RECÁLCULO DO PARCELAMENTO — parcelas pagas, atraso e alerta de rescisão.
//
// ⚠ ESTE ARQUIVO NÃO CALCULA A REGRA DE RESCISÃO. Ele reúne as parcelas e chama
// `avaliarRiscoRescisao` (`riscoRescisao.js`), que já traz a regra da IN RFB 2.063/2022 como DADO
// da modalidade, com os dois casos (I e II) e a marca `citacaoConferida:false`. Uma segunda
// implementação daquela conta é a última coisa que este módulo pode ter: as duas divergiriam, e o
// contador veria "tudo em dia" numa tela e "rescindível" na outra, sobre a mesma empresa.
//
// Por que ele existe, então: o risco só era calculado no caminho de LEITURA
// (`decorateParcelamento`, ao listar parcelamentos). O estorno precisa da mesma resposta na hora em
// que desfaz a baixa — para devolvê-la a quem clicou e para gravá-la na auditoria. Sem isso, a
// resposta do estorno diria "pronto" e o contador só descobriria que acabou de empurrar a empresa
// para a terceira prestação em atraso na próxima vez que abrisse a tela de parcelamentos.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { avaliarRiscoRescisao } from "./riscoRescisao.js";
import { estadoEmAberto, PARCELA_ESTADOS } from "./parcelaStateMachine.js";

/**
 * A prestação está QUITADA para efeito da regra de rescisão?
 *
 * ⚠ `baixada` entra junto com `PAID` de propósito, e o critério é o mesmo de `decorateParcelamento`
 * — está aqui, exportado, para que haja UM predicado e não dois. Pagamento PARCIAL não quita: quem
 * paga parcial não marca `PAID`, e para a RFB a prestação segue inadimplida (é a divergência mais
 * cara do fluxo, documentada em `riscoRescisao.js`).
 */
export function parcelaQuitada(guide) {
  return String(guide?.paymentStatus || "").toUpperCase() === "PAID" || Boolean(guide?.baixada);
}

/**
 * F2.1 — o mesmo predicado, agora perguntado à PARCELA.
 *
 * ⚠ ELE NÃO REESCREVE `parcelaQuitada`, ELE O CHAMA. Enquanto o caminho de baixa for por guia
 * (`gerarPagamentoParcelaFromGuide` exige `guideId`), a autoridade sobre "foi paga?" continua sendo
 * a guia; a parcela não guarda cópia de `baixada`/`paymentStatus` justamente para não haver duas
 * respostas divergindo no primeiro estorno.
 *
 * `origemBaixa` é o outro caminho, e a **F2.2 já grava nele**: `gerarPagamentoParcelaManual`
 * (baixa por DECLARAÇÃO de uma parcela que nunca teve guia — débito automático) escreve `"MANUAL"`,
 * e `marcarParcelasHistoricas` escreve `"HISTORICO"`. A previsão se confirmou ao pé da letra: estando
 * lido aqui, a F2.2 mudou UMA escrita e todas as derivações passaram a enxergar a quitação sozinhas.
 */
export function parcelaRowQuitada(parcela) {
  if (parcela?.origemBaixa) return true;
  return parcela?.guia ? parcelaQuitada(parcela.guia) : false;
}

/**
 * Existe ALGUMA evidência sobre o pagamento desta prestação?
 *
 * ⚠ ESTA É A DISTINÇÃO QUE A TABELA `parcelas` TORNOU POSSÍVEL — E A QUE IMPEDE UM ALERTA FALSO.
 * Antes, uma prestação sem guia simplesmente não existia, então nunca entrava na conta. Agora ela
 * existe; e se entrasse como "não quitada", TODO parcelamento em débito automático (que não tem
 * guia nenhuma, por definição) apareceria com dezenas de prestações em atraso e sairia
 * RESCINDÍVEL — inadimplência inventada a partir de ausência de dado, que é a regra 1 do dono ao
 * contrário. E um alerta que acende em todo mundo é o alerta que ninguém lê, que é exatamente o
 * que `riscoRescisao.js` já se recusa a fazer com parcela futura.
 *
 * Ausência de guia não é prova de não-pagamento. Sem guia e sem `origemBaixa`, a prestação fica
 * FORA do cálculo de risco e é reportada em `parcelasSemEvidencia` — visível, nomeada, não contada.
 */
export function temEvidenciaDePagamento(parcela) {
  return Boolean(parcela?.origemBaixa) || Boolean(parcela?.guia);
}

/**
 * F2.1 — O QUADRO DO PARCELAMENTO, DERIVADO DE UMA FONTE SÓ.
 *
 * Antes o numerador vinha das GUIAS e o denominador de outro lugar; quem não tinha guia era
 * invisível no primeiro e presente no segundo. Aqui os dois saem da MESMA lista de parcelas, e é
 * essa a correção: `parcelasTotal` são as prestações CONTRATADAS, `parcelasPagas` são aquelas
 * dentre elas com evidência de quitação.
 *
 * ⚠ O vencimento resolve `guia.vencimento ?? parcela.vencimento`: quando há guia, o vencimento REAL
 * é o dela (veio do SERPRO/PDF); o da parcela é o cronograma CONTRATADO, um plano. Uma cópia do
 * vencimento da guia dentro da parcela envelheceria no primeiro recálculo do SERPRO.
 *
 * @param {Array} parcelas linhas de `parcelas`, cada uma com `guia` incluída (ou nula)
 */
export function quadroDasParcelas(parcelas, { status = null, agora = new Date() } = {}) {
  const lista = Array.isArray(parcelas) ? parcelas : [];
  const comEvidencia = lista.filter(temEvidenciaDePagamento);

  return {
    parcelasPagas: lista.filter(parcelaRowQuitada).length,
    parcelasTotal: lista.length,
    parcelasSemEvidencia: lista.length - comEvidencia.length,
    risco: status === "RESCINDIDO"
      ? null
      : avaliarRiscoRescisao({
        parcelas: comEvidencia.map((p) => ({
          numeroParcela: p.numeroParcela ?? null,
          vencimento: p.guia?.vencimento ?? p.vencimento,
          quitada: parcelaRowQuitada(p),
        })),
        agora,
      }),
  };
}

/**
 * O que as derivações precisam ler de cada parcela — uma lista só, para não divergirem.
 *
 * ⚠ `competencia` e `valorPrevisto` ENTRARAM AQUI, e não numa segunda leitura. Os dois são fato do
 * CONTRATO (que prestação é, quanto ela vale), da mesma natureza de `numeroParcela`/`vencimento`
 * que já estavam — e a ausência do primeiro já mordeu: `parcelasContratadas` alimenta a tela, o
 * modal de anexo lia `parcela.competencia` e recebia `undefined` em produção, com o campo nascendo
 * vazio. A fila de prestações SEM GUIA (abaixo) precisa dos dois para renderizar a linha inteira;
 * lê-los num `select` próprio seria a segunda fonte que diverge na primeira mudança de coluna.
 *
 * ⚠ `valorPrevisto` é `Decimal` do Prisma — quem o usa como número converte (`Number(...)`), como
 * `sincronizarParcelas` e `gerarPagamentoParcelaManual` já fazem.
 */
export const SELECT_PARCELA_PARA_QUADRO = Object.freeze({
  id: true,
  numeroParcela: true,
  competencia: true,
  vencimento: true,
  valorPrevisto: true,
  origemBaixa: true,
  guia: { select: { id: true, vencimento: true, paymentStatus: true, baixada: true } },
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// A FILA DA PRESTAÇÃO **SEM GUIA** — a outra pergunta, e ela não é a mesma da fila que já existe.
//
// `/parcelamentos/parcelas-pendentes-baixa` responde *"a guia foi paga, falta lançar"*: há um SINAL
// EXTERNO (o `paymentStatus` que veio do SERPRO) e a fila só repete o que ele diz. Ela filtra por
// `guia: { paymentStatus: "PAID", … }` — prestação sem guia não tem por onde entrar nela, e um
// contrato inteiro em débito automático fica com fila vazia para sempre.
//
// Esta responde *"esta prestação venceu e não há guia; você declara que foi debitada?"*. Não há
// sinal nenhum: a evidência é a declaração do contador, e é por isso que a resposta desta fila
// nunca pode ser apresentada como se fosse a da outra.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Fim do dia CIVIL de `agora`.
 *
 * ⚠ É SÓ A JANELA DA FILA, NÃO UMA DEFINIÇÃO DE ATRASO. Quem diz se a prestação está vencida
 * continua sendo `estadoEmAberto` (`parcelaStateMachine.js`), o mesmo predicado
 * (`vencimento < agora`) que `avaliarRiscoRescisao` usa na linha 58 do `riscoRescisao.js`. O que
 * este fim-de-dia acrescenta é EXCLUSIVAMENTE a prestação que vence HOJE — que no débito
 * automático é justamente a que o contador tem em mãos, e que o projeto já trata como "a vencer"
 * (não vencida) em `circular/lib/estadoGuia.js`. Ela entra na fila e sai rotulada `VENCE_HOJE`,
 * nunca como atraso.
 */
export function fimDoDiaDe(agora = new Date()) {
  const d = new Date(agora);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * O critério de "entra na fila", como DADO — para que a rota, o teste e um eventual segundo
 * consumidor leiam a mesma coisa.
 *
 * As três condições, e de onde cada uma vem:
 *
 * | condição | de onde |
 * |---|---|
 * | `guiaId: null` | é a pré-condição da própria baixa por declaração: `gerarPagamentoParcelaManual` recusa com `parcela_tem_guia` e aponta o outro caminho. Listar prestação com guia aqui seria oferecer o botão que o servidor recusa |
 * | `origemBaixa: null` | é o predicado de quitação da parcela sem guia (`parcelaRowQuitada` só pergunta isso), e é a MESMA coluna da reserva atômica da baixa. Cobre `MANUAL`, `DEBITO_AUTOMATICO` e `HISTORICO` de uma vez |
 * | `vencimento <= fim de hoje` | vencida pelo predicado de sempre, mais a que vence hoje (ver `fimDoDiaDe`). Prestação futura fica fora: ela não é "não paga", é "ainda não devida" — a mesma recusa que `avaliarRiscoRescisao` já faz |
 *
 * ⚠ Prestação SEM VENCIMENTO fica de fora, e isso é o contrário de esconder: sem data não se
 * afirma que venceu (`competenciaInicial` sentinela `1970-01` faz o cronograma nascer sem datas).
 * Ela continua contada em `parcelasSemEvidencia`, no card do contrato, com o nome dela.
 *
 * ⚠ Parcelamento RESCINDIDO fica de fora pela MESMA decisão de `quadroDasParcelas` — lá o risco é
 * `null` porque "não há mais o que prevenir". Uma fila de trabalho sobre um acordo morto seria
 * trabalho inventado.
 */
export function whereParcelaSemGuiaPendente({ portalClientId = null, agora = new Date() } = {}) {
  return {
    ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    guiaId: null,
    origemBaixa: null,
    vencimento: { not: null, lte: fimDoDiaDe(agora) },
    parcelamento: { is: { status: { not: "RESCINDIDO" } } },
  };
}

/** O que a linha da fila precisa além do quadro: o CONTRATO, para o front não fazer N+1. */
export const SELECT_PARCELA_FILA_SEM_GUIA = Object.freeze({
  ...SELECT_PARCELA_PARA_QUADRO,
  parcelamentoId: true,
  parcelamento: {
    select: {
      id: true, label: true, tipo: true, kind: true, numParcelas: true,
      numeroParcelamento: true, formaPagamento: true, status: true,
      // ⚠ `aberturaEntryId` NÃO é enfeite: sem provisão de abertura a baixa é recusada
      // (`provisao_inexistente`), e o contador merece saber disso ANTES de preencher o formulário.
      aberturaEntryId: true,
    },
  },
});

/** `VENCIDA` (o predicado de sempre) ou `VENCE_HOJE` (só a janela da fila). */
export function situacaoDaPrestacaoSemGuia(parcela, agora = new Date()) {
  return estadoEmAberto(parcela?.vencimento, agora) === PARCELA_ESTADOS.EM_ATRASO
    ? "VENCIDA"
    : "VENCE_HOJE";
}

/**
 * A linha da fila, pronta para renderizar — parcela, competência, valor e contrato numa resposta só.
 *
 * ⚠ `podeBaixar` REPETE AS GUARDAS DA ROTA DE BAIXA, e não as substitui. Quem recusa continua sendo
 * `gerarPagamentoParcelaManual` (é ele que enxerga o estado do momento do clique); isto é
 * antecipação, para que o botão nunca fique desabilitado sem o motivo à vista.
 */
export function linhaDaFilaSemGuia(p, agora = new Date()) {
  const parc = p?.parcelamento || null;
  const valorPrevisto = p?.valorPrevisto != null ? Number(p.valorPrevisto) : null;
  const semProvisao = !parc?.aberturaEntryId;
  const semValor = !(Number.isFinite(valorPrevisto) && valorPrevisto > 0);
  return {
    parcelaId: p.id,
    numeroParcela: p.numeroParcela ?? null,
    competencia: p.competencia ?? null,
    vencimento: p.vencimento ?? null,
    // ⚠ O PRINCIPAL É O VALOR **CONTRATADO**, e a baixa continua lendo-o de `parcelas.valorPrevisto`
    // — nunca do body dela. O que mudou é que ele passou a ser CORRIGÍVEL, por uma rota própria
    // (`PATCH .../parcelas/:parcelaId/valor-previsto`): a fonte segue única, e a correção escreve
    // NA fonte em vez de contorná-la. Corrigir o contrato e declarar um pagamento são dois atos.
    valorPrevisto,
    situacao: situacaoDaPrestacaoSemGuia(p, agora),
    parcelamentoId: p.parcelamentoId ?? parc?.id ?? null,
    parcelamento: parc
      ? {
        id: parc.id,
        label: parc.label,
        tipo: parc.tipo || parc.kind || null,
        numParcelas: parc.numParcelas ?? null,
        numeroParcelamento: parc.numeroParcelamento ?? null,
        // Já exibido no card; viaja aqui para a fila poder dizer "é assim que este contrato paga".
        formaPagamento: parc.formaPagamento ?? null,
        temProvisaoDeAbertura: Boolean(parc.aberturaEntryId),
      }
      : null,
    podeBaixar: !semProvisao && !semValor,
    // ⚠ OS DOIS MOTIVOS NÃO SE RESOLVEM NO MESMO LUGAR, e a tela precisa saber disso:
    // `provisao_inexistente` exige lançar a adesão (outra tela); `sem_valor_previsto` se resolve
    // NO PRÓPRIO modal de baixa, corrigindo o valor contratado. Por isso o `podeBaixar` continua
    // falso nos dois (o servidor recusaria a baixa AGORA, nos dois casos) mas o segundo não é
    // beco sem saída — ele é o estado normal de todo contrato criado sem guia.
    motivoBloqueio: semProvisao ? "provisao_inexistente" : (semValor ? "sem_valor_previsto" : null),
    corrigivelNaTela: !semProvisao && semValor,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A AUSÊNCIA DEIXA DE SER MUDA — as prestações que a RESCISÃO tirou da fila
//
// `whereParcelaSemGuiaPendente` exclui o parcelamento RESCINDIDO, e a exclusão está CERTA: o risco é
// `null` porque "não há mais o que prevenir", e uma fila de trabalho sobre um acordo morto é
// trabalho inventado. O defeito nunca foi o filtro — foi o SILÊNCIO dele.
//
// Medido no dia 10/08/2026: os dois contratos rescindidos de uma mesma empresa somam **70
// prestações**, e as 69 vencidas sumiram da fila de uma vez. Fila vazia é EXATAMENTE o mesmo pixel
// de "não há nada pendente", então o dono passou o dia concluindo que a baixa sem guia não
// funcionava — e ela funcionava.
//
// O conserto não é passar a incluí-las (isso desfaria a decisão acima). É a fila passar a DIZER
// quantas ficaram de fora, de quais contratos, e por quê — com o caminho para reverter. É a mesma
// regra que o resto do módulo já segue: **ausência nunca é resposta**.
//
// ⚠ O PREDICADO É DERIVADO DO DA FILA, não reescrito. Ele é, literalmente, "a mesma pergunta com o
// status invertido" — e é assim que se garante que o número mostrado ("N prestações fora da fila")
// conta EXATAMENTE as linhas que entrariam se o contrato não estivesse rescindido. Uma segunda
// cópia do filtro faria a fila e o aviso discordarem, que é a forma mais cara possível de contar
// isso ao contador.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export function whereParcelaForaDaFilaPorRescisao({ portalClientId = null, agora = new Date() } = {}) {
  const { parcelamento: _daFila, ...mesmasCondicoes } = whereParcelaSemGuiaPendente({ portalClientId, agora });
  return { ...mesmasCondicoes, parcelamento: { is: { status: "RESCINDIDO" } } };
}

/** O contrato precisa vir junto: o aviso nomeia o acordo, e o botão de reverter precisa do id. */
export const SELECT_PARCELA_FORA_DA_FILA = Object.freeze({
  id: true,
  numeroParcela: true,
  vencimento: true,
  parcelamentoId: true,
  parcelamento: {
    select: { id: true, label: true, tipo: true, kind: true, numeroParcelamento: true, status: true },
  },
});

/**
 * O aviso, agrupado POR CONTRATO — não uma lista de 69 linhas.
 *
 * ⚠ Sessenta e nove parágrafos idênticos é o defeito que este módulo já cometeu uma vez (as 60
 * prestações "sem guia" repetindo o mesmo motivo dentro de um card de 360px). O que o contador
 * precisa saber é: QUANTAS, de QUAL acordo, e o que fazer. A prestação individual não acrescenta
 * nada aqui — ela volta a aparecer, uma a uma, no instante em que a rescisão for desfeita.
 */
export function resumoForaDaFilaPorRescisao(parcelas) {
  const porContrato = new Map();
  for (const p of parcelas || []) {
    const parc = p?.parcelamento || null;
    const id = p?.parcelamentoId || parc?.id || null;
    if (!id) continue;
    if (!porContrato.has(id)) {
      porContrato.set(id, {
        parcelamentoId: id,
        label: parc?.label || null,
        tipo: parc?.tipo || parc?.kind || null,
        numeroParcelamento: parc?.numeroParcelamento || null,
        status: parc?.status || "RESCINDIDO",
        prestacoes: 0,
      });
    }
    porContrato.get(id).prestacoes += 1;
  }
  const contratos = [...porContrato.values()].sort((a, b) => b.prestacoes - a.prestacoes);
  return {
    prestacoes: contratos.reduce((s, c) => s + c.prestacoes, 0),
    contratos,
    // O motivo viaja como DADO, não como frase montada na rota: quem exibe escolhe a forma, mas não
    // reinventa a causa.
    motivo: "PARCELAMENTO_RESCINDIDO",
  };
}

/**
 * Recalcula o quadro do parcelamento DEPOIS de um estorno (ou de qualquer mudança de baixa).
 *
 * Lê as PARCELAS do parcelamento (F2.1 — antes eram as guias) e devolve o que muda o dia do
 * contador: quantas prestações estão quitadas, quantas venceram sem pagamento, quantas não têm
 * evidência nenhuma e em que nível de risco o acordo está.
 *
 * ⚠ Parcelamento já RESCINDIDO não é avaliado (`risco: null`) — não há mais o que prevenir. Mesma
 * decisão de `decorateParcelamento`.
 *
 * @param {object} client prisma OU um `tx` — o estorno chama de DENTRO da transação, para que o
 *   número gravado na auditoria seja o do estado já estornado, e não o de antes.
 */
export async function recalcularParcelamento(client, { portalClientId, parcelamentoId, agora = new Date() }) {
  if (!parcelamentoId) return null;
  const parc = await client.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    select: { id: true, status: true, numParcelas: true },
  });
  if (!parc) return null;

  // ⚠ F2.1 — A FONTE MUDOU DE `guide` PARA `parcela`, E A REGRA NÃO.
  //
  // Antes: `parcelasTotal: guides.length || parc.numParcelas` — numerador e denominador de fontes
  // DIFERENTES, com um `||` escolhendo entre elas. Um parcelamento de 52 prestações com 3 guias
  // capturadas reportava "1 de 3"; um sem guia nenhuma reportava "0 de 52" e um risco calculado
  // sobre lista vazia. Agora as duas pontas saem da mesma lista de parcelas contratadas.
  //
  // ⚠ `vencimento` continua sendo o que decide o atraso, e ele é resolvido em `quadroDasParcelas`
  // como `guia.vencimento ?? parcela.vencimento` — o real quando existe, o contratado quando não.
  const parcelas = await client.parcela.findMany({
    where: { parcelamentoId, portalClientId },
    select: SELECT_PARCELA_PARA_QUADRO,
  });

  const quadro = quadroDasParcelas(parcelas, { status: parc.status, agora });

  return {
    parcelamentoId,
    status: parc.status,
    parcelasPagas: quadro.parcelasPagas,
    parcelasTotal: quadro.parcelasTotal,
    parcelasSemEvidencia: quadro.parcelasSemEvidencia,
    emAtraso: quadro.risco?.emAtraso ?? null,
    risco: quadro.risco,
  };
}
