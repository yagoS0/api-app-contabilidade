// ESTORNO DA BAIXA — a transição administrativa, com motivo, auditoria e contra-lançamento.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// O QUE MUDOU, E POR QUÊ
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// O estorno existia como EFEITO COLATERAL do `DELETE /entries/:entryId`: apagar o lançamento de
// baixa reabria a guia e devolvia a parcela à fila. O comportamento estava certo e era testado. O
// problema era a FORMA:
//
//   · não havia MOTIVO. Desfazer uma baixa confirmada é exatamente o tipo de operação que alguém
//     questiona meses depois, e a resposta disponível era "alguém apagou";
//   · a transição de estado da parcela pulava a máquina de estados com um comentário explicando o
//     porquê — regra que vive num comentário é regra que o próximo caminho de escrita não lê;
//   · e, o mais grave, em MÊS FECHADO ele não podia acontecer de jeito nenhum (409), o que é
//     correto para o DELETE mas deixava o contador sem NENHUMA saída legítima: a baixa errada
//     ficava lá, e a única forma de corrigi-la era reabrir a competência.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ MÊS FECHADO: CONTRA-LANÇAMENTO, NUNCA DELETE
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Se a baixa está em competência FECHADA, o estorno **não apaga nada**. Ele deixa o lançamento
// original onde está e cria um ESPELHO INVERTIDO na competência ABERTA.
//
// Sem isso, a trava de mês fechado do `DELETE` viraria letra morta por esta porta lateral: bastaria
// pedir o estorno para apagar lançamento de mês fechado sem nenhum rastro de reabertura — que é
// precisamente o buraco que a trava existe para fechar. O saldo de um mês já reportado não muda
// retroativamente; ele é CORRIGIDO no mês corrente, com o lançamento que corrige à vista de todos.
//
// A competência do espelho é a de HOJE, e não "a primeira competência aberta que eu achar":
// procurar um mês aberto seria escolher a competência de um fato contábil por conveniência. O fato
// é o estorno, e ele aconteceu hoje. Se o mês corrente também estiver fechado, a operação é
// RECUSADA com o motivo — não existe terceiro lugar honesto para pôr esse lançamento.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ O ESPELHO NÃO É `tipo:"BAIXA"` — e este era o furo mais provável da tarefa
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// A migration `20260808120000_add_baixa_tipo_linha` instalou duas travas sobre as baixas:
//
//   CHECK  chk_baixa_tipo_linha : tipo <> 'BAIXA' OR "tipoLinha" IS NOT NULL
//   UNIQUE uq_baixa_guia_linha  : ("sourceGuideId","tipoLinha",COALESCE("codigoTributo",''))
//                                 WHERE tipo='BAIXA' AND "sourceGuideId" IS NOT NULL …
//
// Um espelho gravado como BAIXA satisfaria o CHECK sem esforço (o papel da linha é o mesmo da
// original) e **bateria de frente com o índice único**: em mês fechado a baixa original CONTINUA
// NA TABELA, então as duas linhas coexistiriam com a mesma guia, o mesmo papel e o mesmo código de
// receita. Para o índice isso não é "o espelho da primeira" — é, letra por letra, a assinatura de
// uma baixa DUPLICADA. Resultado: 23505, e o estorno em mês fechado quebrando justo no caso que
// esta fase existe para cobrir.
//
// Afrouxar o índice para caber (tirar o COALESCE, acrescentar coluna à chave) reabriria a janela
// que ele fechou. Inventar um papel ('ESTORNO_PARC') seria mentir sobre o papel da linha para
// escapar de uma trava. A saída certa é semântica: **o espelho não é uma baixa**. Baixa amortiza
// passivo; o espelho devolve o passivo. `tipo:"ESTORNO"` deixa as duas travas inertes por
// construção — as duas são parciais em `tipo='BAIXA'` — sem afrouxar nenhuma delas.
//
// E isso não é só conveniência de índice: `computeSaldoProvisao` soma os débitos não-acréscimo de
// tudo que pendura em `openEntryId`. O espelho debita o CAIXA; contado como baixa, ele seria lido
// como MAIS amortização, e a provisão iria para o lado errado em dobro. Como ESTORNO, ele é
// SUBTRAÍDO (ver `computeSaldoProvisao`, em `routes/firm/accountingEntries.js`).

