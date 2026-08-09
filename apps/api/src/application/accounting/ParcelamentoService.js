// Q9: serviço de Parcelamentos (Simples Nacional, INSS, DARF, OUTRO).
//
// Operações:
//   - createParcelamento: gera cabeçalho + 1 entry de ABERTURA + N entries de provisão de parcela
//   - rescindirParcelamento: gera entry de RESCISÃO + marca status RESCINDIDO
//   - listParcelamentos: consulta
//
// ⚠ TRÊS FUNÇÕES SAÍRAM DAQUI NA F2.3, com as rotas que só elas serviam (nenhuma tinha chamador, e
// produção não tem um único parcelamento V1):
//   · `getParcelamento`      — `GET /parcelamentos/:parcId`, que devolvia o mesmo objeto decorado
//                              que `GET /parcelamentos` já devolve para a lista inteira;
//   · `linkGuideToParcela`   — `POST /parcelamentos/:parcId/link-guide`;
//   · `confirmParcelaPayment`— `POST /parcelamentos/:parcId/parcelas/:num/pagar`, uma SEGUNDA porta
//                              de "dar baixa numa parcela", pelo template em vez do comprovante.
// A baixa de parcela hoje é uma só: `ParcelamentoV2Service.gerarPagamentoParcelaFromGuide`.

import { prisma } from "../../infrastructure/db/prisma.js";
import { applyTemplate, formatCompetenciaLabel, lookupAccountsFromHistorico } from "./AccountingEntryGeneratorService.js";
import { normalizeCompetencia } from "../guides/guideContract.js";
import { quadroDasParcelas, SELECT_PARCELA_PARA_QUADRO } from "./parcelamento/recalculoParcelamento.js";
import { sincronizarParcelas, addMonths, buildDateOfMonth } from "./parcelamento/parcelaSync.js";
import { tipoLinhaDaBaixa } from "./tipoLinhaBaixa.js";

// Q16: contas D/C do parcelamento começam EM BRANCO e são memorizadas por papel de
// linha (igual às guias do Simples). A memória usa AccountingHistorico keyed por
// (empresa, eventType) onde eventType = `PARC_<KIND>_<ROLE>#<ordem>`. NÃO persistimos
// esse eventType no AccountingEntry (pra não colidir com o unique
// [portalClientId, competencia, eventType, origem]) — ele é derivado no read/write.

function parcLineEventType({ kind, role, ordem }) {
  return `PARC_${String(kind).toUpperCase()}_${role}#${ordem}`;
}

// Resolve a conta memorizada pra uma linha (D→contaDebito, C→contaCredito); "" se nunca preenchida.
async function lookupLineConta(tx, { portalClientId, kind, role, ordem, tipo }) {
  const eventType = parcLineEventType({ kind, role, ordem });
  const r = await lookupAccountsFromHistorico(tx, { portalClientId, eventType });
  const conta = String(tipo).toUpperCase() === "D" ? r.debitAccountCode : r.creditAccountCode;
  return conta || "";
}

// Deriva o papel (role) de um entry de parcelamento pra fins de memória.
//  - abertura  → "OPEN"
//  - baixa com "juros" no histórico → "PAY_JUROS"; senão → "PAY_PRINCIPAL"
function deriveParcRole({ entry, parcelamento }) {
  if (parcelamento.aberturaEntryId && entry.id === parcelamento.aberturaEntryId) return "OPEN";
  if (String(entry.tipo).toUpperCase() === "BAIXA") {
    return /juros/i.test(entry.historico || "") ? "PAY_JUROS" : "PAY_PRINCIPAL";
  }
  return null;
}

/**
 * Q16: memoriza as contas D/C preenchidas pelo contador num entry de parcelamento,
 * por papel de linha. Chamado pelo auto-save do PUT /entries quando o entry pertence a
 * um parcelamento. Próxima abertura/baixa da mesma empresa (mesmo kind) auto-preenche.
 * Best-effort — falha aqui nunca derruba o save.
 */
