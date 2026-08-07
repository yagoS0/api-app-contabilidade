// Q21 (spec v2) — Núcleo do parcelamento: ingestão de uma guia de parcela →
// provisão (1ª vez) + pagamento (por composição, juros LIDO) → circular.
//
// Tudo consome o DTO interno (contracts.js); a origem (manual/SERPRO) é externa a este
// service. As contas saem do MapaContaTributo (em branco quando não mapeada — nunca bloqueia).

import { prisma } from "../../../infrastructure/db/prisma.js";
import { normalizeParcelamentoDTO, normalizeParcelaDTO, round2Decimal as round2 } from "./contracts.js";
import { validarParcela } from "./invariantes.js";
import { estadoEmAberto, estadoRecalculado, podeTransicionar, ESTADOS_EM_ABERTO, PARCELA_ESTADOS } from "./parcelaStateMachine.js";
import { isMonthClosed } from "../fechamentoContabil.js";

function competenciaFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── MapaContaTributo: resolução com fallback (cliente→global, tributo→geral) ──
// Usa findFirst (não findUnique): o Prisma não aceita unique composto com portalClientId null.
async function resolverConta(tx, { portalClientId, tipoParcelamento, tipoLinha, codigoTributo }) {
  const tp = String(tipoParcelamento || "OUTRO");
  const candidatos = [
    { portalClientId, codigoTributo: codigoTributo || null },
    { portalClientId: null, codigoTributo: codigoTributo || null },
    { portalClientId, codigoTributo: null },
    { portalClientId: null, codigoTributo: null },
  ];
  for (const c of candidatos) {
    const m = await tx.mapaContaTributo.findFirst({
      where: { tipoParcelamento: tp, tipoLinha, portalClientId: c.portalClientId, codigoTributo: c.codigoTributo },
    });
    if (m?.contaId) return m.contaId;
  }
  return ""; // em branco — contador preenche e o sistema aprende (memorizeMapaContaTributo)
}

/**
 * Q21: aprende as contas preenchidas num lançamento de parcelamento → MapaContaTributo.
 * Chamado pelo auto-save do PUT /entries quando o entry pertence a um parcelamento e tem tipoLinha.
 * Escopo GLOBAL por default (cliente_id null). Best-effort.
 */
export async function memorizeMapaContaTributo({ portalClientId, entry, userId }) {
  if (!entry?.parcelamentoId || !Array.isArray(entry.lines)) return;
  const parc = await prisma.parcelamento.findUnique({
    where: { id: entry.parcelamentoId },
    select: { tipo: true, kind: true },
  });
  const tipoParcelamento = parc?.tipo || parc?.kind || "OUTRO";
  await memorizeMapaContaTributoTx(prisma, { tipoParcelamento, entry, userId });
}

// Núcleo do aprendizado de contas (escopo GLOBAL). Aceita tx OU prisma — usado tanto pelo auto-save
// do PUT /entries (prisma) quanto pela ingestão da provisão (tx, Q23). Best-effort.
async function memorizeMapaContaTributoTx(client, { tipoParcelamento, entry, userId }) {
  if (!entry?.lines || !Array.isArray(entry.lines)) return;
  for (const ln of entry.lines) {
    const conta = String(ln.conta || "").trim();
    const tipoLinha = ln.tipoLinha || null;
    if (!conta || !tipoLinha) continue;
    const codigoTributo = ln.codigoTributo || null;
    // findFirst (não upsert): Prisma não aceita unique composto com portalClientId null.
    const found = await client.mapaContaTributo.findFirst({
      where: { portalClientId: null, tipoParcelamento, tipoLinha, codigoTributo },
    }).catch(() => null);
    if (found) {
      await client.mapaContaTributo.update({ where: { id: found.id }, data: { contaId: conta, updatedAt: new Date() } }).catch(() => {});
    } else {
      await client.mapaContaTributo.create({
        data: { portalClientId: null, tipoParcelamento, tipoLinha, codigoTributo, contaId: conta, createdByUserId: userId || null },
      }).catch(() => {});
    }
  }
}