import { prisma } from "../../infrastructure/db/prisma.js";
import { isMonthClosed } from "./fechamentoContabil.js";
import { estadoAposEstorno, PARCELA_ESTADOS } from "./parcelamento/parcelaStateMachine.js";
import { recalcularParcelamento } from "./parcelamento/recalculoParcelamento.js";
// A MESMA conta de saldo que a tela de baixa usa — ela saiu da fábrica de rotas exatamente para
// que o estorno não precisasse de uma segunda cópia. Ver `saldoProvisao.js`.
import { computeSaldoProvisao } from "./saldoProvisao.js";

export const MOTIVO_MIN = 5;
export const MODO = Object.freeze({ DELECAO: "DELECAO", CONTRA_LANCAMENTO: "CONTRA_LANCAMENTO" });

/** Erro de negócio com código estável para a rota traduzir em status HTTP. */
export class EstornoRecusado extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "EstornoRecusado";
    this.code = code;
    Object.assign(this, extra);
  }
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function competenciaDe(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Valor do lançamento = soma dos DÉBITOS (numa perna só, é a própria perna). */
function valorDoLancamento(entry) {
  const lines = entry?.lines || [];
  const d = lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  if (d > 0) return r2(d);
  // Lançamento de uma perna só que é CRÉDITO (o `C CAIXA` do lote do parcelamento).
  return r2(lines.reduce((s, l) => s + Number(l.valor || 0), 0));
}

const SELECT_LANCAMENTO = {
  id: true, portalClientId: true, tipo: true, status: true, competencia: true, data: true,
  historico: true, subtipo: true, origem: true, eventType: true,
  openEntryId: true, sourceGuideId: true, parcelamentoId: true, loteImportacao: true,
  tipoLinha: true, codigoTributo: true,
  lines: { select: { conta: true, tipo: true, valor: true, ordem: true, tipoLinha: true, codigoTributo: true }, orderBy: { ordem: "asc" } },
};

/**
 * O LOTE que será desfeito.
 *
 * ⚠ UMA BAIXA SÃO ATÉ TRÊS LANÇAMENTOS (principal, juros e multa são separados, em contas
 * diferentes — e o parcelamento com comprovante chega a quatro, com o `C CAIXA` em perna própria).
 * Estornar um de três deixaria os outros órfãos, debitando contas de uma guia que voltou a "não
 * paga" — pior que não estornar. Por isso o estorno é do LOTE, sempre, e é o lote inteiro que
 * aparece na confirmação.
 *
 * Sem guia (baixa da rota genérica, que só tem `openEntryId`), o lote é o próprio lançamento.
 */
async function carregarLote(client, { portalClientId, entry }) {
  if (!entry.sourceGuideId) return [entry];
  const lote = await client.accountingEntry.findMany({
    where: { portalClientId, sourceGuideId: entry.sourceGuideId, tipo: "BAIXA" },
    select: SELECT_LANCAMENTO,
    orderBy: { createdAt: "asc" },
  });
  return lote.length ? lote : [entry];
}

/**
 * O que o contador tem de VER antes de confirmar — com valores.
 *
 * Estorno é ato de consequência: some um pagamento do razão, um passivo volta a existir e uma
 * parcela volta para a fila. Quem confirma tem de ver exatamente o que vai ser desfeito, lançamento
 * a lançamento, e o que vai acontecer depois (o modo, a competência do espelho, o novo risco de
 * rescisão). É esta função que alimenta essa tela — e é o `totalEstornado` daqui que a execução
 * exige de volta como conferência.
 */
export async function previewEstorno({ portalClientId, entryId, agora = new Date() }) {
  const entry = await prisma.accountingEntry.findFirst({
    where: { id: entryId, portalClientId },
    select: SELECT_LANCAMENTO,
  });
  if (!entry) throw new EstornoRecusado("lancamento_nao_encontrado", "Lançamento não encontrado.");
  if (String(entry.tipo).toUpperCase() !== "BAIXA") {
    throw new EstornoRecusado(
      "NAO_E_BAIXA",
      `Só uma baixa pode ser estornada — este lançamento é ${entry.tipo}. Use a exclusão normal do lançamento.`,
      { tipo: entry.tipo },
    );
  }
  if (entry.status === "EXPORTADO") {
    throw new EstornoRecusado("lancamento_ja_exportado", "Lançamento já exportado — não pode ser estornado.");
  }

  const lote = await carregarLote(prisma, { portalClientId, entry });
  const exportado = lote.find((e) => e.status === "EXPORTADO");
  if (exportado) {
    throw new EstornoRecusado(
      "LOTE_JA_EXPORTADO",
      `A baixa tem ${lote.length} lançamento(s) e um deles já foi exportado (${exportado.historico}). O lote é estornado inteiro ou nenhum.`,
      { entryId: exportado.id },
    );
  }

  const competenciaOriginal = entry.competencia;
  const mesFechado = await isMonthClosed(portalClientId, competenciaOriginal);
  const competenciaHoje = competenciaDe(agora);
  const modo = mesFechado ? MODO.CONTRA_LANCAMENTO : MODO.DELECAO;

  const bloqueios = [];
  if (modo === MODO.CONTRA_LANCAMENTO && await isMonthClosed(portalClientId, competenciaHoje)) {
    // ⚠ Recusa explícita, com o caminho de saída na mensagem. "Ausência nunca é resposta": o pior
    // desfecho aqui seria escolher sozinho outra competência aberta — inventar a data de um fato
    // contábil para não ter de dizer não.
    bloqueios.push({
      code: "MES_CORRENTE_FECHADO",
      competencia: competenciaHoje,
      message: `A baixa está em ${competenciaOriginal}, que já foi fechada, então o estorno tem de sair como contra-lançamento em ${competenciaHoje} — que também está fechada. Reabra ${competenciaHoje} para estornar.`,
    });
  }

  const guide = entry.sourceGuideId
    ? await prisma.guide.findFirst({
      where: { id: entry.sourceGuideId, portalClientId },
      select: {
        id: true, tipo: true, competencia: true, valor: true, vencimento: true,
        numeroParcela: true, parcelamentoId: true, parcelaEstado: true,
        paymentStatus: true, paymentStatusSource: true, lancamentoId: true, baixada: true,
      },
    })
    : null;

  const estadoNovo = guide ? estadoAposEstorno({ estadoAtual: guide.parcelaEstado }) : null;
  const pagamentoSeraDesfeito = Boolean(guide) && String(guide.paymentStatusSource || "").toUpperCase() === "MANUAL";

  const provisao = entry.openEntryId
    ? await prisma.accountingEntry.findFirst({
      where: { id: entry.openEntryId, portalClientId },
      select: { id: true, historico: true, competencia: true, statusPagamento: true },
    })
    : null;

  const parcelamentoId = entry.parcelamentoId || guide?.parcelamentoId || null;
  const recalculoAtual = parcelamentoId
    ? await recalcularParcelamento(prisma, { portalClientId, parcelamentoId, agora })
    : null;

  const lancamentos = lote.map((e) => ({
    id: e.id,
    historico: e.historico,
    competencia: e.competencia,
    data: e.data,
    tipoLinha: e.tipoLinha,
    codigoTributo: e.codigoTributo,
    valor: valorDoLancamento(e),
    linhas: (e.lines || []).map((l) => ({ conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0) })),
  }));

  return {
    modo,
    mesFechado,
    competenciaOriginal,
    competenciaContraLancamento: modo === MODO.CONTRA_LANCAMENTO ? competenciaHoje : null,
    lancamentos,
    // ⚠ SÓ OS DÉBITOS somam o total apresentado: no lote do parcelamento existe uma perna de
    // CAIXA em crédito, e somá-la contaria o mesmo dinheiro duas vezes na tela de confirmação.
    totalEstornado: r2(lancamentos.reduce(
      (s, l) => s + l.linhas.filter((x) => String(x.tipo).toUpperCase() === "D").reduce((a, x) => a + x.valor, 0),
      0,
    )),
    guia: guide && {
      id: guide.id, tipo: guide.tipo, competencia: guide.competencia,
      numeroParcela: guide.numeroParcela, vencimento: guide.vencimento,
      valor: guide.valor != null ? Number(guide.valor) : null,
      parcelaEstado: guide.parcelaEstado,
      parcelaEstadoAposEstorno: estadoNovo,
      paymentStatusSource: guide.paymentStatusSource,
      pagamentoSeraDesfeito,
      reabre: true, // o lote inteiro sai; ver a guarda `restantes` na execução
    },
    provisao,
    parcelamentoId,
    recalculoAtual,
    motivoObrigatorio: true,
    bloqueios,
  };
}