export async function memorizeParcelamentoLineAccounts({ userId, portalClientId, entry }) {
  if (!entry?.parcelamentoId || !Array.isArray(entry.lines) || entry.lines.length === 0) return;
  const parc = await prisma.parcelamento.findUnique({
    where: { id: entry.parcelamentoId },
    select: { id: true, kind: true, aberturaEntryId: true },
  });
  if (!parc) return;
  const role = deriveParcRole({ entry, parcelamento: parc });
  if (!role) return;

  for (const ln of entry.lines) {
    const conta = String(ln.conta || "").trim();
    if (!conta) continue;
    const isD = String(ln.tipo).toUpperCase() === "D";
    const eventType = parcLineEventType({ kind: parc.kind, role, ordem: ln.ordem });
    const existing = await prisma.accountingHistorico.findFirst({
      where: { companyPortalClientId: portalClientId, eventType },
    });
    if (existing) {
      await prisma.accountingHistorico.update({
        where: { id: existing.id },
        data: {
          contaDebito: isD ? conta : existing.contaDebito,
          contaCredito: isD ? existing.contaCredito : conta,
          usageCount: existing.usageCount + 1,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.accountingHistorico.create({
        data: {
          createdByUserId: userId || null,
          companyPortalClientId: portalClientId,
          text: entry.historico || eventType,
          eventType,
          contaDebito: isD ? conta : null,
          contaCredito: isD ? null : conta,
        },
      });
    }
  }
}

// Resolve o template OPENING quando o id não veio explícito: prefere global do kind.
async function resolveOpeningTemplate(tx, { templateOpeningFunctionId, kind, portalClientId }) {
  if (templateOpeningFunctionId) {
    return tx.accountingFunction.findUnique({
      where: { id: templateOpeningFunctionId },
      include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
    });
  }
  // Fallback: template OPENING do kind (empresa primeiro, depois global).
  return tx.accountingFunction.findFirst({
    where: {
      kind: "PARCELAMENTO_OPENING",
      OR: [{ portalClientId }, { portalClientId: null }],
    },
    include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
    orderBy: [{ portalClientId: "desc" }],
  });
}

// ⚠ `addMonths`/`buildDateOfMonth` MUDARAM DE CASA, NÃO DE COMPORTAMENTO — foram para
// `parcelamento/parcelaSync.js` (importadas no topo). Eram locais deste arquivo, e a F2.1 passou a
// precisar EXATAMENTE do mesmo calendário para materializar as linhas de `parcelas`. Duas cópias
// fariam a linha leve `tipo="PARCELA"` do V1 e a parcela contratada da mesma prestação caírem em
// meses diferentes — sem erro nenhum, só duas datas de vencimento para a mesma obrigação.

function buildContext({ competencia, company, parcelamento, numeroParcela }) {
  return {
    competencia,
    competenciaLabel: formatCompetenciaLabel(competencia),
    companyName: company?.razao || "",
    cnpj: company?.cnpj || "",
    numeroParcela: numeroParcela != null ? numeroParcela : null,
    numParcelas: parcelamento?.numParcelas != null ? parcelamento.numParcelas : null,
    numEntradas: parcelamento?.numEntradas != null ? parcelamento.numEntradas : null,
    numParcelasRestantes: parcelamento && parcelamento.numParcelas != null && parcelamento.numEntradas != null
      ? parcelamento.numParcelas - parcelamento.numEntradas
      : null,
    periodosReferenciados: parcelamento?.periodosReferenciados || "",
  };
}

/**
 * Cria parcelamento + 1 entry de abertura + N entries de provisão de parcela.
 * Se sourceGuideId vier, linka a guia à parcela `linkGuideAsParcelaNum` (default 1 = entrada).
 */
// ⚠ `templatePaymentFunctionId` NÃO É MAIS GRAVADO (decisão do dono, passo 1 de 2).
//
// O campo virou WRITE-ONLY quando a F2.3 removeu `confirmParcelaPayment`, seu único leitor: nada
// mais consultava o template de pagamento do parcelamento. Continuar gravando um ponteiro que
// ninguém segue faz o próximo leitor achar que existe um caminho de baixa por template — e há um
// só, `ParcelamentoV2Service.gerarPagamentoParcelaFromGuide`, que parte do comprovante.
//
// ⚠ A COLUNA CONTINUA NO SCHEMA. O drop é uma migration SEPARADA, depois do deploy estabilizar —
// empilhá-lo nesta janela somaria uma migration pendente ao risco. Ver o comentário no
// `schema.prisma` (`model Parcelamento`).
//
// O parâmetro segue ACEITO no body da rota (o modal V1 do front ainda o envia) e é simplesmente
// IGNORADO: recusá-lo transformaria uma limpeza interna em 400 numa tela que ainda existe.
export async function createParcelamento({
  portalClientId, label, kind,
  templateOpeningFunctionId, templateRescisionFunctionId,
  numEntradas = 0, numParcelas,
  principalPerParcela, principalTotal, jurosTotal,
  dataAbertura, competenciaInicial, diaPagamento = 1, periodosReferenciados,
  sourceGuideId, linkGuideAsParcelaNum,
  userId,
}) {
  if (!portalClientId) throw new Error("portal_client_id_required");
  if (!label) throw new Error("label_required");
  if (!kind) throw new Error("kind_required");
  if (!numParcelas || numParcelas < 1) throw new Error("num_parcelas_invalid");
  const normCompetencia = normalizeCompetencia(competenciaInicial);
  if (!normCompetencia) throw new Error("competencia_inicial_invalid");
  const principal = Number(principalPerParcela);
  if (!Number.isFinite(principal) || principal <= 0) throw new Error("principal_per_parcela_invalid");

  const computedPrincipalTotal = Number.isFinite(Number(principalTotal))
    ? Number(principalTotal)
    : null;
  const computedJurosTotal = Number.isFinite(Number(jurosTotal)) ? Number(jurosTotal) : 0;
  // totalValue: prioriza principalTotal+juros (caso abertura tenha juros RFB); fallback = N * principalPerParcela
  const totalValue = computedPrincipalTotal != null
    ? computedPrincipalTotal + computedJurosTotal
    : numParcelas * principal;

  return prisma.$transaction(async (tx) => {
    const company = await tx.portalClient.findUnique({
      where: { id: portalClientId },
      select: { id: true, razao: true, cnpj: true },
    });
    if (!company) throw new Error("company_not_found");

    // 1) Cria cabeçalho
    const parcelamento = await tx.parcelamento.create({
      data: {
        portalClientId, label, kind,
        templateOpeningFunctionId: templateOpeningFunctionId || null,
        // `templatePaymentFunctionId` sai daqui de propósito — ver o comentário sobre o campo
        // write-only acima da assinatura desta função.
        templateRescisionFunctionId: templateRescisionFunctionId || null,
        numEntradas, numParcelas,
        principalPerParcela: principal,
        principalTotal: computedPrincipalTotal,
        jurosTotal: computedJurosTotal,
        totalValue,
        dataAbertura: dataAbertura ? new Date(dataAbertura) : null,
        competenciaInicial: normCompetencia,
        diaPagamento,
        periodosReferenciados: periodosReferenciados || null,
        createdByUserId: userId || null,
      },
    });

    // 2) Gera o ÚNICO entry de provisão da dívida: a ABERTURA (D principal + D juros = C total).
    //    Obrigatória. Contas D/C começam EM BRANCO e vêm da memória por papel de linha
    //    (PARC_<KIND>_OPEN#<ordem>) — preenchidas automaticamente após a 1ª vez (Q16).
    const openingTpl = await resolveOpeningTemplate(tx, {
      templateOpeningFunctionId, kind, portalClientId,
    });
    if (!openingTpl?.entries?.length) throw new Error("opening_template_required");

    // principalTotal sempre definido: deriva do total − juros quando não informado.
    const openPrincipalTotal = computedPrincipalTotal != null
      ? computedPrincipalTotal
      : Math.max(0, totalValue - computedJurosTotal);
    const openTotalValue = openPrincipalTotal + computedJurosTotal;

    const tplEntry = openingTpl.entries[0]; // abertura é sempre 1 entry
    const openCtx = buildContext({ competencia: normCompetencia, company, parcelamento, numeroParcela: null });
    const openHistorico = applyTemplate(tplEntry.historico, openCtx);
    const openData = dataAbertura ? new Date(dataAbertura) : buildDateOfMonth(normCompetencia, diaPagamento);

    // ordem 0 = D principal, ordem 1 = D juros, ordem 2 = C total (convenção do seed).
    const dLines = tplEntry.lines.filter((l) => l.tipo === "D");
    const aberturaLines = [];
    for (const ln of tplEntry.lines) {
      let valor;
      if (ln.tipo === "C") {
        valor = openTotalValue;
      } else {
        const idxD = dLines.findIndex((l) => l.id === ln.id);
        valor = idxD === 0 ? openPrincipalTotal : computedJurosTotal;
      }
      const conta = await lookupLineConta(tx, {
        portalClientId, kind, role: "OPEN", ordem: ln.ordem, tipo: ln.tipo,
      });
      aberturaLines.push({ conta, tipo: ln.tipo, valor: Number(valor) || 0, ordem: ln.ordem });
    }

    const aberturaEntry = await tx.accountingEntry.create({
      data: {
        portalClientId,
        parcelamentoId: parcelamento.id,
        numeroParcela: null, // abertura não é parcela numerada
        data: openData,
        competencia: normCompetencia,
        historico: openHistorico,
        tipo: tplEntry.tipo, // PROVISAO
        // O tipo vem do TEMPLATE: é PROVISAO nos seeds, mas uma função de abertura customizada
        // pode trazer BAIXA, e aí o CHECK `chk_baixa_tipo_linha` cobra o papel.
        tipoLinha: tipoLinhaDaBaixa(tplEntry.tipo),
        subtipo: tplEntry.subtipo || null,
        origem: "MANUAL",
        loteImportacao: `PARC-${parcelamento.id.slice(0, 8)}-ABERTURA`,
        status: "RASCUNHO",
        statusPagamento: "NA", // a dívida é provisionada aqui; baixas vão contra ela
        sourceGuideId: sourceGuideId || null,
        lines: { createMany: { data: aberturaLines } },
      },
    });

    // Atualiza cabeçalho: FK da abertura + valores efetivos da dívida.
    await tx.parcelamento.update({
      where: { id: parcelamento.id },
      data: {
        aberturaEntryId: aberturaEntry.id,
        principalTotal: openPrincipalTotal,
        totalValue: openTotalValue,
      },
    });

    // 3) Gera N LINHAS LEVES de parcela (só rastreio — SEM lançamento contábil).
    //    tipo="PARCELA" + sem lines ⇒ zero impacto em somas/export; serve à UI
    //    (aguardando guia / em aberto / pago). A dívida já foi provisionada na abertura.
    for (let i = 1; i <= numParcelas; i++) {
      const competencia = addMonths(normCompetencia, i - 1);
      const data = buildDateOfMonth(competencia, diaPagamento);
      const isEntrada = numEntradas > 0 && i <= numEntradas;
      const historico = `${isEntrada ? "ENTRADA" : "PARCELA"} ${label} ${String(i).padStart(2, "0")}/${numParcelas} - ${competencia}`;
      const shouldLinkGuide = sourceGuideId && linkGuideAsParcelaNum === i;
      await tx.accountingEntry.create({
        data: {
          portalClientId,
          parcelamentoId: parcelamento.id,
          numeroParcela: i,
          data,
          competencia,
          historico,
          tipo: "PARCELA", // marcador de rastreio (não é provisão/baixa)
          subtipo: `PARC_${kind}`,
          origem: "MANUAL",
          loteImportacao: `PARC-${parcelamento.id.slice(0, 8)}`,
          status: "RASCUNHO",
          statusPagamento: "ABERTO",
          sourceGuideId: shouldLinkGuide ? sourceGuideId : null,
          // sem lines — rastreio puro
        },
      });
    }

    // 4) Se houver guia + número de parcela, linka a guia ao parcelamento
    if (sourceGuideId && linkGuideAsParcelaNum) {
      await tx.guide.update({
        where: { id: sourceGuideId },
        data: { parcelamentoId: parcelamento.id, numeroParcela: linkGuideAsParcelaNum },
      });
    }

    // 5) F2.1 — materializa as PARCELAS do contrato. Dentro da transação de propósito: um
    //    parcelamento que existisse sem suas parcelas apareceria como "0 de 0" na tela, que é
    //    exatamente o defeito que esta fase fecha.
    await sincronizarParcelas(tx, { portalClientId, parcelamentoId: parcelamento.id });

    return tx.parcelamento.findUnique({
      where: { id: parcelamento.id },
      include: {
        aberturaEntry: { include: { lines: true } },
        parcelas: { where: { tipo: "PARCELA" }, orderBy: { numeroParcela: "asc" }, include: { lines: true } },
        guides: true,
      },
    });
  });
}

/**
 * Rescinde parcelamento: gera entry de RESCISÃO + marca status RESCINDIDO.
 * Valores remanescentes (parcelas ainda em aberto) são computados automaticamente.
 */
export async function rescindirParcelamento({ portalClientId, parcelamentoId, dataRescisao, observacoes, rescisaoLines, userId }) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    include: {
      templateRescision: { include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } } },
      parcelas: { where: { tipo: "PARCELA" }, include: { lines: true } },
      aberturaEntry: { include: { lines: { orderBy: { ordem: "asc" } } } },
      portalClient: { select: { razao: true, cnpj: true } },
    },
  });
  if (!parc) throw new Error("parcelamento_not_found");
  if (parc.status !== "ATIVO") throw new Error("parcelamento_not_active");

  let historico;
  let lines;
  let tipoEntry = "PROVISAO";
  let subtipoEntry = null;
  let totalRemanescente = 0;
  let parcelasAbertasCount = 0;

  // Q31: rescisão com linhas vindas do modal (estorno reverso editável). 1 lançamento por linha (single-leg).
  const customLines = Array.isArray(rescisaoLines) && rescisaoLines.length > 0;

  if (customLines) {
    historico = `RESCISÃO ${parc.tipo || parc.kind || ""}${parc.numeroParcelamento ? ` Nº ${parc.numeroParcelamento}` : ""}`.trim();
    subtipoEntry = `PARC_${parc.tipo || "OUTRO"}`;
    lines = rescisaoLines
      .filter((l) => String(l.conta || "").trim() || Number(l.valor))
      .map((l, i) => ({
        conta: String(l.conta || "").trim(),
        tipo: String(l.tipo).toUpperCase() === "C" ? "C" : "D",
        valor: Number(l.valor) || 0,
        ordem: i,
        tipoLinha: l.tipoLinha || null,
        codigoTributo: l.codigoTributo || null,
      }));
    totalRemanescente = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
  } else if (parc.templateRescision) {
    // Q16 (legado, com template): remanescente = parcelas ABERTAS x principal + juros proporcional.
    const parcelasAbertas = parc.parcelas.filter((p) => p.statusPagamento === "ABERTO" && p.numeroParcela != null);
    parcelasAbertasCount = parcelasAbertas.length;
    const principalRemanescente = parcelasAbertas.length * Number(parc.principalPerParcela);
    const jurosRemanescente = parc.jurosTotal && parc.numParcelas
      ? Number(parc.jurosTotal) * (parcelasAbertas.length / parc.numParcelas)
      : 0;
    totalRemanescente = principalRemanescente + jurosRemanescente;

    const tplEntry = parc.templateRescision.entries[0];
    tipoEntry = tplEntry.tipo;
    subtipoEntry = tplEntry.subtipo || null;
    const ctx = buildContext({ competencia: parc.competenciaInicial, company: parc.portalClient, parcelamento: parc, numeroParcela: null });
    historico = applyTemplate(tplEntry.historico, ctx);
    lines = tplEntry.lines.map((ln) => {
      let valor;
      if (ln.tipo === "C") {
        valor = totalRemanescente;
      } else {
        const dLines = tplEntry.lines.filter((l) => l.tipo === "D");
        const idxD = dLines.findIndex((l) => l.id === ln.id);
        valor = idxD === 0 ? principalRemanescente : jurosRemanescente;
      }
      return { conta: ln.conta || "", tipo: ln.tipo, valor: Number(valor) || 0, ordem: ln.ordem };
    });
  } else {
    // Q24 — parcelamento v2 (sem template): ESTORNA a provisão invertendo D↔C de TODAS as suas
    // pernas (a provisão agora são N lançamentos individuais). Sem provisão → só marca RESCINDIDO.
    const provisaoEntries = await prisma.accountingEntry.findMany({
      where: { parcelamentoId: parc.id, tipo: "PROVISAO" },
      include: { lines: true },
    });
    const provLines = provisaoEntries.flatMap((e) => e.lines || []);
    if (provLines.length) {
      historico = `ESTORNO/RESCISÃO ${parc.tipo || parc.kind || ""}${parc.numeroParcelamento ? ` Nº ${parc.numeroParcelamento}` : ""}`.trim();
      subtipoEntry = `PARC_${parc.tipo || "OUTRO"}`;
      lines = provLines.map((ln, i) => ({
        conta: ln.conta || "",
        tipo: ln.tipo === "D" ? "C" : "D", // inverte pra estornar
        valor: Number(ln.valor) || 0,
        ordem: i,
        tipoLinha: ln.tipoLinha || null,
        codigoTributo: ln.codigoTributo || null,
      }));
      totalRemanescente = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
    } else {
      lines = [];
    }
  }

  const isV2 = customLines || !parc.templateRescision;
  const LABEL = { PARC: "parcelamento a pagar", PRINCIPAL: "principal", PARC_DAS: "principal", MULTA: "multa", JUROS: "juros", TOTAL: "total" };
  const dataEntry = dataRescisao ? new Date(dataRescisao) : new Date();
  const loteRescisao = `PARC-${parc.id.slice(0, 8)}-RESCISAO`;

  return prisma.$transaction(async (tx) => {
    let rescisaoEntry = null;
    if (lines && lines.length && isV2) {
      // Q24: estorno v2 = um lançamento individual por linha (1 perna). Balanço fecha no conjunto.
      const created = [];
      for (const ln of lines) {
        const label = LABEL[ln.tipoLinha] || (ln.tipo === "C" ? "crédito" : "débito");
        // eslint-disable-next-line no-await-in-loop
        const e = await tx.accountingEntry.create({
          data: {
            portalClientId, parcelamentoId: parc.id, numeroParcela: null,
            data: dataEntry, competencia: parc.competenciaInicial,
            historico: `${historico} — ${label}`,
            tipo: tipoEntry, subtipo: subtipoEntry, origem: "MANUAL",
            // `tipoEntry` vem do template de rescisão quando existe — pode ser BAIXA.
            tipoLinha: ln.tipoLinha || tipoLinhaDaBaixa(tipoEntry),
            codigoTributo: ln.codigoTributo || null,
            loteImportacao: loteRescisao,
            status: "RASCUNHO", statusPagamento: "NA",
            lines: { createMany: { data: [{ conta: ln.conta || "", tipo: ln.tipo, valor: Number(ln.valor) || 0, ordem: 0, tipoLinha: ln.tipoLinha || null, codigoTributo: ln.codigoTributo || null }] } },
          },
        });
        created.push(e);
      }
      rescisaoEntry = created[0] || null;
    } else if (lines && lines.length) {
      // Q16 (legado, com template): um único lançamento multi-linha.
      rescisaoEntry = await tx.accountingEntry.create({
        data: {
          portalClientId, parcelamentoId: parc.id, numeroParcela: null,
          data: dataEntry, competencia: parc.competenciaInicial,
          historico, tipo: tipoEntry, subtipo: subtipoEntry, origem: "MANUAL",
          tipoLinha: tipoLinhaDaBaixa(tipoEntry),
          loteImportacao: loteRescisao,
          status: "RASCUNHO", statusPagamento: "NA",
          lines: { createMany: { data: lines } },
        },
      });
    }

    await tx.parcelamento.update({
      where: { id: parc.id },
      data: {
        status: "RESCINDIDO",
        observacoes: observacoes || parc.observacoes,
      },
    });

    return { ok: true, rescisaoEntry, totalRemanescente, parcelasAbertas: parcelasAbertasCount };
  });
}

