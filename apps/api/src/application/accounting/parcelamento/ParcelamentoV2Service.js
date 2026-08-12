// Q21 (spec v2) — Núcleo do parcelamento: ingestão de uma guia de parcela →
// provisão (1ª vez) + pagamento (por composição, juros LIDO) → circular.
//
// Tudo consome o DTO interno (contracts.js); a origem (manual/SERPRO) é externa a este
// service. As contas saem do MapaContaTributo (em branco quando não mapeada — nunca bloqueia).

import { prisma } from "../../../infrastructure/db/prisma.js";
// ⚠ A REGRA DE FAMÍLIA VEM DA FONTE ÚNICA (`contracts.js`), onde `TIPOS_PARCELAMENTO` vive.
// `grupoDoParcelamento` decide quem integra a busca automática do SERPRO; `chaveMemoriaContas`
// colapsa a chave do `MapaContaTributo` para a família. Nenhuma das duas toca a modalidade CRUA.
import {
  normalizeParcelamentoDTO, normalizeParcelaDTO, round2Decimal as round2,
  grupoDoParcelamento, chaveMemoriaContas,
} from "./contracts.js";
import { validarParcela } from "./invariantes.js";
import { estadoEmAberto, estadoRecalculado, podeTransicionar, ESTADOS_EM_ABERTO, PARCELA_ESTADOS } from "./parcelaStateMachine.js";
import { isMonthClosed } from "../fechamentoContabil.js";
// ⚠ O VOCABULÁRIO DE `parcelas.origemBaixa` VEM DA FONTE ÚNICA (`ancoraBaixa.js`), não de literais.
// É o mesmo registro que o estorno despacha e que o teste de contrato itera: uma via de baixa nova
// que grave um valor fora dele não teria estorno, e ninguém veria.
import { ORIGEM_BAIXA } from "../ancoraBaixa.js";
import { tipoLinhaDaBaixa } from "../tipoLinhaBaixa.js";
import { sincronizarParcelas } from "./parcelaSync.js";
import { SELECT_PARCELA_PARA_QUADRO, recalcularParcelamento } from "./recalculoParcelamento.js";

function competenciaFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── MapaContaTributo: resolução com fallback (cliente→global, tributo→geral) ──
// Usa findFirst (não findUnique): o Prisma não aceita unique composto com portalClientId null.
async function resolverConta(tx, { portalClientId, tipoParcelamento, tipoLinha, codigoTributo }) {
  // ⚠ AQUI — E SÓ AQUI — A MODALIDADE COLAPSA PARA A FAMÍLIA. O colapso é do PONTO DE LEITURA da
  // memória, nunca da variável `tipoParcelamento` do chamador: ela segue crua para
  // `subtipo: PARC_<TIPO>` e `historicoBase: PROVISÃO <TIPO>`, e mexer nela mudaria a forma e o
  // histórico do lançamento contábil. Todo leitor do `MapaContaTributo` passa por esta função
  // (provisão, baixa e o pré-preenchimento do modal via `resolverContasProvisao`), então uma
  // conta preenchida em PERT_SN passa a ser encontrada por RELP_SN — que é o ponto: sem isso,
  // seis das oito modalidades não tinham uma linha sequer e resolviam em branco toda vez.
  const tp = chaveMemoriaContas(tipoParcelamento) || "OUTRO";
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
  // ⚠ A ESCRITA COLAPSA PELA MESMA REGRA DA LEITURA. Se aprendesse na modalidade crua e
  // `resolverConta` lesse na família, o contador corrigiria a conta num RELP_SN e o sistema
  // continuaria devolvendo em branco — a memória gravada numa chave que ninguém lê é o defeito
  // que as DUAS memórias de conta do parcelamento já produziram uma vez.
  const chave = chaveMemoriaContas(tipoParcelamento) || "OUTRO";
  for (const ln of entry.lines) {
    const conta = String(ln.conta || "").trim();
    const tipoLinha = ln.tipoLinha || null;
    if (!conta || !tipoLinha) continue;
    const codigoTributo = ln.codigoTributo || null;
    // findFirst (não upsert): Prisma não aceita unique composto com portalClientId null.
    const found = await client.mapaContaTributo.findFirst({
      where: { portalClientId: null, tipoParcelamento: chave, tipoLinha, codigoTributo },
    }).catch(() => null);
    if (found) {
      await client.mapaContaTributo.update({ where: { id: found.id }, data: { contaId: conta, updatedAt: new Date() } }).catch(() => {});
    } else {
      await client.mapaContaTributo.create({
        data: { portalClientId: null, tipoParcelamento: chave, tipoLinha, codigoTributo, contaId: conta, createdByUserId: userId || null },
      }).catch(() => {});
    }
  }
}