/**
 * Executa o estorno. Tudo numa transação: ou o lote inteiro é desfeito, a guia volta e a auditoria
 * é gravada, ou nada acontece.
 *
 * @param {string} motivo OBRIGATÓRIO. Ver `EstornoBaixa.motivo` — há CHECK no banco também.
 * @param {number} [totalConferido] o total que o contador VIU na confirmação. Quando informado, tem
 *   de bater com o total que está prestes a sair.
 */
export async function executarEstorno({
  portalClientId, entryId, motivo, userId, totalConferido = null, agora = new Date(),
}) {
  const motivoLimpo = String(motivo || "").trim();
  if (motivoLimpo.length < MOTIVO_MIN) {
    // ⚠ A PRIMEIRA COISA CHECADA, e antes de qualquer leitura. Sem motivo não se lê, não se
    // escreve, não se recusa "no final": a operação não começa.
    throw new EstornoRecusado(
      "MOTIVO_OBRIGATORIO",
      `Informe o motivo do estorno (mínimo ${MOTIVO_MIN} caracteres). Desfazer uma baixa confirmada é o tipo de operação que alguém vai questionar meses depois — sem o motivo, o registro responde "o quê" e deixa "por quê" para a memória de quem clicou.`,
      { minimo: MOTIVO_MIN },
    );
  }

  const preview = await previewEstorno({ portalClientId, entryId, agora });
  if (preview.bloqueios.length) {
    const b = preview.bloqueios[0];
    throw new EstornoRecusado(b.code, b.message, { competencia: b.competencia });
  }
  if (totalConferido != null && Math.abs(r2(totalConferido) - preview.totalEstornado) > 0.01) {
    // ⚠ Não é cerimônia: entre a tela e o clique, outra sessão (ou o worker de confirmação de
    // pagamento) pode ter acrescentado o lançamento de juros ao lote. Quem confirmou viu dois
    // lançamentos e estaria desfazendo três.
    throw new EstornoRecusado(
      "CONFERENCIA_DIVERGENTE",
      `O que está para ser estornado (R$ ${preview.totalEstornado.toFixed(2)}) não é o que foi confirmado (R$ ${r2(totalConferido).toFixed(2)}). A baixa mudou desde que a tela foi aberta — confira de novo.`,
      { totalEstornado: preview.totalEstornado, totalConferido: r2(totalConferido) },
    );
  }

  const ids = preview.lancamentos.map((l) => l.id);

  return prisma.$transaction(async (tx) => {
    const lote = await tx.accountingEntry.findMany({
      where: { id: { in: ids }, portalClientId },
      select: SELECT_LANCAMENTO,
    });
    if (lote.length !== ids.length) {
      throw new EstornoRecusado("LOTE_MUDOU", "A baixa mudou enquanto o estorno era processado — tente de novo.");
    }

    const contraLancamentos = [];
    if (preview.modo === MODO.CONTRA_LANCAMENTO) {
      for (const e of lote) {
        // eslint-disable-next-line no-await-in-loop
        const espelho = await tx.accountingEntry.create({
          data: {
            portalClientId,
            data: agora,
            competencia: preview.competenciaContraLancamento,
            historico: `ESTORNO ${e.historico} (${e.competencia})`,
            // ⚠ NÃO É "BAIXA". Ver o cabeçalho: como BAIXA colidiria com `uq_baixa_guia_linha`
            // (a original continua na tabela) e seria contado como MAIS amortização.
            tipo: "ESTORNO",
            subtipo: e.subtipo,
            origem: "MANUAL",
            status: "RASCUNHO",
            statusPagamento: "NA",
            // ⚠ `eventType: null` — só a baixa original carrega o evento. Repetir violaria
            // `@@unique([portalClientId, competencia, eventType, origem])` assim que houvesse dois
            // estornos do mesmo evento no mesmo mês.
            eventType: null,
            // O vínculo com a provisão FICA: é ele que permite a `computeSaldoProvisao` subtrair o
            // que a baixa original ainda soma (ela não foi apagada).
            openEntryId: e.openEntryId,
            // ⚠ A GUIA FICA VINCULADA: sem isso, o contra-lançamento não seria rastreável a partir
            // da guia. É seguro porque as duas travas do banco são parciais em `tipo='BAIXA'`, e
            // porque a busca por baixas restantes filtra por `tipo:"BAIXA"`.
            sourceGuideId: e.sourceGuideId,
            // ⚠ O lote do parcelamento só balanceia EM GRUPO (cada lançamento tem uma perna só), e
            // `computeFechamentoBlockers` agrupa por `parcelamentoId`. Sem carregá-lo, os espelhos
            // apareceriam como quatro lançamentos desbalanceados e travariam o fechamento do mês
            // seguinte.
            parcelamentoId: e.parcelamentoId,
            loteImportacao: `ESTORNO-${String(e.id).slice(0, 8)}`,
            tipoLinha: e.tipoLinha,
            codigoTributo: e.codigoTributo,
            estornoDeEntryId: e.id,
            lines: {
              createMany: {
                // O ESPELHO: mesmas contas, mesmos valores, D↔C invertidos. Nada de "conta de
                // estorno" — o que desfaz um débito em 553 é um crédito em 553, na própria conta.
                data: (e.lines || []).map((l, i) => ({
                  conta: l.conta,
                  tipo: String(l.tipo).toUpperCase() === "D" ? "C" : "D",
                  valor: Number(l.valor || 0),
                  ordem: i,
                  tipoLinha: l.tipoLinha || null,
                  codigoTributo: l.codigoTributo || null,
                })),
              },
            },
          },
          select: { id: true, historico: true, competencia: true },
        });
        contraLancamentos.push(espelho);
      }
    } else {
      await tx.accountingEntry.deleteMany({ where: { id: { in: ids }, portalClientId } });
    }

    // ── A provisão de abertura volta a ter saldo ────────────────────────────────────────────
    // Vale nos DOIS modos: na deleção porque as baixas sumiram; no contra-lançamento porque o
    // espelho passou a subtrair (`computeSaldoProvisao`).
    const openIds = [...new Set(lote.map((e) => e.openEntryId).filter(Boolean))];
    for (const openId of openIds) {
      // eslint-disable-next-line no-await-in-loop
      const open = await tx.accountingEntry.findFirst({
        where: { id: openId, portalClientId },
        include: { lines: { orderBy: { ordem: "asc" } }, baixas: { include: { lines: { orderBy: { ordem: "asc" } } } } },
      });
      if (!open) continue;
      const s = computeSaldoProvisao(open);
      const status = s.abatido <= 0.009 ? "ABERTO" : (s.saldo <= 0.009 ? "PAGO" : "PARCIAL");
      // eslint-disable-next-line no-await-in-loop
      await tx.accountingEntry.update({ where: { id: openId }, data: { statusPagamento: status } });
    }

    // ── A guia volta à fila ─────────────────────────────────────────────────────────────────
    let guideAtualizada = null;
    let estadoAnterior = null;
    let estadoNovo = null;
    const guideId = lote.find((e) => e.sourceGuideId)?.sourceGuideId || null;
    if (guideId) {
      // ⚠ A GUIA SÓ VOLTA QUANDO NÃO SOBRA NENHUMA BAIXA DELA. O estorno leva o lote inteiro, mas a
      // regra não depende disso: se por qualquer caminho sobrar uma baixa, reabrir a guia deixaria
      // lançamentos órfãos debitando contas de uma guia "não paga" — pior que não reverter.
      // `tipo:"BAIXA"` no filtro é o que mantém os contra-lançamentos (tipo ESTORNO) fora da conta.
      const restantes = await tx.accountingEntry.findMany({
        where: { sourceGuideId: guideId, portalClientId, tipo: "BAIXA", id: { notIn: ids } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      const guide = await tx.guide.findFirst({
        where: { id: guideId, portalClientId },
        select: {
          id: true, paymentStatusSource: true, lancamentoId: true,
          parcelamentoId: true, parcelaEstado: true, vencimento: true,
        },
      });
      if (guide && restantes.length) {
        if (ids.includes(guide.lancamentoId)) {
          guideAtualizada = await tx.guide.update({
            where: { id: guide.id }, data: { lancamentoId: restantes[0].id },
          });
        }
      } else if (guide) {
        estadoAnterior = guide.parcelaEstado || null;
        // TRANSIÇÃO ADMINISTRATIVA NOMEADA: … → ESTORNADA (`parcelaStateMachine.js`). Não é mais
        // um desvio de código: quem não pode ser estornada (CANCELADA, ou parcela nunca paga) não
        // está na tabela administrativa e devolve `null` — o estado fica como está.
        estadoNovo = estadoAposEstorno({ estadoAtual: guide.parcelaEstado });
        // Só desfaz o PAGAMENTO se ele veio DESTA baixa (fonte MANUAL). Confirmação do SERPRO fica:
        // o dinheiro saiu e o comprovante existe; o que se desfaz é o lançamento, não o fato.
        const fromManual = String(guide.paymentStatusSource || "").toUpperCase() === "MANUAL";
        guideAtualizada = await tx.guide.update({
          where: { id: guide.id },
          data: {
            baixada: false,
            dataBaixa: null,
            lancamentoId: null,
            ...(estadoNovo ? { parcelaEstado: estadoNovo } : {}),
            ...(fromManual
              ? {
                paymentStatus: "OPEN",
                paymentStatusSource: null,
                paymentConfirmedAt: null,
                paymentConfirmedByUserId: null,
                serproLastCheckResult: null,
              }
              : {}),
          },
        });
      }
    }

    // ── O RECÁLCULO (exigência 3) ───────────────────────────────────────────────────────────
    // Dentro da transação e DEPOIS das escritas: o número tem de refletir o mundo já estornado.
    // A regra da IN RFB 2.063/2022 não é recalculada aqui — `recalcularParcelamento` chama
    // `avaliarRiscoRescisao`, que já a traz como dado da modalidade.
    const parcelamentoId = preview.parcelamentoId;
    const recalculo = parcelamentoId
      ? await recalcularParcelamento(tx, { portalClientId, parcelamentoId, agora })
      : null;

    // ── A AUDITORIA (exigência 1) ───────────────────────────────────────────────────────────
    // Uma linha por lançamento desfeito, com CÓPIA do que ele dizia: no modo DELECAO a linha
    // original não existe mais depois deste commit.
    const estornos = [];
    for (let i = 0; i < lote.length; i += 1) {
      const e = lote[i];
      // eslint-disable-next-line no-await-in-loop
      const reg = await tx.estornoBaixa.create({
        data: {
          portalClientId,
          entryIdOriginal: e.id,
          competenciaOriginal: e.competencia,
          historicoOriginal: e.historico,
          valorOriginal: valorDoLancamento(e),
          tipoLinha: e.tipoLinha,
          codigoTributo: e.codigoTributo,
          guideId: e.sourceGuideId,
          parcelamentoId: e.parcelamentoId || parcelamentoId,
          openEntryId: e.openEntryId,
          modo: preview.modo,
          contraLancamentoId: contraLancamentos[i]?.id || null,
          competenciaContra: preview.competenciaContraLancamento,
          motivo: motivoLimpo,
          estornadoPorUserId: userId ? String(userId) : null,
          estornadoEm: agora,
          parcelaEstadoAnterior: estadoAnterior,
          parcelaEstadoNovo: estadoNovo,
          riscoNivel: recalculo?.risco?.nivel || null,
          riscoEmAtraso: recalculo?.risco?.emAtraso ?? null,
        },
        select: { id: true },
      });
      estornos.push(reg.id);
    }

    return {
      ok: true,
      modo: preview.modo,
      motivo: motivoLimpo,
      estornoIds: estornos,
      lancamentosDesfeitos: preview.lancamentos,
      totalEstornado: preview.totalEstornado,
      contraLancamentos,
      competenciaContraLancamento: preview.competenciaContraLancamento,
      guia: guideAtualizada && {
        id: guideAtualizada.id,
        baixada: guideAtualizada.baixada,
        parcelaEstado: guideAtualizada.parcelaEstado,
        paymentStatus: guideAtualizada.paymentStatus,
      },
      parcelaEstadoAnterior: estadoAnterior,
      parcelaEstadoNovo: estadoNovo,
      recalculo,
    };
  });
}

export { PARCELA_ESTADOS };