// ── Construção de linhas ──
// Q28 Fase 0: PROVISÃO CORRETA da dívida (adesão) = D contrapartida / C parcelamento-a-pagar (passivo).
// Reconhece SÓ O PRINCIPAL — juros/multa correm e são reconhecidos no PAGAMENTO (não na provisão).
// NÃO credita caixa (esse era o bug: provisão e pagamento compartilhavam o mesmo papel de conta).
// As contas saem em branco quando não mapeadas (contador preenche; o sistema aprende).
async function linhasProvisao(tx, { portalClientId, tipoParcelamento, dto }) {
  // Provisão da dívida consolidada (espelha o lançamento real do contador, e é EDITÁVEL pela config):
  //   D principal (265) + D juros (501) [+ D multa (502)] / C parcelamento a pagar (553, = total).
  // O crédito (PARC) é o passivo — debitado depois no pagamento. NÃO credita caixa.
  const principal = round2(dto.valorPrincipal) || 0;
  const juros = round2(dto.valorJuros) || 0;
  const multa = round2(dto.valorMulta) || 0;
  const debitos = [{ tipoLinha: "PRINCIPAL", valor: principal }, { tipoLinha: "JUROS", valor: juros }];
  if (multa > 0) debitos.splice(1, 0, { tipoLinha: "MULTA", valor: multa });

  const lines = [];
  let ordem = 0;
  let soma = 0;
  for (const d of debitos) {
    // eslint-disable-next-line no-await-in-loop
    const conta = await resolverConta(tx, { portalClientId, tipoParcelamento, tipoLinha: d.tipoLinha, codigoTributo: null });
    lines.push({ conta, tipo: "D", valor: d.valor, ordem: ordem++, tipoLinha: d.tipoLinha, codigoTributo: null });
    soma = round2(soma + d.valor);
  }
  const contaParc = await resolverConta(tx, { portalClientId, tipoParcelamento, tipoLinha: "PARC", codigoTributo: null });
  lines.push({ conta: contaParc, tipo: "C", valor: soma, ordem: ordem++, tipoLinha: "PARC", codigoTributo: null });
  return lines;
}

// Q23/Q28: resolve as contas memorizadas das linhas-padrão da provisão (pra pré-preencher o modal).
export async function resolverContasProvisao({ portalClientId, tipoParcelamento }) {
  const out = {};
  for (const tipoLinha of ["PRINCIPAL", "JUROS", "MULTA", "PARC"]) {
    // eslint-disable-next-line no-await-in-loop
    out[tipoLinha] = await resolverConta(prisma, { portalClientId, tipoParcelamento, tipoLinha, codigoTributo: null });
  }
  return out;
}

// Q24: rótulo legível por papel de linha (compõe o histórico de cada lançamento individual).
// Q28: novos papéis (CONTRAPARTIDA/PARC/CAIXA); mantém os antigos p/ rotular lançamentos legados.
const LINHA_LABEL = {
  PRINCIPAL: "principal", JUROS: "juros", MULTA: "multa", PARC: "parcelamento a pagar", CAIXA: "caixa",
  CONTRAPARTIDA: "contrapartida", PARC_DAS: "principal", TOTAL: "total",
};

// Q24: cria UM AccountingEntry por linha (lançamento de uma perna só — um lado preenchido, o outro
// vazio). O balanço fecha no CONJUNTO (mesmo loteImportacao), não em cada lançamento. Retorna os
// entries criados (o 1º serve de referência p/ aberturaEntryId / openEntryId).
async function criarLancamentosIndividuais(tx, {
  portalClientId, parcelamentoId, linhas, data, competencia, tipo, subtipo, origem, lote,
  historicoBase, statusPagamento = "ABERTO", openEntryId = null, sourceGuideId = null,
}) {
  const created = [];
  for (const ln of linhas) {
    const label = ln.label || LINHA_LABEL[ln.tipoLinha] || (ln.tipo === "C" ? "crédito" : "débito");
    // eslint-disable-next-line no-await-in-loop
    const e = await tx.accountingEntry.create({
      data: {
        portalClientId, parcelamentoId, numeroParcela: null,
        openEntryId: openEntryId || null,
        sourceGuideId: sourceGuideId || null,
        data, competencia,
        historico: `${historicoBase} — ${label}`,
        tipo, subtipo, origem,
        loteImportacao: lote,
        status: "RASCUNHO", statusPagamento,
        lines: { createMany: { data: [{ conta: ln.conta || "", tipo: ln.tipo, valor: round2(ln.valor), ordem: 0, tipoLinha: ln.tipoLinha || null, codigoTributo: ln.codigoTributo || null }] } },
      },
      include: { lines: true },
    });
    created.push(e);
  }
  return created;
}