// ── Construção de linhas ──
// Q28 Fase 0: PROVISÃO CORRETA da dívida (adesão) = D contrapartida / C parcelamento-a-pagar (passivo).
// NÃO credita caixa (esse era o bug: provisão e pagamento compartilhavam o mesmo papel de conta).
// As contas saem em branco quando não mapeadas (contador preenche; o sistema aprende).
async function linhasProvisao(tx, { portalClientId, tipoParcelamento, dto }) {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // A REGRA VIGENTE (2026-08-12) — A PROVISÃO DA ADESÃO RECONHECE O ENCARGO
  //
  //     D principal
  //     D juros
  //     D multa
  //     C parcelamento a pagar   = principal + juros + multa   ← contrapartida CONSOLIDADA, uma só
  //
  // ⚠ COMPONENTE ZERADO NÃO VIRA LINHA — a mesma regra da baixa. Contrato sem multa fecha em
  // `principal + juros`; sem juros nem multa, em `principal`.
  //
  // ⚠ JUROS E MULTA SÃO PAPÉIS DISTINTOS, ainda que apontem para a MESMA conta. Palavras do dono
  // (2026-08-12): *"nós geralmente lançamos juros e multa na mesma CONTA, mas podemos separar
  // também, opcional"*. "Mesma conta" é sobre a CONTA, nunca sobre o PAPEL: `MapaContaTributo`
  // indexa por `(tipoLinha, codigoTributo)`, então dois papéis resolvendo para a mesma conta é o
  // caso NORMAL da tabela. Colapsar os dois num papel só apagaria a multa como fato — e é
  // exatamente o colapso que produziu a provisão torta que esta mudança corrige.
  //
  // ── POR QUE ISTO MUDOU, E O QUE A REGRA ANTIGA PROTEGIA ────────────────────────────────────────
  //
  // ATÉ 2026-08-12 esta função reconhecia **SÓ O PRINCIPAL**. Aquela decisão também era do dono
  // ("juros e multa vêm apenas da confirmação do pagamento, que vem do SERPRO") e tinha um motivo
  // concreto, que **continua verdadeiro**: como `linhasPagamento`/`linhasPagamentoDoComprovante`
  // debitam o passivo (papel `PARC`) **só pelo principal** e jogam juros e multa em despesa
  // (501/506), um passivo que nasce CONSOLIDADO nunca é amortizado por inteiro — sobra resíduo
  // permanente igual a `juros + multa` do contrato, e o encargo é reconhecido DUAS VEZES no
  // resultado (uma na adesão, outra a cada parcela). Parcelamento quitado com saldo vivo em
  // "Parcelamento a Pagar", para sempre.
  //
  // A REGRA NOVA VENCE porque é pedido explícito e posterior do dono (2026-08-12):
  //   *"o juros da provisão precisa ser escrito"*
  //   *"o parcelamento deve ter valor principal, juros, e valor juros + principal fechando a
  //    contrapartida"*
  // O balanço volta a espelhar a dívida ASSINADA no acordo (que legalmente inclui multa e juros),
  // que era o custo aceito pela regra antiga.
  //
  // ⚠ E O CUSTO DA REGRA NOVA É O RESÍDUO DESCRITO ACIMA — ele NÃO foi consertado aqui.
  // A BAIXA **não foi tocada nesta mudança**: a decisão do dono descreveu a PROVISÃO, não a baixa.
  // Quem for mexer nela precisa ler as duas funções JUNTAS (é o par que já esteve desalinhado uma
  // vez, e o desalinhamento é silencioso: não gera erro, gera saldo errado). Enquanto a baixa
  // amortizar só o principal, todo contrato criado por esta função termina com resíduo
  // `juros + multa` no passivo. Medido e levado ao dono; não conserte por conta própria.
  //
  // `dto.valorJuros` e `dto.valorMulta` já eram gravados no PARCELAMENTO (dado do contrato) e
  // continuam sendo; o que mudou é que agora eles TAMBÉM viram lançamento na adesão.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const principal = round2(dto.valorPrincipal) || 0;
  const juros = round2(dto.valorJuros) || 0;
  const multa = round2(dto.valorMulta) || 0;
  const debitos = [
    { tipoLinha: "PRINCIPAL", valor: principal },
    { tipoLinha: "JUROS", valor: juros },
    { tipoLinha: "MULTA", valor: multa },
  ].filter((d) => d.valor > 0);
  // Contrato sem NENHUM valor declarado: mantém a linha de principal (zerada) em vez de devolver um
  // crédito solto. É o desenho que existia antes desta mudança, e o único caso em que "componente
  // zerado não vira linha" produziria um lote de uma perna só.
  if (!debitos.length) debitos.push({ tipoLinha: "PRINCIPAL", valor: principal });

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
  // ⚠ DEFAULT `null` = exatamente o que estava escrito aqui como literal até agora, então nenhum
  // chamador existente muda de comportamento. Só a baixa SEM GUIA o preenche, e por um motivo
  // concreto: sem `sourceGuideId` os lançamentos dela caem FORA do índice `uq_baixa_guia_linha`, e
  // o par `(parcelamentoId, numeroParcela)` é a única coisa em `accounting_entries` que identifica
  // a prestação. Ver o SQL proposto em `gerarPagamentoParcelaManual`.
  numeroParcela = null,
}) {
  const created = [];
  for (const ln of linhas) {
    const label = ln.label || LINHA_LABEL[ln.tipoLinha] || (ln.tipo === "C" ? "crédito" : "débito");
    // eslint-disable-next-line no-await-in-loop
    const e = await tx.accountingEntry.create({
      data: {
        portalClientId, parcelamentoId, numeroParcela,
        openEntryId: openEntryId || null,
        sourceGuideId: sourceGuideId || null,
        // ⚠ O PAPEL SOBE PARA O CABEÇALHO. Cada lançamento daqui é de UMA perna, então o papel da
        // linha é o papel do lançamento — e é essa dupla que o índice único parcial
        // `uq_baixa_guia_linha` usa para distinguir as N linhas legítimas desta baixa das linhas
        // de uma baixa DUPLICADA da mesma guia (que repetiria papel e código, linha a linha).
        // `codigoTributo` só quando existe de verdade (vem do `TributoParcela` ou do comprovante).
        // O `|| tipoLinhaDaBaixa(tipo)` é a rede: linha sem papel num lançamento de BAIXA violaria
        // o CHECK do banco (23514) e derrubaria a baixa inteira. Aqui hoje toda linha tem papel.
        tipoLinha: ln.tipoLinha || tipoLinhaDaBaixa(tipo),
        codigoTributo: ln.codigoTributo || null,
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

/**
 * ⚠ PAPEL AUSENTE NUMA LINHA DE PROVISÃO É **RECUSA**, NUNCA CHUTE.
 *
 * Havia dois defaults silenciosos gêmeos — `linhasProvisaoFromOverride` e `configFromLines` —
 * escrevendo `|| (tipo === "C" ? "PARC" : "PRINCIPAL")`. Eles pareciam inofensivos e não eram:
 *
 *   · o papel `PRINCIPAL` é o que vira `valorPrincipal` do contrato (o front soma por papel), e é
 *     ele que o passivo promete amortizar. Chutar `PRINCIPAL` num débito de JUROS faz
 *     `principalTotal == totalValue` — foi assim que a SINTROPIA nasceu com DUAS linhas de
 *     principal (31.003,42 na conta de principal e 7.034,32 na conta 501, de JUROS), de UMA
 *     escrita só;
 *   · `configFromLines` grava o mesmo chute em `Parcelamento.configProvisao`, que é de onde o
 *     modal de RESCISÃO monta o lançamento por `valorPorPapel[tipoLinha]` — dois `PRINCIPAL` no
 *     config pré-preenchem o MESMO valor duas vezes, e a rescisão nasce com Σ D ≠ Σ C.
 *
 * O papel é DECLARAÇÃO do contador, e agora ele tem onde ser dito (a coluna "Papel" do passo 3 do
 * `ParcelamentoWizard`). Ausência de declaração é ausência de dado — e ausência de dado não vira
 * lançamento contábil (regra 1 do projeto).
 *
 * @throws {Error} code `PAPEL_DE_LINHA_AUSENTE` — com o motivo E a saída na mensagem.
 */
const PAPEIS_PROVISAO = Object.freeze(["PRINCIPAL", "JUROS", "MULTA", "PARC", "CONTRAPARTIDA"]);

function exigirPapel(linhas, onde) {
  const semPapel = [];
  (Array.isArray(linhas) ? linhas : []).forEach((ln, i) => {
    if (!String(ln?.tipoLinha || "").trim()) semPapel.push(i + 1);
  });
  if (!semPapel.length) return;
  const err = new Error(
    `${onde}: ${semPapel.length === 1 ? `a linha ${semPapel[0]} está` : `as linhas ${semPapel.join(", ")} estão`} `
    + "sem PAPEL (`tipoLinha`). O papel decide quanto do contrato é principal, quanto é juros e quanto é "
    + "multa — e é ele que o passivo promete amortizar; supô-lo faria o parcelamento nascer com o "
    + `principal errado. Saída: informe o papel de cada linha (${PAPEIS_PROVISAO.join(" · ")}) na coluna `
    + "\"Papel\" do passo 3 do wizard e envie de novo. Nada foi gravado.",
  );
  err.code = "PAPEL_DE_LINHA_AUSENTE";
  throw err;
}

// Q23: normaliza as linhas de provisão vindas do modal (provisaoLinesOverride) para o formato de
// AccountingEntryLine. Cada linha: { tipoLinha, tipo (D|C), conta?, valor }. Ignora linhas sem valor.
function linhasProvisaoFromOverride(provisaoLines) {
  const candidatas = (Array.isArray(provisaoLines) ? provisaoLines : [])
    .filter((ln) => Number.isFinite(round2(ln?.valor)));
  // ⚠ RECUSA ANTES DE QUALQUER NORMALIZAÇÃO — ver `exigirPapel`.
  exigirPapel(candidatas, "Provisão da adesão");
  return candidatas.map((ln, ordem) => ({
    conta: String(ln.conta || "").trim(),
    tipo: String(ln.tipo || "").toUpperCase() === "C" ? "C" : "D",
    valor: round2(ln.valor),
    ordem,
    tipoLinha: String(ln.tipoLinha).trim(),
    codigoTributo: null,
  }));
}

// Q28 Fase 1: normaliza linhas (provisão/pagamento) p/ guardar como CONFIG do parcelamento —
// só papel + lado + conta (sem valor; o valor é por parcela/instância). Reusada no pagamento futuro.
//
// ⚠ `exigirPapel` só é ligado para a PROVISÃO (`{ exigirPapelDeclarado: true }`). A config de
// PAGAMENTO é lida por `linhasPagamento`/`linhasPagamentoDoComprovante` (a BAIXA), que esta mudança
// deliberadamente não toca — apertar o contrato dela aqui mudaria a baixa por tabela.
function configFromLines(lines, { exigirPapelDeclarado = false, onde = "Config" } = {}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const relevantes = lines.filter((l) => l && (l.tipoLinha || String(l.conta || "").trim()));
  if (exigirPapelDeclarado) exigirPapel(relevantes, onde);
  const out = relevantes.map((l) => ({
    tipoLinha: l.tipoLinha ? String(l.tipoLinha).trim() : (String(l.tipo).toUpperCase() === "C" ? "PARC" : "PRINCIPAL"),
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

  // ⚠ AQUI SÓ O PRINCIPAL AMORTIZA O PASSIVO — E DESDE 2026-08-12 ISSO **NÃO** CASA MAIS COM A
  // PROVISÃO. Leia esta função e `linhasProvisao` JUNTAS antes de mexer em qualquer uma.
  //
  // Enquanto a provisão reconhecia só o principal, esta regra era a consequência necessária dela:
  // o passivo nascia valendo `principalTotal`, e debitar aqui também multa e juros o levaria a
  // NEGATIVO ao longo do contrato.
  //
  // A provisão MUDOU (decisão do dono, 2026-08-12: `D principal · D juros · D multa / C soma`), e
  // **a baixa não foi alterada junto — de propósito**: o dono descreveu a provisão, não a baixa.
  // Consequência medida e levada a ele: o passivo passa a nascer CONSOLIDADO e a ser amortizado só
  // pelo principal, sobrando resíduo permanente igual a `juros + multa` do contrato. Isso é um
  // desalinhamento CONHECIDO e pendente de decisão, não um descuido — e ele é silencioso: não gera
  // erro, gera saldo errado.
  //
  // Multa e juros do código-tributo continuam sendo lançados aqui como despesa DO MÊS DO PAGAMENTO,
  // junto com o TJLP.
  for (const item of classificacao.itensTributo) {
    for (const [tipoLinha, valor] of [["PARC", item.principal], ["MULTA", item.multa], ["JUROS", item.juros]]) {
      if (!valor || round2(valor) <= 0) continue;
      const conta = await resolver(tipoLinha, item.codigo);
      lines.push({ conta, tipo: "D", valor: round2(valor), ordem: ordem++, tipoLinha, codigoTributo: item.codigo });
    }
  }

  // ENCARGO CORRENTE — o TJLP do mês, também despesa da competência do pagamento.
  //
  // ⚠ O QUE A SEPARAÇÃO POR CÓDIGO AINDA ENTREGA, mesmo com TJLP e juros consolidados caindo no
  // mesmo papel por padrão: cada linha carrega o CÓDIGO DE RECEITA real (0380, 2089…), e o
  // `MapaContaTributo` indexa por `(tipoLinha, codigoTributo)`. Então dá para mandar o TJLP para
  // uma conta própria sem inventar papel novo. Pelo caminho antigo isso é impossível — lá o
  // `codigoTributo` gravado é o NOME do tributo ("DAS"), um só para a parcela inteira.
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
 * @param {number} [opts.parcelasJaPagas] (F2.3: prestações quitadas ANTES de o contrato entrar aqui)
 * @param {string} [opts.userId]
 * @returns {Promise<{ ok, parcelamentoId, provisaoId?, criouParcelamento }>}
 *
 * Q23: a ingestão cria SÓ a provisão (na 1ª vez) + vínculo + TributoParcela. O PAGAMENTO deixou de
 * ser criado aqui — é gerado depois, ao marcar a guia como paga (gerarPagamentoParcelaFromGuide).
 * Q28: guarda a CONFIG de provisão e de pagamento por parcelamento (papel/lado/conta), pra reusar.
 */
export async function ingestParcelamentoFromGuide({ portalClientId, guideId, parcelamentoDTO, parcelaDTO, provisaoLines, pagamentoLines, descricao, parcelasJaPagas, userId }) {
  const dto = normalizeParcelamentoDTO(parcelamentoDTO);
  const parc = normalizeParcelaDTO(parcelaDTO);

  // Q23: a ingestão cria a PROVISÃO (objetivo principal) e guarda a composição da parcela pra a
  // baixa futura. A composição NÃO bloqueia mais a provisão — se vier inconsistente, persiste como
  // veio (best-effort) e o contador ajusta na baixa. Validação dura ficou só onde há pagamento.
  const val = validarParcela(parc);
  const composicaoOk = val.ok;

  // Q28: config de provisão/pagamento (papel/lado/conta) pra guardar no parcelamento.
  // ⚠ A PROVISÃO EXIGE PAPEL DECLARADO; a de pagamento (a baixa) não foi tocada — ver `configFromLines`.
  const cfgProvisao = configFromLines(provisaoLines, { exigirPapelDeclarado: true, onde: "Provisão da adesão" });
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
          // ⚠ ERA UM PREFIXO (`/^PARC(SN|MEI)/i`), e o prefixo deixava PERT_SN, RELP_SN, PERT_MEI e
          // RELP_MEI fora: as quatro caíam em "outros" e ficavam invisíveis para os dois filtros de
          // busca automática (`grupo: { not: "outros" }`), em silêncio. Metade das modalidades do
          // Simples/MEI nunca era capturada. A lista fechada de `grupoDoParcelamento` é o que
          // impede o defeito de voltar — e `PARCSN_ESPECIAL`/`PARCMEI_ESPECIAL`, que já casavam
          // com o prefixo, continuam em `sn_mei`.
          grupo: grupoDoParcelamento(dto.tipo),
          numParcelas: dto.quantidadeParcelas || parc.quantidadeParcelas || 1,
          parcelaInicial: parc.numeroParcela || 1,
          principalPerParcela: round2(parc.valorTotal), // referência (campo legado obrigatório)
          principalTotal: dto.valorPrincipal,
          jurosTotal: dto.valorJuros,
          valorMulta: dto.valorMulta,
          totalValue: round2(dto.valorTotal || parc.valorTotal),
          valorParcelaReferencia: round2(parc.valorTotal),
          competenciaInicial: compLabel || "1970-01",
          // ⚠ F2.3 — `diaPagamento` FINALMENTE VEM DO MODAL. A coluna sempre existiu (default 1) e
          // sempre alimentou o cronograma (`parcelaSync.calendarioDaParcela`), que é a data que
          // decide ATRASO quando não há guia — mas o modal nunca a coletava, e por isso os
          // contratos de produção têm todas as prestações vencendo no dia 1. Ausente ⇒ não
          // escrevemos nada e o default do banco (1) vale, como antes.
          ...(dto.diaPagamento != null ? { diaPagamento: dto.diaPagamento } : {}),
          // F2.3 — declaração, não inferência. `null` = não declarado (o comportamento segue o de
          // hoje: a evidência de pagamento é que responde por "foi paga?").
          formaPagamento: dto.formaPagamento || undefined,
          // ⚠ F2.3 — INFORMATIVO. NÃO alimenta lançamento: quem monta a provisão é `linhasProvisao`
          // (ou o override do wizard), a partir de principal/juros/multa. Serve para exibir e conferir.
          saldoConsolidado: dto.saldoConsolidado != null ? dto.saldoConsolidado : undefined,
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
    } else if (cfgProvisao || cfgPagamento || descricao || dto.formaPagamento || dto.saldoConsolidado != null) {
      // Q28/Q31: parcelamento já existe — completa/atualiza config e/ou descrição quando o modal mandou.
      await tx.parcelamento.update({
        where: { id: parcelamento.id },
        data: {
          ...(cfgProvisao ? { configProvisao: cfgProvisao } : {}),
          ...(cfgPagamento ? { configPagamento: cfgPagamento } : {}),
          ...(descricao ? { observacoes: String(descricao) } : {}),
          // F2.3 — declaração e saldo declarado se ATUALIZAM na reingestão: a forma de pagamento
          // pode ser informada depois da criação, e o saldo consolidado é, por definição, o de HOJE.
          ...(dto.formaPagamento ? { formaPagamento: dto.formaPagamento } : {}),
          ...(dto.saldoConsolidado != null ? { saldoConsolidado: dto.saldoConsolidado } : {}),
          // ⚠ `diaPagamento` NÃO ENTRA AQUI. O cronograma já foi materializado em `parcelas`, e
          // `sincronizarParcelas` só CRIA as que faltam — mudar o dia no cabeçalho sem mover as
          // linhas deixaria o contrato dizendo uma data e as prestações dizendo outra, com o atraso
          // sendo decidido pelas linhas. Remexer em data de parcela já gravada é decisão do dono.
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

    // 5) F2.1 — materializa/atualiza as PARCELAS do contrato e casa a guia recém-vinculada com a
    //    sua. ⚠ RODA MESMO QUANDO NÃO HÁ `guideId`: é justamente o caminho SERPRO (parcelamento
    //    criado antes de qualquer guia chegar) que produzia o "0 de 0" com risco não avaliável.
    //    Idempotente — a recaptura passa por aqui a cada parcela e não duplica nada.
    await sincronizarParcelas(tx, { portalClientId, parcelamentoId: parcelamento.id });

    // 6) F2.3 — AS PRESTAÇÕES QUITADAS ANTES DE O CONTRATO ENTRAR AQUI.
    const marcadasHistorico = await marcarParcelasHistoricas(tx, {
      portalClientId, parcelamentoId: parcelamento.id, quantidade: parcelasJaPagas,
    });

    return {
      ok: true,
      parcelamentoId: parcelamento.id,
      provisaoId,
      criouParcelamento,
      composicaoOk,
      marcadasHistorico,
      empresa: company?.razao || null,
    };
  });
}

/**
 * F2.3 — marca as N primeiras prestações como QUITADAS ANTES DO SISTEMA (`origemBaixa: "HISTORICO"`).
 *
 * ⚠ ESTADO NOVO NÃO FOI CRIADO, E ISSO É O PONTO. A coluna `origemBaixa` já existia e já era lida:
 * `parcelaRowQuitada` a trata como quitação e `temEvidenciaDePagamento` a trata como evidência.
 * Acrescentar `HISTORICO` ao VOCABULÁRIO faz todas as derivações — contadores, risco de rescisão,
 * `parcelasSemEvidencia`, o `semGuia` do recálculo de atraso — enxergarem a prestação sozinhas.
 * Uma coluna nova (`paga_historico`) daria uma segunda resposta para uma pergunta que já tem uma,
 * e as duas divergiriam no primeiro estorno.
 *
 * ⚠ NÃO GERA `AccountingEntry`, e não é omissão: não houve pagamento NOSSO para lançar. A parcela
 * foi quitada sob outra contabilidade; lançar uma baixa aqui debitaria um passivo que a provisão
 * desta adesão nem reconheceu (a provisão nasce com o principal do saldo que RESTA).
 *
 * ⚠ IDEMPOTENTE E NÃO DESTRUTIVA: só toca prestação SEM guia e SEM `origemBaixa`. Uma parcela que
 * já tem guia é evidência real e não pode ser sobrescrita por uma declaração de histórico —
 * a reingestão roda a cada recaptura e passaria por aqui de novo.
 */
async function marcarParcelasHistoricas(tx, { portalClientId, parcelamentoId, quantidade }) {
  const n = Math.trunc(Number(quantidade));
  if (!Number.isFinite(n) || n < 1) return 0;

  const alvo = await tx.parcela.findMany({
    where: {
      parcelamentoId, portalClientId,
      numeroParcela: { lte: n, not: null },
      guiaId: null,
      origemBaixa: null,
    },
    select: { id: true },
  });
  if (!alvo.length) return 0;

  const r = await tx.parcela.updateMany({
    where: { id: { in: alvo.map((p) => p.id) } },
    // ⚠ `baixadaEm` AQUI É A DATA DA DECLARAÇÃO, NÃO A DO PAGAMENTO. Quando o contribuinte pagou
    // uma prestação anterior à nossa entrada não se sabe, e preencher com o vencimento contratado
    // (ou com "hoje" fingindo ser o pagamento) inventaria dado. O que se sabe é quando foi
    // declarado — e é isso que fica gravado.
    data: { origemBaixa: ORIGEM_BAIXA.HISTORICO, baixadaEm: new Date() },
  });
  return r.count;
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
    // ⚠ A GUIA É RESERVADA ANTES DE QUALQUER LANÇAMENTO — e é isto que impede a baixa DUPLICADA.
    //
    // As duas verificações lá em cima (`guide.lancamentoId` e `baixaExistente`) são
    // check-then-act FORA da transação: duas requisições simultâneas (duplo clique, worker do
    // SERPRO confirmando o pagamento no mesmo instante em que o contador clica "dar baixa")
    // passavam AS DUAS pela verificação antes de qualquer uma escrever, e o resultado eram dois
    // lotes de lançamento amortizando o mesmo passivo pela mesma parcela. O banco não segurava:
    // o unique `(sourceGuideId, eventType)` não morde porque estes lançamentos nascem com
    // `eventType` NULL, e no Postgres NULLs são distintos em UNIQUE.
    //
    // Este `updateMany` condicional é a reserva atômica — o mesmo recurso do banco que
    // `GuideLockService`/`GuideLiberacaoService` já usam. Em READ COMMITTED a segunda transação
    // fica bloqueada na LINHA da guia até a primeira commitar e então reavalia o `where` contra o
    // dado novo: `lancamentoId` deixou de ser nulo, `count` volta 0, e ela desiste sem escrever
    // nada. As verificações de cima continuam onde estão — elas dão o motivo legível no caminho
    // normal; esta é a que vale quando há corrida.
    const reserva = await tx.guide.updateMany({
      where: { id: guide.id, portalClientId, lancamentoId: null },
      data: { baixada: true, dataBaixa: data },
    });
    if (reserva.count !== 1) return { skipped: true, reason: "ja_baixada" };

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
      // `baixada`/`dataBaixa` já foram gravados na reserva acima; aqui completa o vínculo.
      // Q28 Fase 3: pagamento lançado (RASCUNHO) → entra na fila de conferência (PAGA_A_CONFERIR).
      data: { lancamentoId: pagamentoId, parcelaEstado: PARCELA_ESTADOS.PAGA_A_CONFERIR },
    });
    return { ok: true, pagamentoId };
  });
}

/**
 * F2.2 — BAIXA DA PARCELA **SEM GUIA**, ancorada na PARCELA e por DECLARAÇÃO do contador.
 *
 * ⚠ POR QUE ELA EXISTE, E POR QUE NÃO É CASO DE BORDA. Parcelamento em **débito automático** não
 * emite documento: o dinheiro sai da conta e pronto. Não há guia, nunca vai haver, e o dono
 * confirmou que isso é o caso NORMAL de uma classe inteira de clientes (sobretudo no Lucro
 * Presumido). O sistema inteiro ancorava a baixa na guia — `gerarPagamentoParcelaFromGuide` exige
 * `guideId` na assinatura, na guarda de idempotência (`sourceGuideId`) e no efeito colateral
 * (`guide.baixada`/`lancamentoId`) — então para esses contratos a baixa simplesmente não existia:
 * 60 prestações contratadas e nenhuma forma de baixar uma sequer.
 *
 * ⚠ ESTA É A VIA DA **DECLARAÇÃO**, NÃO A DA PROVA. Há duas fontes possíveis de evidência para uma
 * parcela sem guia, e elas não valem o mesmo:
 *
 *   | via | fonte | chave | existe hoje? |
 *   |---|---|---|---|
 *   | **prova** | `DETPAGTOPARC165` (SERPRO) | `(numeroParcelamento, anoMesParcela)` | não — depende do vínculo ao SERPRO |
 *   | **declaração** | o contador sabe que foi debitado e lança | a própria parcela | **é esta** |
 *
 * A distinção fica GRAVADA, não só neste comentário, em três níveis:
 *   1. `parcelas.origemBaixa = "MANUAL"` — o vocabulário da coluna já previa `DEBITO_AUTOMATICO`
 *      para quando a via SERPRO existir. Quem auditar depois distingue "o contador afirmou" de
 *      "a Receita provou" olhando UMA coluna;
 *   2. `AccountingEntry.origem = "MANUAL"` (a via SERPRO gravará `"SERPRO"`, como a ingestão já faz);
 *   3. o histórico de cada lançamento diz `(declarado)`, em texto, para quem só lê o razão.
 *
 * ⚠ A FORMA DO LANÇAMENTO É A MESMA da baixa por guia — `D parcelamento a pagar · D juros · D multa
 * / C caixa`, montada por `linhasPagamento` com as contas saindo de `configPagamento`/
 * `MapaContaTributo` pelo MESMO `resolverConta`. Escrever uma variante aqui faria as duas formas de
 * baixa divergirem no primeiro ajuste de conta, com o contador no meio.
 *
 * ⚠ JUROS E MULTA SÃO **DECLARADOS**, e não derivados. Num débito automático sem documento ninguém
 * mais sabe quanto foi encargo. Isso é entrada de usuário, não invenção — mas derivar juros por
 * SUBTRAÇÃO (`total - principal`) seria inventar, e é exatamente assim que o encargo já foi
 * reconhecido em dobro no passado (o episódio está documentado em `linhasProvisao`). O principal
 * vem da parcela (`valorPrevisto`), o total é a SOMA, e a soma é conferida contra o que o contador
 * viu na tela.
 *
 * ⚠ NÃO SUBSTITUI `gerarPagamentoParcelaFromGuide`. Parcela que TEM guia é recusada aqui e apontada
 * para lá: deixar os dois caminhos abertos para a mesma prestação é convite a baixa dupla — cada um
 * tem a sua guarda, e nenhuma das duas enxerga a outra.
 *
 * @param {Object}   opts
 * @param {string}   opts.portalClientId
 * @param {string}   opts.parcelaId       a linha de `parcelas` (o CONTRATO), não a guia
 * @param {string|Date} [opts.dataPagamento] default = agora
 * @param {number}   [opts.valorJuros]    DECLARADO pelo contador (0 quando não houve)
 * @param {number}   [opts.valorMulta]    DECLARADO pelo contador (0 quando não houve)
 * @param {number}   opts.totalConferido  OBRIGATÓRIO — o total que o contador viu e confirmou
 * @param {string}   [opts.userId]
 * @returns {Promise<{ok?, pagamentoId?, lancamentos?, total?, recalculo?, skipped?, reason?}>}
 * @throws {Error} code `MES_FECHADO` · `CONFERENCIA_OBRIGATORIA` · `CONFERENCIA_DIVERGENTE`
 */
export async function gerarPagamentoParcelaManual({
  portalClientId, parcelaId, dataPagamento, valorJuros, valorMulta, totalConferido, userId,
}) {
  void userId; // reservado p/ auditoria futura (o mesmo TODO que `gerarPagamentoInssFromGuide` tem)

  const parcela = await prisma.parcela.findFirst({
    where: { id: String(parcelaId), portalClientId },
    select: {
      id: true, parcelamentoId: true, numeroParcela: true, competencia: true,
      valorPrevisto: true, guiaId: true, origemBaixa: true,
    },
  });
  if (!parcela) return { skipped: true, reason: "parcela_not_found" };

  // ⚠ RECUSA NOMEADA, COM O CAMINHO CERTO NA MENSAGEM. Uma prestação com guia tem evidência real e
  // documento; a baixa dela é a por guia, que lê a composição (`TributoParcela`) em vez de aceitar
  // juros declarado. Aceitar as duas portas para a mesma parcela é o convite a lançá-la duas vezes:
  // as guardas de idempotência são DIFERENTES (`guide.lancamentoId` lá, `origemBaixa` aqui) e
  // nenhuma enxerga a outra.
  if (parcela.guiaId) {
    return {
      skipped: true,
      reason: "parcela_tem_guia",
      guideId: parcela.guiaId,
      message: "Esta prestação tem guia — dê a baixa pelo caminho da guia, que lê a composição do "
        + "documento em vez de aceitar juros e multa declarados.",
    };
  }
  if (parcela.origemBaixa) {
    return { skipped: true, reason: "parcela_ja_baixada", origemBaixa: parcela.origemBaixa };
  }

  const parcelamento = await prisma.parcelamento.findFirst({
    where: { id: parcela.parcelamentoId, portalClientId },
    select: { id: true, tipo: true, kind: true, numParcelas: true, aberturaEntryId: true, configPagamento: true },
  });
  if (!parcelamento) return { skipped: true, reason: "parcelamento_not_found" };
  // Mesma pré-condição da baixa por guia: sem provisão de abertura não há passivo a amortizar, e o
  // `openEntryId` do lote ficaria nulo (a provisão nunca voltaria ao saldo certo num estorno).
  if (!parcelamento.aberturaEntryId) return { skipped: true, reason: "provisao_inexistente" };

  // ⚠ O PRINCIPAL VEM DO CONTRATO, NÃO DA TELA. `valorPrevisto` é o que `sincronizarParcelas`
  // materializou do cabeçalho do parcelamento. Sem ele não há o que amortizar, e aceitar um valor
  // digitado no lugar transformaria a baixa numa segunda fonte para o valor da prestação.
  const principal = round2(parcela.valorPrevisto != null ? Number(parcela.valorPrevisto) : NaN);
  if (!Number.isFinite(principal) || principal <= 0) {
    return { skipped: true, reason: "sem_valor_previsto" };
  }
  const juros = round2(valorJuros);
  const multa = round2(valorMulta);
  if (juros < 0 || multa < 0) return { skipped: true, reason: "acrescimo_negativo" };
  const total = round2(principal + juros + multa);

  // ⚠ ATO DE CONSEQUÊNCIA: A ROTA RECEBE O QUE FOI CONFERIDO E RECUSA SE DIVERGIR.
  // Mesmo padrão de `EstornoBaixaService.executarEstorno` (`totalConferido`), e aqui ele é
  // OBRIGATÓRIO — não há chamador legado para preservar, e a operação grava `AccountingEntry` a
  // partir de números que o contador DECLAROU. Confirmar sem repetir os dados é confirmar o quê?
  if (totalConferido == null || !Number.isFinite(Number(totalConferido))) {
    const err = new Error(
      "Confirme o total da baixa (principal + juros + multa). A baixa por declaração grava "
      + "lançamento contábil a partir de números informados por você — ela repete o total para que "
      + "você confirme o que está prestes a sair.",
    );
    err.code = "CONFERENCIA_OBRIGATORIA";
    err.detalhe = { principal, juros, multa, total };
    throw err;
  }
  if (Math.abs(round2(totalConferido) - total) > 0.01) {
    const err = new Error(
      `O total que o servidor calcula (R$ ${total.toFixed(2)}) não é o que foi conferido `
      + `(R$ ${round2(totalConferido).toFixed(2)}). Principal R$ ${principal.toFixed(2)} vem do `
      + `contrato; juros R$ ${juros.toFixed(2)} e multa R$ ${multa.toFixed(2)} são os declarados. `
      + "Confira de novo.",
    );
    err.code = "CONFERENCIA_DIVERGENTE";
    err.detalhe = { principal, juros, multa, total, totalConferido: round2(totalConferido) };
    throw err;
  }

  const data = dataPagamento ? new Date(dataPagamento) : new Date();
  if (Number.isNaN(data.getTime())) return { skipped: true, reason: "data_invalida" };
  const competencia = competenciaFromDate(data);
  // A baixa grava `AccountingEntry` — a mesma trava da baixa por guia, do INSS e da baixa genérica.
  if (await isMonthClosed(portalClientId, competencia)) {
    const err = new Error(`Mês ${competencia} fechado — reabra antes de baixar a parcela.`);
    err.code = "MES_FECHADO";
    throw err;
  }

  const tipoParcelamento = parcelamento.tipo || parcelamento.kind || "OUTRO";

  // Contas por papel vindas da CONFIG do parcelamento — a MESMA leitura da baixa por guia.
  const contaPorPapel = {};
  for (const l of Array.isArray(parcelamento.configPagamento) ? parcelamento.configPagamento : []) {
    if (l?.tipoLinha && String(l.conta || "").trim()) contaPorPapel[l.tipoLinha] = String(l.conta).trim();
  }

  // ⚠ A COMPOSIÇÃO SINTÉTICA, com `codigoTributo: null` — e o nulo é honesto. `TributoParcela` é
  // chaveado por `guideId`; sem guia não há composição por tributo, e inventar um código de receita
  // para preencher a coluna faria o `MapaContaTributo` aprender uma conta sob um código que nunca
  // veio da Receita. `resolverConta` já trata `codigoTributo` nulo (cai no mapeamento geral do
  // papel), que é exatamente o que se sabe aqui.
  const parcelaParaLinhas = {
    tributos: [{ codigoTributo: null, nomeTributo: null, principal, multa, juros, total }],
    valorTotal: total,
  };

  return prisma.$transaction(async (tx) => {
    // ⚠ A PARCELA É RESERVADA ANTES DE QUALQUER LANÇAMENTO — e é ela, não a guia, o recurso a
    // reservar neste caminho.
    //
    // O cinto que existe hoje não alcança aqui: `uq_baixa_guia_linha` é parcial em
    // `"sourceGuideId" IS NOT NULL`, e uma baixa sem guia nasce com `sourceGuideId` NULL — cai
    // FORA do índice. As duas verificações lá em cima (`guiaId`, `origemBaixa`) são check-then-act
    // FORA da transação, exatamente como eram as da guia antes de a reserva existir: duplo clique
    // passa pelas duas antes de qualquer uma escrever, e saem dois lotes amortizando o mesmo
    // passivo pela mesma prestação.
    //
    // Este `updateMany` condicional é a reserva atômica — o mesmo recurso do banco que
    // `gerarPagamentoParcelaFromGuide` e `InssPagamentoService` já usam, com a coluna trocada:
    // `origemBaixa: null` é o "ainda não baixada" da parcela. Em READ COMMITTED a segunda
    // transação fica bloqueada na LINHA da parcela até a primeira commitar, reavalia o `where`
    // contra o dado novo (`origemBaixa` deixou de ser nulo), `count` volta 0, e desiste sem
    // escrever nada.
    //
    // ⚠ `guiaId: null` VIAJA NO `where` de propósito: se uma guia for vinculada a esta prestação
    // entre a leitura e a transação (a captura do SERPRO roda sozinha), a reserva deixa de casar e
    // a baixa por declaração desiste — em vez de correr em paralelo com a baixa por guia.
    const reserva = await tx.parcela.updateMany({
      where: { id: parcela.id, portalClientId, origemBaixa: null, guiaId: null },
      data: {
        origemBaixa: ORIGEM_BAIXA.MANUAL,
        // ⚠ AQUI `baixadaEm` É A DATA DO PAGAMENTO DECLARADO — diferente de uma parcela
        // `HISTORICO`, onde ela é a data da DECLARAÇÃO porque a do pagamento não se sabe. Aqui se
        // sabe: o contador está declarando justamente quando o débito saiu da conta, e é essa data
        // que decide a competência do lançamento logo abaixo.
        baixadaEm: data,
      },
    });
    if (reserva.count !== 1) return { skipped: true, reason: "parcela_ja_baixada" };

    // ⚠ MESMO CONSTRUTOR DE LINHAS DA BAIXA POR GUIA. Nada de variante: `linhasPagamento` resolve
    // as contas por papel (config → MapaContaTributo → em branco) e emite
    // `D PARC / D JUROS / D MULTA / C CAIXA`, pulando componente zerado.
    const pagLines = await linhasPagamento(tx, {
      portalClientId, tipoParcelamento, parcela: parcelaParaLinhas, contaPorPapel,
    });

    const entries = await criarLancamentosIndividuais(tx, {
      portalClientId, parcelamentoId: parcelamento.id, linhas: pagLines,
      data, competencia,
      tipo: "BAIXA", subtipo: `PARC_${tipoParcelamento}`,
      // Nível 2 da distinção declaração × prova: quando a via SERPRO existir, ela gravará "SERPRO".
      origem: "MANUAL",
      lote: `PARCV2-${parcelamento.id.slice(0, 8)}-PAGM-${parcela.numeroParcela || "x"}`,
      // Nível 3: em texto, no razão, para quem nunca vai abrir a coluna `origemBaixa`.
      historicoBase: `PAGAMENTO ${tipoParcelamento} PARC ${parcela.numeroParcela || "?"}/`
        + `${parcelamento.numParcelas || "?"} - ${competencia} (declarado)`,
      statusPagamento: "PAGO",
      openEntryId: parcelamento.aberturaEntryId,
      // ⚠ SEM GUIA — e é justamente este nulo que tira o lote do alcance de `uq_baixa_guia_linha`.
      sourceGuideId: null,
      // O que resta em `accounting_entries` para identificar a prestação. Ver o SQL proposto no
      // relatório desta fase.
      numeroParcela: parcela.numeroParcela ?? null,
    });
    const pagamentoId = entries[0]?.id || null;

    // ⚠ NÃO HÁ PONTEIRO DE VOLTA A GRAVAR. `parcelas` não tem `lancamentoId` (nem `baixada`, nem
    // `paymentStatus`): a tabela guarda o CONTRATO, e duplicar o estado de pagamento nela foi
    // deliberadamente evitado na F2.1 para não haver duas respostas divergindo no primeiro estorno.
    // A reserva acima já gravou tudo o que a parcela precisa dizer sobre esta baixa.

    // ⚠ O RECÁLCULO VEM DEPOIS DAS ESCRITAS E DENTRO DA TRANSAÇÃO — mesma disciplina do estorno,
    // pelo mesmo motivo: o número devolvido a quem clicou tem de ser o do estado JÁ baixado. E a
    // regra da IN RFB 2.063/2022 não é recalculada aqui: `recalcularParcelamento` chama
    // `avaliarRiscoRescisao`, a mesma que `decorateParcelamento` usa.
    const recalculo = await recalcularParcelamento(tx, {
      portalClientId, parcelamentoId: parcelamento.id,
    });

    return {
      ok: true,
      pagamentoId,
      lancamentos: entries.length,
      parcelaId: parcela.id,
      numeroParcela: parcela.numeroParcela ?? null,
      origemBaixa: ORIGEM_BAIXA.MANUAL,
      principal,
      juros,
      multa,
      total,
      recalculo,
    };
  });
}

/**
 * A CONFERÊNCIA DO PASSIVO — a soma das prestações que ainda vão amortizar × o que a adesão
 * provisionou.
 *
 * ⚠ ELA NÃO BLOQUEIA NADA, E NÃO PODE BLOQUEAR. `linhasProvisao` reconhece **só o principal**
 * (decisão do dono, não se altera) e o passivo `PARC` nasce valendo esse principal; a soma das
 * amortizações (`D PARC` = `valorPrevisto` de cada prestação) é o que o zera ao longo do contrato.
 * Quando os dois não batem, o passivo termina com resíduo — mas o número certo é decisão de quem
 * lê o contrato, não deste código. Aqui ele é **exibido**, para que a correção de um valor deixe
 * de ser feita às cegas.
 *
 * ⚠ Prestação `HISTORICO` fica FORA da soma: ela não gera `AccountingEntry` (não houve pagamento
 * nosso para lançar) e a provisão desta adesão reconhece o principal do saldo que RESTA. Contá-la
 * faria a conferência acusar um resíduo que não existe.
 */
export async function conferenciaDoPassivoPorContrato(client, { portalClientId, parcelamentoIds }) {
  const ids = [...new Set((Array.isArray(parcelamentoIds) ? parcelamentoIds : []).filter(Boolean).map(String))];
  if (!ids.length) return {};

  // ⚠ DUAS QUERIES PARA TODOS OS CONTRATOS, não duas por contrato. A fila devolve até 200
  // prestações e elas se concentram em poucos acordos; uma consulta por linha seria N+1 numa tela
  // que a F2.1 montou justamente para não ter nenhuma.
  const [prestacoes, linhasPassivo] = await Promise.all([
    client.parcela.findMany({
      where: { parcelamentoId: { in: ids }, portalClientId },
      select: { parcelamentoId: true, valorPrevisto: true, origemBaixa: true },
    }),
    client.accountingEntryLine.findMany({
      where: {
        tipo: "C",
        tipoLinha: "PARC",
        entry: { parcelamentoId: { in: ids }, portalClientId, tipo: "PROVISAO" },
      },
      select: { valor: true, entry: { select: { parcelamentoId: true } } },
    }),
  ]);

  const out = {};
  for (const id of ids) {
    const doContrato = prestacoes.filter((p) => p.parcelamentoId === id);
    const amortizaveis = doContrato.filter((p) => p.origemBaixa !== ORIGEM_BAIXA.HISTORICO);
    const somaPrestacoes = round2(
      amortizaveis.reduce((s, p) => s + (p.valorPrevisto != null ? Number(p.valorPrevisto) : 0), 0),
    );
    const linhas = linhasPassivo.filter((l) => l.entry?.parcelamentoId === id);
    // ⚠ Sem provisão de abertura NÃO se afirma zero: `null` diz "não sei", que é outra coisa.
    const principalProvisionado = linhas.length
      ? round2(linhas.reduce((s, l) => s + Number(l.valor || 0), 0))
      : null;
    out[id] = {
      prestacoesAmortizaveis: amortizaveis.length,
      prestacoesHistoricas: doContrato.length - amortizaveis.length,
      somaPrestacoes,
      principalProvisionado,
      diferenca: principalProvisionado != null ? round2(somaPrestacoes - principalProvisionado) : null,
    };
  }
  return out;
}

async function conferenciaDoPassivo(client, { portalClientId, parcelamentoId }) {
  const porContrato = await conferenciaDoPassivoPorContrato(client, {
    portalClientId, parcelamentoIds: [parcelamentoId],
  });
  return porContrato[String(parcelamentoId)] || null;
}

/**
 * CORRIGIR O VALOR **CONTRATADO** DE UMA PRESTAÇÃO (`parcelas.valorPrevisto`).
 *
 * ⚠ ELE NÃO É O VALOR PAGO, E A DISTINÇÃO É O MOTIVO DE ESTA FUNÇÃO EXISTIR SEPARADA DA BAIXA.
 * Dentro do módulo convivem dois números com o mesmo apelido:
 *
 *   | | o que é | onde mora | o que alimenta |
 *   |---|---|---|---|
 *   | **contratado** | quanto o acordo diz que a prestação vale | `parcelas.valorPrevisto` | o `D PARC` da baixa (amortiza o passivo), a fila de prestações sem guia, a coluna "Principal" |
 *   | **pago** | quanto de fato saiu da conta | `principal + juros + multa` da baixa | o `C CAIXA` do lote |
 *
 * A diferença entre os dois é INFORMAÇÃO (juros, TJLP, atraso), não erro de digitação — por isso
 * ela continua expressa em juros/multa, e por isso esta função **não** aceita "o valor pago": quem
 * pagou mais declara o acréscimo, na baixa.
 *
 * ⚠ POR QUE ISTO PRECISOU EXISTIR. Um contrato criado pelo wizard (parcelamento-first, sem guia e
 * sem composição por tributo) nasce com `valorParcelaReferencia = 0` — `buildDTOsFromManual` deriva
 * o valor da parcela da SOMA DOS TRIBUTOS, e sem guia e sem tributos essa soma é zero. Logo
 * `sincronizarParcelas` materializa as N prestações com `valorPrevisto = 0`, e a fila devolve
 * `motivoBloqueio: "sem_valor_previsto"` em TODAS elas. A mensagem manda "corrigir o valor da
 * parcela no contrato" — e até aqui não havia rota nenhuma que fizesse isso. Contrato inteiro
 * não baixável, com a saída nomeada e inexistente.
 *
 * ⚠ A FORMA DO LANÇAMENTO NÃO MUDA. Esta função não grava `AccountingEntry` nenhum: ela corrige o
 * CONTRATO, e a baixa seguinte lê o valor corrigido pelo mesmo `linhasPagamento` de sempre
 * (`D PARC / D JUROS / D MULTA / C CAIXA`). D e C continuam fechando no lote por construção.
 *
 * ⚠ PRESTAÇÃO JÁ BAIXADA É RECUSADA, e não por precaução: o lançamento dela JÁ foi gravado com o
 * valor antigo. Mudar o contrato depois deixaria o razão e o cadastro contando histórias
 * diferentes sobre a mesma prestação, sem nada na tela dizendo qual vale. A volta é o estorno.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.parcelaId
 * @param {number} opts.valorPrevisto           o valor CONTRATADO novo (> 0)
 * @param {number|null} opts.valorAnteriorConferido  o valor que a tela mostrou (ato de consequência)
 * @param {string} [opts.userId]
 * @throws {Error} code `CONFERENCIA_OBRIGATORIA` · `CONFERENCIA_DIVERGENTE`
 */
export async function corrigirValorPrevistoParcela({
  portalClientId, parcelaId, valorPrevisto, valorAnteriorConferido, userId,
}) {
  void userId; // reservado p/ auditoria futura — o mesmo TODO de `gerarPagamentoParcelaManual`

  const parcela = await prisma.parcela.findFirst({
    where: { id: String(parcelaId), portalClientId },
    select: {
      id: true, parcelamentoId: true, numeroParcela: true, competencia: true,
      valorPrevisto: true, guiaId: true, origemBaixa: true,
    },
  });
  if (!parcela) return { skipped: true, reason: "parcela_not_found" };

  // ⚠ COM GUIA, O VALOR VEM DO DOCUMENTO. `sincronizarParcelas` copia `guia.valor` para a linha e a
  // baixa por guia lê a composição (`TributoParcela`); aceitar um valor digitado aqui criaria a
  // segunda fonte que o módulo inteiro evita — e ela venceria em silêncio na próxima recaptura.
  if (parcela.guiaId) {
    return {
      skipped: true,
      reason: "parcela_tem_guia",
      guideId: parcela.guiaId,
      message: "Esta prestação tem guia — o valor dela vem do documento, não se digita. "
        + "Corrija a guia (ou recapture o comprovante) em vez do contrato.",
    };
  }
  if (parcela.origemBaixa) {
    return {
      skipped: true,
      reason: "parcela_ja_baixada",
      origemBaixa: parcela.origemBaixa,
      message: "Esta prestação já foi baixada, e o lançamento dela foi gravado com o valor antigo. "
        + "Mudar o contrato agora deixaria o razão e o cadastro discordando. Estorne a baixa "
        + "(no lançamento), corrija o valor e lance de novo.",
    };
  }

  const novo = round2(valorPrevisto);
  if (!Number.isFinite(novo) || novo <= 0) return { skipped: true, reason: "valor_invalido" };

  const anterior = parcela.valorPrevisto != null ? round2(Number(parcela.valorPrevisto)) : null;

  // ⚠ ATO DE CONSEQUÊNCIA: A CONFIRMAÇÃO DIZ O QUE ERA E O QUE PASSA A SER — e o servidor confere o
  // "era". Mesmo padrão do `totalConferido` da baixa e do estorno: se o valor mudou entre a tela e
  // o clique (outra sessão, ou uma reingestão do contrato), a resposta é recusa, não uma alteração
  // sobre um "antes" que o contador nunca viu.
  if (valorAnteriorConferido === undefined) {
    const err = new Error(
      "Confirme qual é o valor atual da prestação. Alterar o valor CONTRATADO muda o que a próxima "
      + "baixa vai amortizar do passivo — a confirmação repete o que era e o que passa a ser.",
    );
    err.code = "CONFERENCIA_OBRIGATORIA";
    err.detalhe = { anterior, novo };
    throw err;
  }
  const conferido = valorAnteriorConferido == null ? null : round2(valorAnteriorConferido);
  const bate = anterior == null
    ? conferido == null
    : (conferido != null && Math.abs(conferido - anterior) <= 0.01);
  if (!bate) {
    const err = new Error(
      `O valor atual desta prestação no contrato é ${anterior == null ? "ausente" : `R$ ${anterior.toFixed(2)}`}, `
      + `e a tela conferiu ${conferido == null ? "ausente" : `R$ ${conferido.toFixed(2)}`}. `
      + "Alguém pode tê-lo mudado. Recarregue a fila e confira de novo.",
    );
    err.code = "CONFERENCIA_DIVERGENTE";
    err.detalhe = { anterior, conferido, novo };
    throw err;
  }

  // ⚠ A MESMA RESERVA CONDICIONAL DA BAIXA, e pelo mesmo motivo: as duas guardas acima são
  // check-then-act FORA de qualquer transação. Entre a leitura e a escrita a captura do SERPRO pode
  // vincular uma guia, ou uma baixa por declaração pode entrar — e o `where` reavaliado contra o
  // dado novo faz esta correção desistir em vez de reescrever o contrato de uma prestação que
  // acabou de ganhar lançamento.
  const r = await prisma.parcela.updateMany({
    where: { id: parcela.id, portalClientId, origemBaixa: null, guiaId: null },
    data: { valorPrevisto: novo },
  });
  if (r.count !== 1) return { skipped: true, reason: "parcela_ja_baixada" };

  const conferencia = await conferenciaDoPassivo(prisma, {
    portalClientId, parcelamentoId: parcela.parcelamentoId,
  });

  return {
    ok: true,
    parcelaId: parcela.id,
    numeroParcela: parcela.numeroParcela ?? null,
    competencia: parcela.competencia ?? null,
    valorAnterior: anterior,
    valorPrevisto: novo,
    semMudanca: anterior != null && Math.abs(anterior - novo) <= 0.01,
    // A conferência do passivo — informativa, nunca bloqueio. Ver `conferenciaDoPassivo`.
    conferencia,
  };
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
  const escopo = portalClientId ? { portalClientId: String(portalClientId) } : {};

  // ⚠ F2.1 — A VARREDURA PASSOU A SER ANCORADA NA PARCELA, NÃO NA GUIA.
  //
  // O estado (`parcelaEstado`) continua morando na GUIA, e continua sendo escrito nela: enquanto a
  // baixa for por guia, mover esse campo para cá criaria duas colunas de estado para a mesma
  // prestação. O que muda é de onde a lista sai — a prestação é a unidade, a guia é o documento
  // dela. Sem isso, "quantas prestações estão em aberto?" só sabia contar as que tinham documento.
  const parcelas = await prisma.parcela.findMany({
    where: {
      ...escopo,
      guia: { parcelaEstado: { in: ESTADOS_EM_ABERTO }, baixada: false },
    },
    select: { id: true, guia: { select: { id: true, parcelaEstado: true, vencimento: true, paymentStatus: true } } },
  });

  const porEstado = {};
  let atualizadas = 0;
  for (const p of parcelas) {
    const g = p.guia;
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

  // ⚠ AS PRESTAÇÕES SEM DOCUMENTO NÃO SOMEM DO RELATÓRIO — elas não têm estado a recalcular (não há
  // guia onde gravá-lo), mas existem e são devidas. Antes elas nem eram contáveis; reportá-las
  // separadamente é a diferença entre "não há nada em aberto" e "há isto aqui que não sei avaliar".
  const semGuia = await prisma.parcela.count({
    where: { ...escopo, guiaId: null, origemBaixa: null },
  });

  return { avaliadas: parcelas.length, atualizadas, porEstado, semGuia };
}

/**
 * Q28 Fase 3 — Fila de conferência: lista as parcelas pagas a conferir + divergentes.
 */
export async function listarConferenciaParcelas({ portalClientId }) {
  // F2.1: ancorada na PARCELA (a unidade), com a guia junto (o documento e, hoje, o estado).
  // O filtro é o mesmo de antes; o que muda é que agora existe uma linha de parcela por trás de
  // cada item, então `numeroParcela` vem do contrato e não fica nulo quando a guia não o tem.
  const parcelas = await prisma.parcela.findMany({
    where: {
      portalClientId,
      guia: { parcelaEstado: { in: [PARCELA_ESTADOS.PAGA_A_CONFERIR, PARCELA_ESTADOS.DIVERGENTE] } },
    },
    select: {
      id: true, parcelamentoId: true, numeroParcela: true, anoMesParcela: true, competencia: true,
      guia: {
        select: {
          id: true, numeroParcela: true, anoMesParcela: true, competencia: true,
          valor: true, dataBaixa: true, parcelaEstado: true, lancamentoId: true,
        },
      },
      parcelamento: { select: { label: true, tipo: true, numeroParcelamento: true } },
    },
    orderBy: { guia: { dataBaixa: "desc" } },
    take: 200,
  });
  return parcelas.map((p) => ({
    parcelaId: p.id,
    guideId: p.guia.id,
    parcelamentoId: p.parcelamentoId,
    parcelamentoLabel: p.parcelamento?.label || null,
    tipo: p.parcelamento?.tipo || null,
    numeroParcelamento: p.parcelamento?.numeroParcelamento || null,
    numeroParcela: p.numeroParcela ?? p.guia.numeroParcela,
    competencia: p.guia.competencia ?? p.competencia,
    anoMesParcela: p.guia.anoMesParcela ?? p.anoMesParcela,
    valor: p.guia.valor != null ? Number(p.guia.valor) : null,
    dataBaixa: p.guia.dataBaixa,
    estado: p.guia.parcelaEstado,
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