/**
 * A guia da parcela, como a TELA precisa dela.
 *
 * ⚠ O `numeroDocumento` é a entrada de TUDO no PAGTOWEB — sem ele a busca do comprovante não tem o
 * que consultar, e o SERPRO nem chega a ser chamado (a rota `buscar-pagamento` já recusa antes).
 * Ele mora dentro de `extracted`, e até aqui não saía do backend por nenhum caminho: nem o
 * `toGuideResponse` (que expõe só `extracted.composicao`) nem esta listagem. A consequência é que a
 * tela não tinha como desabilitar o botão de busca com o motivo — a única forma de descobrir que a
 * guia não tem número era clicar e ler a recusa.
 *
 * ⚠ O `extracted` INTEIRO não sai daqui, pelo mesmo motivo que `toGuideResponse` não o expõe: ele
 * carrega o `rawPayload` da integração. O que sai é o número e a leitura do comprovante — os dois
 * dados que a linha da parcela mostra.
 */
function guiaDaParcelaParaTela(guia) {
  if (!guia || typeof guia !== "object") return guia;
  if (!("extracted" in guia)) return guia;
  const extracted = guia.extracted && typeof guia.extracted === "object" ? guia.extracted : {};
  const { extracted: _descartado, ...resto } = guia;
  return {
    ...resto,
    numeroDocumento: String(extracted.numeroDocumento || "").trim() || null,
    comprovante: extracted.comprovante || null,
  };
}