// Q23: normaliza as linhas de provisão vindas do modal (provisaoLinesOverride) para o formato de
// AccountingEntryLine. Cada linha: { tipoLinha?, tipo (D|C), conta?, valor }. Ignora linhas sem valor.
function linhasProvisaoFromOverride(provisaoLines) {
  const out = [];
  let ordem = 0;
  for (const ln of Array.isArray(provisaoLines) ? provisaoLines : []) {
    const tipo = String(ln.tipo || "").toUpperCase() === "C" ? "C" : "D";
    const valor = round2(ln.valor);
    if (!Number.isFinite(valor)) continue;
    out.push({
      conta: String(ln.conta || "").trim(),
      tipo,
      valor,
      ordem: ordem++,
      // Q28: crédito da provisão = PARC (passivo); débito padrão = PRINCIPAL.
      tipoLinha: ln.tipoLinha ? String(ln.tipoLinha) : (tipo === "C" ? "PARC" : "PRINCIPAL"),
      codigoTributo: null,
    });
  }
  return out;
}

// Q28 Fase 1: normaliza linhas (provisão/pagamento) p/ guardar como CONFIG do parcelamento —
// só papel + lado + conta (sem valor; o valor é por parcela/instância). Reusada no pagamento futuro.
function configFromLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const out = lines
    .filter((l) => l && (l.tipoLinha || String(l.conta || "").trim()))
    .map((l) => ({
      tipoLinha: l.tipoLinha ? String(l.tipoLinha) : (String(l.tipo).toUpperCase() === "C" ? "PARC" : "PRINCIPAL"),
      tipo: String(l.tipo).toUpperCase() === "C" ? "C" : "D",
      conta: String(l.conta || "").trim(),
    }));
  return out.length ? out : null;
}

async function linhasPagamento(tx, { portalClientId, tipoParcelamento, parcela, contaPorPapel = {} }) {
  // Q28 Fase 0/1: PAGAMENTO = D parcelamento-a-pagar (principal, amortiza o passivo) + D juros + D multa
  // (LIDOS da composição, por tributo) / C caixa (total pago). Direção correta — debita o passivo
  // (mesmo papel PARC creditado na provisão) e credita o caixa só no pagamento.
  // A conta de cada papel vem da CONFIG do parcelamento (contaPorPapel) quando definida; senão, do
  // MapaContaTributo (memória); senão, em branco (contador preenche).
  const lines = [];
  let ordem = 0;
  const resolver = async (tipoLinha, codigoTributo) =>
    contaPorPapel[tipoLinha] || await resolverConta(tx, { portalClientId, tipoParcelamento, tipoLinha, codigoTributo });
  for (const t of parcela.tributos) {
    for (const comp of [["PARC", t.principal], ["JUROS", t.juros], ["MULTA", t.multa]]) {
      const [tipoLinha, valor] = comp;
      if (!valor || round2(valor) <= 0) continue;
      const conta = await resolver(tipoLinha, t.codigoTributo);
      lines.push({ conta, tipo: "D", valor: round2(valor), ordem: ordem++, tipoLinha, codigoTributo: t.codigoTributo });
    }
  }
  const contaCaixa = await resolver("CAIXA", null);
  lines.push({ conta: contaCaixa, tipo: "C", valor: round2(parcela.valorTotal), ordem: ordem++, tipoLinha: "CAIXA", codigoTributo: null });
  return lines;
}

/**
 * Linhas do pagamento a partir da COMPOSIÇÃO DO COMPROVANTE, que separa as duas naturezas.
 *
 * ⚠ POR QUE ESTE CAMINHO EXISTE. Dentro de UMA parcela convivem duas coisas diferentes:
 *
 *   2089 IRPJ - Lucro presumido       163,40  32,66  14,52   ← dívida CONSOLIDADA sendo amortizada
 *   0380 TJLP - IRPJ - Parcelamentos       -      -  11,78   ← encargo CORRENTE do mês
 *
 * O principal, a multa E os juros dos códigos-tributo são todos parte do valor consolidado — que
 * já foi provisionado na adesão e é o que o passivo (PARC) guarda. Só o TJLP é despesa nova.
 * `linhasPagamento` debita o passivo apenas pelo principal e joga multa e juros em despesa, o que
 * nesta composição reconhece de novo um custo já reconhecido E deixa o passivo sem baixar a parte
 * de multa/juros — para sempre. Conferido no comprovante real: 57,52 de juros são 29,54 de
 * amortização + 27,98 de encargo.
 *
 * ⚠ SÓ VALE COM O COMPROVANTE NA MÃO. Quem distingue as duas naturezas é o CÓDIGO DE RECEITA, e
 * ele só existe no comprovante — `TributoParcela.codigoTributo` guarda o NOME do tributo ("DAS"),
 * porque `serproParcelamentoMap` alimenta código e nome do mesmo campo do SERPRO. Sem comprovante
 * não há como separar, e supor qual parte é amortização seria inventar lançamento contábil.
 *
 * A conta continua parametrizável: cada linha carrega o `codigoTributo`, então o `MapaContaTributo`
 * (que já indexa por `tipoLinha` + `codigoTributo`) permite mandar o TJLP 0380 para uma conta
 * diferente da dos juros comuns, sem papel novo.
 */
async function linhasPagamentoDoComprovante(tx, { portalClientId, tipoParcelamento, classificacao, contaPorPapel = {} }) {
  const lines = [];
  let ordem = 0;
  const resolver = async (tipoLinha, codigoTributo) =>
    contaPorPapel[tipoLinha] || await resolverConta(tx, { portalClientId, tipoParcelamento, tipoLinha, codigoTributo });

  // AMORTIZAÇÃO — principal + multa + juros do código-tributo debitam o PASSIVO, não a despesa.
  for (const item of classificacao.itensTributo) {
    const valor = round2(item.principal + item.multa + item.juros);
    if (valor <= 0) continue;
    const conta = await resolver("PARC", item.codigo);
    lines.push({ conta, tipo: "D", valor, ordem: ordem++, tipoLinha: "PARC", codigoTributo: item.codigo });
  }

  // ENCARGO CORRENTE — o TJLP do mês é despesa da competência do pagamento.
  for (const item of classificacao.itensTjlp) {
    const valor = round2(item.total);
    if (valor <= 0) continue;
    const conta = await resolver("JUROS", item.codigo);
    lines.push({ conta, tipo: "D", valor, ordem: ordem++, tipoLinha: "JUROS", codigoTributo: item.codigo });
  }

  // ⚠ O crédito sai da soma das duas naturezas, não de um total recebido de fora: é essa
  // identidade que faz o lote fechar, e ela é conferida logo abaixo.
  const totalDebitos = round2(lines.reduce((s, l) => s + l.valor, 0));
  const contaCaixa = await resolver("CAIXA", null);
  lines.push({ conta: contaCaixa, tipo: "C", valor: totalDebitos, ordem: ordem++, tipoLinha: "CAIXA", codigoTributo: null });
  return lines;
}

/**
 * Ingestão de uma guia de parcela (manual ou SERPRO já normalizado em DTO).
 * Cria/anexa o Parcelamento, persiste TributoParcela, dispara PROVISÃO (1ª vez) + PAGAMENTO.
 * Tudo em uma transação.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.guideId
 * @param {Object} opts.parcelamentoDTO  (cabeçalho consolidado)
 * @param {Object} opts.parcelaDTO       (esta parcela + tributos)
 * @param {Array}  [opts.provisaoLines]  (Q23: linhas da provisão editadas no modal; override do auto)
 * @param {Array}  [opts.pagamentoLines] (Q28: config de COMO o pagamento será lançado — papel/conta)
 * @param {string} [opts.guideId]        (Q28: opcional — caminho SERPRO cria o parcelamento SEM guia;
 *                                         o worker traz as guias depois)
 * @param {string} [opts.userId]
 * @returns {Promise<{ ok, parcelamentoId, provisaoId?, criouParcelamento }>}
 *
 * Q23: a ingestão cria SÓ a provisão (na 1ª vez) + vínculo + TributoParcela. O PAGAMENTO deixou de
 * ser criado aqui — é gerado depois, ao marcar a guia como paga (gerarPagamentoParcelaFromGuide).
 * Q28: guarda a CONFIG de provisão e de pagamento por parcelamento (papel/lado/conta), pra reusar.
 */