// Q16: enriquece o parcelamento com saldo/quanto-falta.
//
// ⚠ F2.3 — A BIFURCAÇÃO V1/V2 MORREU AQUI, e o que ela custava era a MESMA ROTA devolver semânticas
// diferentes conforme o ramo: no V1, `parcelasPagas`/`parcelasTotal` saíam do `statusPagamento` das
// linhas leves `tipo="PARCELA"` e `parcelasSemEvidencia` era zerado à força; no V2, os três saíam de
// `quadroDasParcelas`. Duas contagens com o mesmo nome no mesmo payload, decididas por um detalhe
// interno que a tela não vê.
//
// Ela pôde morrer porque produção não tem um único parcelamento V1 (medido), e porque a fonte única
// já existe: `sincronizarParcelas` materializa `parcelas` para os DOIS caminhos —
// `createParcelamento` (V1) a chama desde a F2.1, exatamente como `ingestParcelamentoFromGuide`.
// Então o denominador é o contrato e o numerador é a evidência, sempre, para todo mundo.
//
// ⚠ CONSEQUÊNCIA ACEITA E MEDIDA: um V1 criado de hoje em diante conta prestação paga por
// EVIDÊNCIA (guia quitada ou `origemBaixa`), não mais pelo `statusPagamento` da linha leve. Isso não
// perde nada, porque a única escrita daquele `statusPagamento` era `confirmParcelaPayment` — a rota
// órfã removida nesta mesma fase. Não havia como marcá-lo, e agora não há mais quem o leia.
function decorateParcelamento(parc) {
  if (!parc) return parc;
  // F2.1: as prestações do contrato, como linhas próprias. Existem para V1 e V2.
  const parcelas = Array.isArray(parc.parcelasContratadas) ? parc.parcelasContratadas : [];

  // ⚠ RISCO DE RESCISÃO — a informação que muda o dia do contador. Rescindido, o saldo vai para a
  // Dívida Ativa e as reduções de multa da adesão são restabelecidas; e isso chega por acúmulo
  // silencioso, sem ninguém decidir nada.
  //
  // ⚠ DERIVA DE `vencimento` + PAGAMENTO, não de `parcelaEstado`. A coluna depende de um recálculo
  // periódico, e recálculo que não rodou mostraria "tudo em dia" justamente na empresa que está a
  // uma prestação da rescisão. Aqui não há como o dado envelhecer.
  //
  // ⚠ A REGRA NÃO MUDOU — A FONTE MUDOU. `quadroDasParcelas` (em `recalculoParcelamento.js`) chama
  // o mesmo `avaliarRiscoRescisao` de sempre, com a mesma IN RFB 2.063/2022; o que ele passou a
  // receber são as PARCELAS contratadas em vez das guias, e só aquelas sobre as quais existe
  // evidência de pagamento. É o mesmo lugar de onde o estorno tira o número que grava na auditoria
  // — uma segunda cópia faria listagem e estorno discordarem sobre quantas prestações estão
  // quitadas, que é o número de onde sai o alerta.
  const quadro = quadroDasParcelas(parcelas, { status: parc.status });

  // ⚠ O NUMERADOR E O DENOMINADOR SAEM DA MESMA LISTA, PARA TODO PARCELAMENTO. Antes o numerador
  // contava guias e o denominador contava outra coisa — parcela sem guia era invisível numa ponta e
  // presente na outra. Hoje `parcelasTotal` são as prestações CONTRATADAS e `parcelasPagas` são
  // aquelas dentre elas com evidência de quitação (guia paga/baixada ou `origemBaixa`, o que
  // inclui `HISTORICO`: prestação quitada antes de o contrato entrar no sistema).
  const parcelasPagas = quadro.parcelasPagas;
  const parcelasTotal = quadro.parcelasTotal;
  const principalPerParcela = Number(parc.principalPerParcela) || 0;
  const principalPago = parcelasPagas * principalPerParcela;
  const totalValue = Number(parc.totalValue) || 0;
  const saldoRestante = Math.max(0, totalValue - principalPago);

  // ⚠ `quitada` inclui `baixada` de propósito: pagamento parcial NÃO quita a prestação, e quem
  // marca parcial não marca PAID. Parcelamento já rescindido não é avaliado — não há mais o que
  // prevenir. O predicado vem de fora (`parcelaRowQuitada`, que chama o `parcelaQuitada` de sempre).
  return {
    ...parc,
    guides: Array.isArray(parc.guides) ? parc.guides.map(guiaDaParcelaParaTela) : parc.guides,
    parcelasPagas,
    parcelasTotal,
    // ⚠ Prestações sobre as quais não há NENHUMA evidência de pagamento (sem guia e sem baixa
    // registrada). Elas ficam FORA do cálculo de risco de propósito: ausência de guia não é prova
    // de inadimplência, e contá-la acenderia alerta vermelho em todo débito automático. O número
    // viaja nomeado para que "0 de 52" não seja lido como "52 em atraso".
    parcelasSemEvidencia: quadro.parcelasSemEvidencia,
    principalPago,
    saldoRestante,
    risco: quadro.risco,
  };
}