export async function ingestParcelamentoFromGuide({ portalClientId, guideId, parcelamentoDTO, parcelaDTO, provisaoLines, pagamentoLines, descricao, userId }) {
  const dto = normalizeParcelamentoDTO(parcelamentoDTO);
  const parc = normalizeParcelaDTO(parcelaDTO);

  // Q23: a ingestão cria a PROVISÃO (objetivo principal) e guarda a composição da parcela pra a
  // baixa futura. A composição NÃO bloqueia mais a provisão — se vier inconsistente, persiste como
  // veio (best-effort) e o contador ajusta na baixa. Validação dura ficou só onde há pagamento.
  const val = validarParcela(parc);
  const composicaoOk = val.ok;

  // Q28: config de provisão/pagamento (papel/lado/conta) pra guardar no parcelamento.
  const cfgProvisao = configFromLines(provisaoLines);
  const cfgPagamento = configFromLines(pagamentoLines);

  return prisma.$transaction(async (tx) => {
    const company = await tx.portalClient.findUnique({ where: { id: portalClientId }, select: { razao: true, cnpj: true } });
    const compLabel = parc.anoMesParcela ? `${parc.anoMesParcela.slice(0, 4)}-${parc.anoMesParcela.slice(4, 6)}` : null;

    // 1) Busca parcelamento por (cliente, tipo, numero)
    let parcelamento = await tx.parcelamento.findFirst({
      where: { portalClientId, tipo: dto.tipo, numeroParcelamento: dto.numeroParcelamento },
    });
    let criouParcelamento = false;

    if (!parcelamento) {
      parcelamento = await tx.parcelamento.create({
        data: {
          portalClientId,
          label: `PARCELAMENTO ${dto.tipo}${dto.numeroParcelamento ? ` Nº ${dto.numeroParcelamento}` : ""}`,
          kind: (dto.tipo === "INSS" || dto.tipo.startsWith("PARCMEI")) ? "INSS" : "SIMPLES", // compat com campo legado
          tipo: dto.tipo,
          numeroParcelamento: dto.numeroParcelamento,
          origem: dto.origem,
          // Q28 Fase 4: sn_mei integra SERPRO; outros (PGFN/estadual/municipal) é 100% manual.
          grupo: /^PARC(SN|MEI)/i.test(String(dto.tipo || "")) ? "sn_mei" : "outros",
          numParcelas: dto.quantidadeParcelas || parc.quantidadeParcelas || 1,
          parcelaInicial: parc.numeroParcela || 1,
          principalPerParcela: round2(parc.valorTotal), // referência (campo legado obrigatório)
          principalTotal: dto.valorPrincipal,
          jurosTotal: dto.valorJuros,
          valorMulta: dto.valorMulta,
          totalValue: round2(dto.valorTotal || parc.valorTotal),
          valorParcelaReferencia: round2(parc.valorTotal),
          competenciaInicial: compLabel || "1970-01",
          dataAdesao: dto.dataAdesao ? new Date(dto.dataAdesao) : null,
          status: "ATIVO",
          configProvisao: cfgProvisao || undefined,
          configPagamento: cfgPagamento || undefined,
          // Q31: descrição (competências parceladas), preenchida ao provisionar.
          observacoes: descricao ? String(descricao) : undefined,
          createdByUserId: userId || null,
        },
      });
      criouParcelamento = true;
    } else if (cfgProvisao || cfgPagamento || descricao) {
      // Q28/Q31: parcelamento já existe — completa/atualiza config e/ou descrição quando o modal mandou.
      await tx.parcelamento.update({
        where: { id: parcelamento.id },
        data: {
          ...(cfgProvisao ? { configProvisao: cfgProvisao } : {}),
          ...(cfgPagamento ? { configPagamento: cfgPagamento } : {}),
          ...(descricao ? { observacoes: String(descricao) } : {}),
        },
      });
    }

    // 2/3) Q28: só quando há GUIA (caminho manual). No caminho SERPRO (sem guia), o worker traz as
    // guias depois — aqui criamos só o parcelamento + provisão + config.
    if (guideId) {
      // ⚠ O ESTADO INICIAL SÓ VALE SE FOR MESMO INICIAL. A ingestão é idempotente e roda de novo
      // na recaptura; escrevendo `estadoEmAberto` sem olhar o estado atual, uma parcela já
      // PAGA_A_CONFERIR (ou CONFIRMADA) voltava para PREVISTA — o pagamento desaparecia da fila de
      // conferência sem deixar rastro. `podeTransicionar` recusa exatamente isso, e é a primeira
      // vez que essa tabela de transições é consultada por alguém.
      const atual = await tx.guide.findUnique({ where: { id: guideId }, select: { parcelaEstado: true } });
      const inicial = estadoEmAberto(parc.vencimento);
      await tx.guide.update({
        where: { id: guideId },
        data: {
          parcelamentoId: parcelamento.id,
          numeroParcela: parc.numeroParcela,
          quantidadeParcelas: parc.quantidadeParcelas || parcelamento.numParcelas,
          anoMesParcela: parc.anoMesParcela,
          ...(podeTransicionar(atual?.parcelaEstado, inicial) ? { parcelaEstado: inicial } : {}),
        },
      });
      // Persiste TributoParcela (idempotente por (guideId, codigoTributo))
      for (const t of parc.tributos) {
        // eslint-disable-next-line no-await-in-loop
        await tx.tributoParcela.upsert({
          where: { guideId_codigoTributo: { guideId, codigoTributo: t.codigoTributo } },
          update: { nomeTributo: t.nomeTributo, principal: t.principal, multa: t.multa, juros: t.juros, total: t.total },
          create: {
            guideId, codigoTributo: t.codigoTributo, nomeTributo: t.nomeTributo,
            principal: t.principal, multa: t.multa, juros: t.juros, total: t.total,
            verificadoTrial: dto.origem === "MANUAL", // manual = PDF conferido
          },
        });
      }
    }

    const tipoParcelamento = dto.tipo;
    let provisaoId = null;

    // 4) PROVISÃO — criada sempre que ainda não existe (aberturaEntryId nulo). Q24: também cura
    //    parcelamentos órfãos (criados sem provisão por versões anteriores) na próxima ingestão.
    //    Q23: usa as linhas editadas no modal (provisaoLines) quando vierem; senão as 3 padrão.
    if (!parcelamento.aberturaEntryId) {
      const override = linhasProvisaoFromOverride(provisaoLines);
      const linhas = override.length
        ? override
        : await linhasProvisao(tx, { portalClientId, tipoParcelamento, dto });
      // Q24: cada linha vira um lançamento individual (1 perna). Balanço fecha no conjunto (lote).
      const entries = await criarLancamentosIndividuais(tx, {
        portalClientId, parcelamentoId: parcelamento.id, linhas,
        data: dto.dataAdesao ? new Date(dto.dataAdesao) : new Date(),
        competencia: compLabel || parcelamento.competenciaInicial,
        tipo: "PROVISAO", subtipo: `PARC_${tipoParcelamento}`,
        origem: dto.origem === "SERPRO" ? "SERPRO" : "MANUAL",
        lote: `PARCV2-${parcelamento.id.slice(0, 8)}-PROV`,
        historicoBase: `PROVISÃO ${tipoParcelamento}${dto.numeroParcelamento ? ` Nº ${dto.numeroParcelamento}` : ""}`,
        statusPagamento: "ABERTO",
      });
      provisaoId = entries[0]?.id || null;
      if (provisaoId) await tx.parcelamento.update({ where: { id: parcelamento.id }, data: { aberturaEntryId: provisaoId } });
      // Memoriza as contas preenchidas no modal pra vir automáticas no próximo parcelamento.
      if (override.length) {
        for (const e of entries) {
          // eslint-disable-next-line no-await-in-loop
          await memorizeMapaContaTributoTx(tx, { tipoParcelamento, entry: e, userId });
        }
      }
    }

    // Q23: NÃO cria pagamento aqui. A BAIXA é gerada depois, ao marcar a guia como paga
    // (gerarPagamentoParcelaFromGuide). A guia entra na circular como provisão ABERTO.

    return {
      ok: true,
      parcelamentoId: parcelamento.id,
      provisaoId,
      criouParcelamento,
      composicaoOk,
      empresa: company?.razao || null,
    };
  });
}