/**
 * Lista parcelamentos da empresa com parcelas embedded.
 */
export async function listParcelamentos({ portalClientId, status }) {
  const rows = await prisma.parcelamento.findMany({
    where: { portalClientId, ...(status ? { status } : {}) },
    include: {
      aberturaEntry: { include: { lines: { orderBy: { ordem: "asc" } } } },
      parcelas: {
        where: { tipo: "PARCELA" },
        orderBy: { numeroParcela: "asc" },
        include: {
          lines: { orderBy: { ordem: "asc" } },
          baixas: { include: { lines: true } },
        },
      },
      // ⚠ `vencimento` é o que decide se uma parcela está EM ATRASO — sem ele o risco de rescisão
      // não tem como ser calculado e sairia como "não avaliável" em toda empresa.
      // ⚠ `extracted` entra aqui SÓ para virar `numeroDocumento`/`comprovante` em
      // `guiaDaParcelaParaTela` — ele não chega ao cliente (carrega rawPayload da integração).
      // `serproLastCheckedAt`/`Result` é o que deixa a tela dizer "já consultada há X" ANTES de
      // gastar outra chamada paga no PAGTOWEB.
      guides: {
        select: {
          id: true, numeroParcela: true, valor: true, paymentStatus: true, baixada: true,
          competencia: true, anoMesParcela: true, vencimento: true,
          extracted: true, paymentConfirmedAt: true,
          serproLastCheckedAt: true, serproLastCheckResult: true,
        },
      },
      // F2.1: a fonte dos contadores e do risco. `guides` acima segue servido à tela como estava.
      parcelasContratadas: { select: SELECT_PARCELA_PARA_QUADRO, orderBy: { numeroParcela: "asc" } },
      templateOpening: { select: { id: true, name: true } },
      // ⚠ `templatePayment` SAIU DO SELECT junto com a escrita do `templatePaymentFunctionId`: era o
      // único leitor que restava do campo, e ele lia para servir à tela um nome que nenhuma tela
      // consome (o front não referencia `templatePayment` em lugar nenhum). Mantê-lo carregado
      // faria a coluna parecer viva no dia do drop.
      templateRescision: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(decorateParcelamento);
}