/**
 * Q23 — Gatilho do "pago": gera o lançamento de PAGAMENTO (BAIXA) de uma guia de parcela já
 * registrada (parcelamentoId + TributoParcela). Juros LIDO da composição. Data padrão = hoje (dia
 * do clique), editável depois em Lançamentos. Idempotente. NÃO marca paymentStatus (isso é do
 * markGuidePaidManual no endpoint) — só cria a BAIXA e baixa a guia (baixada/dataBaixa/lancamentoId).
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.guideId
 * @param {string|Date} [opts.dataPagamento]  default = agora
 * @param {string} [opts.userId]
 * @returns {Promise<{ ok?, pagamentoId?, skipped?, reason? }>}
 * @throws {Error} code "MES_FECHADO" quando a competência do pagamento está fechada.
 */
export async function gerarPagamentoParcelaFromGuide({ portalClientId, guideId, dataPagamento, userId, classificacaoComprovante = null }) {
  const guide = await prisma.guide.findFirst({
    where: { id: String(guideId), portalClientId },
    select: { id: true, parcelamentoId: true, numeroParcela: true, lancamentoId: true, competencia: true, vencimento: true },
  });
  if (!guide) return { skipped: true, reason: "guide_not_found" };
  if (!guide.parcelamentoId) return { skipped: true, reason: "nao_e_parcela" }; // guia normal — nada a fazer
  if (guide.lancamentoId) return { skipped: true, reason: "ja_baixada" };

  // Idempotência reforçada: já existe BAIXA dessa guia?
  const baixaExistente = await prisma.accountingEntry.findFirst({
    where: { sourceGuideId: guide.id, tipo: "BAIXA" }, select: { id: true },
  });
  if (baixaExistente) return { skipped: true, reason: "ja_baixada" };

  const parcelamento = await prisma.parcelamento.findUnique({
    where: { id: guide.parcelamentoId },
    select: { id: true, tipo: true, kind: true, numParcelas: true, aberturaEntryId: true, configPagamento: true },
  });
  if (!parcelamento) return { skipped: true, reason: "parcelamento_not_found" };
  if (!parcelamento.aberturaEntryId) return { skipped: true, reason: "provisao_inexistente" };

  // ⚠ CONFLITO: a guia está vinculada a um parcelamento, mas o documento arrecadado NÃO é uma
  // parcela. Não se lança nada — registra e avisa. Um DARF pago em atraso tem multa e juros
  // exatamente como uma parcela tem, e baixar por engano amortizaria dívida que não foi paga.
  const usaComprovante = Boolean(classificacaoComprovante?.classificavel);
  if (usaComprovante && classificacaoComprovante.tipo !== "PARCELA_PARCELAMENTO") {
    return { skipped: true, reason: "comprovante_nao_e_parcela", tipoDocumento: classificacaoComprovante.tipo };
  }

  // A composição do comprovante dispensa a do banco — e precisa dispensar: parcelamento de DARF
  // não é capturado hoje (só PARCSN/PARCSN_ESPECIAL/RELP_SN), então essas parcelas não têm
  // `TributoParcela` nenhum e morreriam aqui em `sem_composicao`.
  const tributosParcela = usaComprovante
    ? []
    : await prisma.tributoParcela.findMany({ where: { guideId: guide.id } });
  if (!usaComprovante && !tributosParcela.length) return { skipped: true, reason: "sem_composicao" };

  const data = dataPagamento ? new Date(dataPagamento) : new Date();
  const competencia = competenciaFromDate(data);
  if (await isMonthClosed(portalClientId, competencia)) {
    const err = new Error(`Mês ${competencia} fechado — reabra antes de baixar a parcela.`);
    err.code = "MES_FECHADO";
    throw err;
  }

  const tipoParcelamento = parcelamento.tipo || parcelamento.kind || "OUTRO";
  const parcela = {
    tributos: tributosParcela.map((t) => ({
      codigoTributo: t.codigoTributo, nomeTributo: t.nomeTributo,
      principal: Number(t.principal), multa: Number(t.multa), juros: Number(t.juros), total: Number(t.total),
    })),
    valorTotal: round2(tributosParcela.reduce((s, t) => s + Number(t.total || 0), 0)),
  };

  // Q28: contas por papel vindas da config do parcelamento (definida no modal de entrada).
  const contaPorPapel = {};
  for (const l of Array.isArray(parcelamento.configPagamento) ? parcelamento.configPagamento : []) {
    if (l?.tipoLinha && String(l.conta || "").trim()) contaPorPapel[l.tipoLinha] = String(l.conta).trim();
  }

  return prisma.$transaction(async (tx) => {
    // Com comprovante, o CÓDIGO DE RECEITA separa amortização de encargo corrente; sem ele, o
    // caminho antigo, que não tem como fazer essa distinção.
    const pagLines = usaComprovante
      ? await linhasPagamentoDoComprovante(tx, { portalClientId, tipoParcelamento, classificacao: classificacaoComprovante, contaPorPapel })
      : await linhasPagamento(tx, { portalClientId, tipoParcelamento, parcela, contaPorPapel });
    // Q24: cada componente vira um lançamento individual (1 perna). Balanço fecha no conjunto.
    const entries = await criarLancamentosIndividuais(tx, {
      portalClientId, parcelamentoId: parcelamento.id, linhas: pagLines,
      data, competencia,
      tipo: "BAIXA", subtipo: `PARC_${tipoParcelamento}`,
      origem: "MANUAL",
      lote: `PARCV2-${parcelamento.id.slice(0, 8)}-PAG-${guide.numeroParcela || "x"}`,
      historicoBase: `PAGAMENTO ${tipoParcelamento} PARC ${guide.numeroParcela || "?"}/${parcelamento.numParcelas || "?"} - ${competencia}`,
      statusPagamento: "PAGO",
      openEntryId: parcelamento.aberturaEntryId,
      sourceGuideId: guide.id,
    });
    const pagamentoId = entries[0]?.id || null;
    await tx.guide.update({
      where: { id: guide.id },
      // Q28 Fase 3: pagamento lançado (RASCUNHO) → entra na fila de conferência (PAGA_A_CONFERIR).
      data: { baixada: true, dataBaixa: data, lancamentoId: pagamentoId, parcelaEstado: PARCELA_ESTADOS.PAGA_A_CONFERIR },
    });
    return { ok: true, pagamentoId };
  });
}

/**
 * Reavalia o estado das parcelas EM ABERTO contra o calendário: a vencer × vencida.
 *
 * ⚠ POR QUE ISTO PRECISA EXISTIR. `estadoEmAberto` só era chamado UMA VEZ, na ingestão. Uma
 * parcela ingerida antes do vencimento ficava `PREVISTA` **para sempre** — inclusive meses depois
 * de vencida e não paga. O atraso não aparecia em tela nenhuma, e é justamente ele que o alerta de
 * risco de rescisão precisa contar. Sem este recálculo, o contador de prestações não quitadas
 * ficaria eternamente em zero, o que é pior que não ter alerta: parece que está tudo em dia.
 *
 * Roda sem argumento (carteira inteira) ou por empresa. Não gera lançamento, não toca em valor —
 * só move estado, e só o que o relógio autoriza mover.
 *
 * @returns {Promise<{avaliadas: number, atualizadas: number, porEstado: object}>}
 */
export async function recalcularEstadosParcelasEmAberto({ portalClientId = null, agora = new Date() } = {}) {
  const guias = await prisma.guide.findMany({
    where: {
      parcelamentoId: { not: null },
      parcelaEstado: { in: ESTADOS_EM_ABERTO },
      baixada: false,
      ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    },
    select: { id: true, parcelaEstado: true, vencimento: true, paymentStatus: true },
  });

  const porEstado = {};
  let atualizadas = 0;
  for (const g of guias) {
    // ⚠ Guia paga fora do fluxo da parcela (baixa manual, por exemplo) não vira "em atraso" porque
    // o vencimento passou. O filtro por `baixada` não pega esse caso — o estado do PAGAMENTO pega.
    if (String(g.paymentStatus || "").toUpperCase() === "PAID") continue;
    const novo = estadoRecalculado({ estadoAtual: g.parcelaEstado, vencimento: g.vencimento, agora });
    if (!novo) continue;
    // eslint-disable-next-line no-await-in-loop
    await prisma.guide.update({ where: { id: g.id }, data: { parcelaEstado: novo } });
    porEstado[novo] = (porEstado[novo] || 0) + 1;
    atualizadas += 1;
  }
  return { avaliadas: guias.length, atualizadas, porEstado };
}

/**
 * Q28 Fase 3 — Fila de conferência: lista as parcelas pagas a conferir + divergentes.
 */
export async function listarConferenciaParcelas({ portalClientId }) {
  const guides = await prisma.guide.findMany({
    where: { portalClientId, parcelaEstado: { in: [PARCELA_ESTADOS.PAGA_A_CONFERIR, PARCELA_ESTADOS.DIVERGENTE] } },
    select: {
      id: true, parcelamentoId: true, numeroParcela: true, anoMesParcela: true, competencia: true,
      valor: true, dataBaixa: true, parcelaEstado: true, lancamentoId: true,
      parcelamento: { select: { label: true, tipo: true, numeroParcelamento: true } },
    },
    orderBy: { dataBaixa: "desc" },
    take: 200,
  });
  return guides.map((g) => ({
    guideId: g.id,
    parcelamentoId: g.parcelamentoId,
    parcelamentoLabel: g.parcelamento?.label || null,
    tipo: g.parcelamento?.tipo || null,
    numeroParcelamento: g.parcelamento?.numeroParcelamento || null,
    numeroParcela: g.numeroParcela,
    competencia: g.competencia,
    anoMesParcela: g.anoMesParcela,
    valor: g.valor != null ? Number(g.valor) : null,
    dataBaixa: g.dataBaixa,
    estado: g.parcelaEstado,
  }));
}

/**
 * Q28 Fase 3 — Aprova parcelas em conferência (PAGA_A_CONFERIR → CONFIRMADA) e confirma os
 * lançamentos de baixa correspondentes (RASCUNHO → CONFIRMADO). Idempotente; ignora ids inválidos.
 */
export async function aprovarConferenciaParcelas({ portalClientId, guideIds }) {
  const ids = (Array.isArray(guideIds) ? guideIds : []).map(String).filter(Boolean);
  let aprovadas = 0;
  for (const guideId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const guide = await prisma.guide.findFirst({
      where: { id: guideId, portalClientId, parcelaEstado: PARCELA_ESTADOS.PAGA_A_CONFERIR },
      select: { id: true },
    });
    if (!guide) continue;
    // eslint-disable-next-line no-await-in-loop
    await prisma.$transaction(async (tx) => {
      await tx.accountingEntry.updateMany({
        where: { sourceGuideId: guideId, tipo: "BAIXA", status: "RASCUNHO" },
        data: { status: "CONFIRMADO" },
      });
      await tx.guide.update({ where: { id: guideId }, data: { parcelaEstado: PARCELA_ESTADOS.CONFIRMADA } });
    });
    aprovadas += 1;
  }
  return { ok: true, aprovadas };
}
