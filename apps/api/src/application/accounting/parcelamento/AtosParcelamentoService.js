// OS ATOS ADMINISTRATIVOS DO CONTRATO — excluir o parcelamento e desfazer a rescisão.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// O PEDIDO, E O PRINCÍPIO QUE ELE CARREGA
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// > *"Devo poder excluir um parcelamento. Estou com um lançamento de rescisão de um parcelamento
// > que não faz sentido, o parcelamento estava errado."* — e, logo depois, a régua:
// > **"lembre-se que deve dar autonomia ao contador"**.
//
// Autonomia aqui tem um significado preciso, e ele é o oposto de "faz o que mandar sem dizer nada":
// **o contador PODE excluir — inclusive contrato com prestação já baixada — e o sistema não
// bloqueia. O que o sistema faz é MOSTRAR O PESO**, com números reais, antes do clique. Ele sabe se
// aquele dinheiro saiu de verdade; nós não. Uma trava aqui seria tutela; um "tem certeza?" genérico
// seria a mesma tutela com outra roupa, porque esconde a informação que faria a decisão ser dele.
//
// ⚠ MEDIDO EM PRODUÇÃO ANTES DE ESCREVER UMA LINHA (10/08/2026, `scripts/diag-rescisao-parcelamento.mjs`):
// **não existe "lançamento de rescisão" na base** — a união de três buscas em `accounting_entries`
// deu ZERO. O que o dono chama assim é o `status = "RESCINDIDO"` do contrato. Os dois contratos
// rescindidos são CASCAS VAZIAS (0 lançamentos, `aberturaEntryId` nulo, 10 e 60 prestações, 1 guia).
// Ou seja: **nos dois casos de hoje a exclusão é quase sem consequência contábil**. Este serviço
// não é escrito para eles — é escrito para o botão, que vai existir para sempre e vai encontrar
// contrato com provisão lançada, com baixa confirmada e com competência fechada.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// AS CINCO REGRAS QUE NÃO SÃO NEGOCIÁVEIS (e onde cada uma mora aqui)
// ════════════════════════════════════════════════════════════════════════════════════════════
//
//  1. **MOTIVO OBRIGATÓRIO**, com autor e data, gravado — é o que transforma "apagou" em "decidiu e
//     assinou". Checado ANTES de qualquer leitura, como em `EstornoBaixaService`, e com CHECK no
//     banco (`atos_parcelamento`). O desenho da tabela é o de `estornos_baixa`, pelo mesmo motivo:
//     no modo DELECAO as linhas que ela explica DEIXAM DE EXISTIR, então a auditoria não pode morar
//     nelas e cada campo é CÓPIA, não referência.
//  2. **A confirmação lista o que vai acontecer, com números reais** — quantas prestações, quantas
//     guias, quantos lançamentos, que valor. É o `previewExclusaoParcelamento`, rota própria que não
//     escreve nada, igual ao preview do estorno.
//  3. **Mês fechado → contra-lançamento, nunca DELETE**, e a tela DIZ isso com essas palavras: a
//     ação aconteceu de outro jeito, não foi negada. O espelho é o de `contraLancamento.js` — o
//     MESMO do estorno, não uma segunda cópia.
//  4. **A reserva atômica de `parcelas.origemBaixa` e o índice `uq_baixa_parcela_linha` não são
//     afrouxados.** Este serviço não escreve `origemBaixa` nem cria lançamento `tipo:"BAIXA"`; ele
//     só desfaz. As duas travas continuam valendo para quem baixa.
//  5. **A guia NÃO é apagada — é DESVINCULADA.** Ver o bloco abaixo.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ A GUIA VINCULADA: DESVINCULA, NUNCA APAGA
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// A guia **existe independentemente do contrato**: ela é um DOCUMENTO QUE CHEGOU (capturado do
// SERPRO ou subido em PDF), tem arquivo armazenado, tem histórico de envio ao cliente e pode ter
// confirmação de pagamento vinda da Receita. O parcelamento é a interpretação que damos a ela.
// Apagar a guia porque a interpretação estava errada destruiria a prova para corrigir a leitura — e,
// pior, o cliente já recebeu aquele documento por e-mail: o mundo lá fora não desfaz junto.
//
// Então a exclusão faz `parcelamentoId = null` (mais `numeroParcela`, `quantidadeParcelas`,
// `anoMesParcela` e `parcelaEstado`, que só significam alguma coisa DENTRO de um contrato).
//
// ⚠ E ISSO TEM UMA CONSEQUÊNCIA QUE PRECISA APARECER NA TELA, porque é dinheiro na cara do
// dashboard: `colunaMatrizDaGuia` (`guides/guideContract.js`) responde `PARC_DAS` **enquanto houver
// `parcelamentoId`**. Sem ele, uma guia de tipo SIMPLES volta a ser **DAS da competência** e passa a
// satisfazer o nó `das` do `guideCompliance` — a tag "DAS faltando" some daquele mês. Não é defeito:
// é a leitura correta de uma guia que não é mais parcela. Mas quem exclui tem de saber, e por isso o
// preview devolve `guias.voltamAContarComo`.
//
// ⚠ `TributoParcela` (a composição por tributo, lida do PDF/SERPRO) **fica**. Ela é a LEITURA DO
// DOCUMENTO, pendurada na guia por FK própria; o documento fica, a leitura dele fica. Nenhum caminho
// vivo a alcança sem `parcelamentoId` (só `gerarPagamentoParcelaFromGuide`, que exige a guia
// vinculada), então ela não volta a agir sozinha — e apagá-la seria descartar dado que custou uma
// chamada paga para existir.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ QUANDO O CABEÇALHO **NÃO** PODE SER APAGADO — e por que isso não é meia-exclusão
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// `accounting_entries.parcelamentoId` tem `onDelete: SetNull`. E `computeFechamentoBlockers` agrupa
// os lançamentos do parcelamento **por `parcelamentoId`** para checar D≠C — eles nascem com UMA
// PERNA SÓ e só balanceiam em conjunto. Some a linha de `parcelamentos`, some a chave do grupo: os
// lançamentos preservados (e os espelhos) passam a ser avaliados um a um e viram
// `desbalanceado`, **travando o fechamento do mês** para sempre, longe daqui.
//
// Por isso:
//   · **nada sobreviveu** (modo DELECAO)      → o cabeçalho é APAGADO de verdade;
//   · **sobrou lançamento** (mês fechado)     → o cabeçalho FICA, com `status = "EXCLUIDO"`, como
//     âncora do grupo. Ele some de todas as telas (`listParcelamentos` o filtra) e suas prestações
//     são removidas, então nenhuma fila volta a mostrá-lo.
//
// ⚠ E o `numeroParcelamento` do cabeçalho que fica é ZERADO. Não é limpeza: `@@unique([portalClientId,
// tipo, numeroParcelamento])` faria o contrato excluído BLOQUEAR o recadastro do mesmo número — que é
// exatamente o caso do dono ("a errada foi rescindida e a certa relançada"). O número continua legível
// na cópia da auditoria e no histórico de cada lançamento preservado.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { competenciaDe, criarContraLancamento } from "../contraLancamento.js";
import { isMonthClosed } from "../fechamentoContabil.js";
import { colunaMatrizDaGuia } from "../../guides/guideContract.js";
import {
  SELECT_PARCELA_PARA_QUADRO, quadroDasParcelas, recalcularParcelamento,
} from "./recalculoParcelamento.js";

export const MOTIVO_MIN = 5;
export const MODO = Object.freeze({ DELECAO: "DELECAO", CONTRA_LANCAMENTO: "CONTRA_LANCAMENTO" });
export const ATO = Object.freeze({ EXCLUSAO: "EXCLUSAO", RESCISAO_DESFEITA: "RESCISAO_DESFEITA" });
/** O status que marca o cabeçalho que teve de sobreviver. Ver o bloco do cabeçalho, acima. */
export const STATUS_EXCLUIDO = "EXCLUIDO";

/** Erro de negócio com código estável para a rota traduzir em status HTTP. */
export class AtoRecusado extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "AtoRecusado";
    this.code = code;
    Object.assign(this, extra);
  }
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SELECT_LANCAMENTO = Object.freeze({
  id: true, portalClientId: true, tipo: true, subtipo: true, status: true,
  competencia: true, data: true, historico: true,
  openEntryId: true, sourceGuideId: true, parcelamentoId: true, numeroParcela: true,
  loteImportacao: true, tipoLinha: true, codigoTributo: true,
  lines: { select: { conta: true, tipo: true, valor: true, ordem: true, tipoLinha: true, codigoTributo: true }, orderBy: { ordem: "asc" } },
});

/**
 * Valor de um lançamento = soma dos DÉBITOS.
 *
 * ⚠ Idêntico ao de `EstornoBaixaService` de propósito, e pelo mesmo motivo: os lançamentos do
 * parcelamento têm UMA PERNA SÓ, e somar débitos e créditos juntos contaria o mesmo dinheiro duas
 * vezes na tela de confirmação — que é justamente o número que o contador vai conferir.
 */
function valorDoLancamento(entry) {
  const lines = entry?.lines || [];
  const d = lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  if (d > 0) return r2(d);
  return r2(lines.reduce((s, l) => s + Number(l.valor || 0), 0));
}

/** `tipo="PARCELA"` é linha LEVE de rastreio: sem linhas D/C, zero impacto contábil. */
const ehLinhaLeve = (e) => String(e?.tipo || "").toUpperCase() === "PARCELA";

/** O `loteImportacao` que `rescindirParcelamento` grava nos dois caminhos (V1 com template e V2). */
export function loteDaRescisao(parcelamentoId) {
  return `PARC-${String(parcelamentoId).slice(0, 8)}-RESCISAO`;
}

function resumoDoLancamento(e, fechadas) {
  return {
    id: e.id,
    tipo: e.tipo,
    competencia: e.competencia,
    historico: e.historico,
    tipoLinha: e.tipoLinha,
    status: e.status,
    valor: valorDoLancamento(e),
    // ⚠ POR LANÇAMENTO, não pelo contrato: um parcelamento de 60 meses atravessa competências
    // fechadas E abertas, e a resposta não é a mesma para as duas metades.
    mesFechado: fechadas.has(e.competencia),
  };
}

/** As competências FECHADAS entre as informadas — uma pergunta por competência distinta. */
async function competenciasFechadas(portalClientId, competencias) {
  const fechadas = new Set();
  for (const comp of new Set(competencias.filter(Boolean))) {
    // eslint-disable-next-line no-await-in-loop
    if (await isMonthClosed(portalClientId, comp)) fechadas.add(comp);
  }
  return fechadas;
}

async function carregarContrato(portalClientId, parcelamentoId) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    select: {
      id: true, label: true, tipo: true, kind: true, numeroParcelamento: true, status: true,
      competenciaInicial: true, numParcelas: true, totalValue: true, principalPerParcela: true,
      saldoConsolidado: true, aberturaEntryId: true, formaPagamento: true, observacoes: true,
    },
  });
  if (!parc) throw new AtoRecusado("parcelamento_nao_encontrado", "Parcelamento não encontrado.");
  return parc;
}

/**
 * O PREVIEW DA EXCLUSÃO — tudo o que vai acontecer, com números reais, sem escrever nada.
 *
 * ⚠ ELE É A EXIGÊNCIA 2, não um enfeite. "Tem certeza que deseja excluir?" é a pergunta que não dá
 * ao contador nada com que decidir: ele não sabe se aquele contrato tem três prestações ou sessenta,
 * se há baixa lançada, se alguma competência está fechada, nem o que acontece com a guia que ele
 * subiu semana passada. Cada número daqui existe para responder uma dessas perguntas ANTES do
 * clique — e é por isso que a rota é própria e não escreve.
 */
export async function previewExclusaoParcelamento({ portalClientId, parcelamentoId, agora = new Date() }) {
  const parc = await carregarContrato(portalClientId, parcelamentoId);

  const lancamentos = await prisma.accountingEntry.findMany({
    where: { portalClientId, parcelamentoId },
    select: SELECT_LANCAMENTO,
    orderBy: [{ competencia: "asc" }, { createdAt: "asc" }],
  });
  const contabeis = lancamentos.filter((e) => !ehLinhaLeve(e));
  const linhasLeves = lancamentos.filter(ehLinhaLeve);

  const fechadas = await competenciasFechadas(portalClientId, contabeis.map((e) => e.competencia));
  const preservados = contabeis.filter((e) => fechadas.has(e.competencia));
  const apagaveis = contabeis.filter((e) => !fechadas.has(e.competencia));

  const modo = preservados.length ? MODO.CONTRA_LANCAMENTO : MODO.DELECAO;
  const competenciaHoje = competenciaDe(agora);

  const parcelas = await prisma.parcela.findMany({
    where: { portalClientId, parcelamentoId },
    select: SELECT_PARCELA_PARA_QUADRO,
  });
  const quadro = quadroDasParcelas(parcelas, { status: parc.status, agora });

  const guias = await prisma.guide.findMany({
    where: { portalClientId, parcelamentoId },
    select: {
      id: true, tipo: true, competencia: true, numeroParcela: true, valor: true,
      baixada: true, paymentStatus: true, paymentStatusSource: true, lancamentoId: true,
    },
    orderBy: { numeroParcela: "asc" },
  });

  const bloqueios = [];
  // ⚠ EXPORTADO BLOQUEIA, e a resposta é a MESMA do estorno (`LOTE_JA_EXPORTADO`) de propósito.
  // Lançamento exportado já saiu daqui para o sistema contábil do escritório; apagá-lo (ou espelhá-lo
  // sem que o outro lado saiba) faria as duas bases contarem histórias diferentes sobre o mesmo mês.
  // Duas respostas para a mesma pergunta dentro do mesmo módulo é o defeito que este projeto já
  // pagou caro várias vezes — então aqui ela é uma só.
  const exportado = contabeis.find((e) => e.status === "EXPORTADO");
  if (exportado) {
    bloqueios.push({
      code: "LOTE_JA_EXPORTADO",
      message: `O lançamento "${exportado.historico}" (${exportado.competencia}) já foi EXPORTADO — `
        + "ele já saiu daqui para a contabilidade. Excluir o contrato apagaria de um lado o que o "
        + "outro lado já tem. Estorne/ajuste do lado exportado antes.",
      entryId: exportado.id,
    });
  }
  if (modo === MODO.CONTRA_LANCAMENTO && await isMonthClosed(portalClientId, competenciaHoje)) {
    bloqueios.push({
      code: "MES_CORRENTE_FECHADO",
      competencia: competenciaHoje,
      message: `Este contrato tem lançamento em competência fechada (${[...fechadas].join(", ")}), `
        + `então a exclusão sai como contra-lançamento em ${competenciaHoje} — que também está `
        + `fechada. Reabra ${competenciaHoje} para excluir.`,
    });
  }

  // ── O PESO — o que o contador precisa VER, e que NÃO bloqueia nada ──────────────────────────
  const guiasBaixadas = guias.filter((g) => g.baixada || g.lancamentoId);
  const avisos = [];
  if (quadro.parcelasPagas > 0) {
    avisos.push({
      code: "PRESTACOES_COM_BAIXA",
      quantidade: quadro.parcelasPagas,
      message: `${quadro.parcelasPagas} de ${quadro.parcelasTotal} prestações constam QUITADAS neste `
        + "contrato. Excluir apaga o registro desses pagamentos aqui dentro — o dinheiro que saiu da "
        + "conta do cliente não volta, e só você sabe se ele saiu.",
    });
  }
  if (guias.length) {
    avisos.push({
      code: "GUIAS_DESVINCULADAS",
      quantidade: guias.length,
      message: `${guias.length} guia(s) NÃO serão apagadas — elas são documentos que chegaram e `
        + "continuam na aba Guias. O que se desfaz é o vínculo com este contrato.",
    });
  }

  const lancamentosResumo = contabeis.map((e) => resumoDoLancamento(e, fechadas));

  return {
    parcelamento: {
      id: parc.id,
      label: parc.label,
      tipo: parc.tipo || parc.kind || null,
      numeroParcelamento: parc.numeroParcelamento,
      status: parc.status,
      competenciaInicial: parc.competenciaInicial,
      numParcelas: parc.numParcelas,
      totalValue: parc.totalValue != null ? Number(parc.totalValue) : null,
      temProvisaoDeAbertura: Boolean(parc.aberturaEntryId),
    },
    modo,
    competenciaContraLancamento: modo === MODO.CONTRA_LANCAMENTO ? competenciaHoje : null,
    competenciasFechadas: [...fechadas].sort(),
    // ⚠ O CABEÇALHO SOBREVIVE quando sobra lançamento — e a tela diz isso, porque "excluí e ele
    // ainda aparece em algum lugar" sem explicação é pior que não excluir.
    cabecalhoRemovido: modo === MODO.DELECAO,
    prestacoes: {
      total: quadro.parcelasTotal,
      quitadas: quadro.parcelasPagas,
      semEvidencia: quadro.parcelasSemEvidencia,
    },
    guias: {
      total: guias.length,
      baixadas: guiasBaixadas.length,
      // ⚠ A CONSEQUÊNCIA NO DASHBOARD, calculada com a MESMA função que o dashboard usa
      // (`colunaMatrizDaGuia`), e não com um `if` escrito aqui: desvinculada, a guia deixa a coluna
      // PARC_DAS e volta a valer como a guia do tributo dela naquele mês.
      voltamAContarComo: [...new Set(guias.map((g) => colunaMatrizDaGuia({ ...g, parcelamentoId: null })))],
      lista: guias.map((g) => ({
        id: g.id, tipo: g.tipo, competencia: g.competencia, numeroParcela: g.numeroParcela,
        valor: g.valor != null ? Number(g.valor) : null,
        baixada: Boolean(g.baixada),
        paymentStatus: g.paymentStatus,
        deColuna: colunaMatrizDaGuia({ ...g, parcelamentoId: parc.id }),
        paraColuna: colunaMatrizDaGuia({ ...g, parcelamentoId: null }),
      })),
    },
    lancamentos: {
      total: contabeis.length,
      apagados: apagaveis.length,
      preservados: preservados.length,
      // As linhas leves `tipo="PARCELA"` viajam CONTADAS e SEPARADAS: elas somem nos dois modos
      // (não têm linha D/C, não mudam saldo nenhum) e misturá-las no total inflaria o número que o
      // contador confere.
      linhasDeRastreio: linhasLeves.length,
      lista: lancamentosResumo,
    },
    // ⚠ O NÚMERO DA CONFERÊNCIA — é ele que volta no POST como `totalConferido`. Só débitos.
    totalDesfeito: r2(lancamentosResumo.reduce((s, l) => s + l.valor, 0)),
    motivoObrigatorio: true,
    avisos,
    bloqueios,
  };
}

function exigirMotivo(motivo, oQue) {
  const limpo = String(motivo || "").trim();
  if (limpo.length < MOTIVO_MIN) {
    // ⚠ A PRIMEIRA COISA CHECADA, antes de qualquer leitura — mesma disciplina do estorno. Sem
    // motivo a operação não começa: recusar "no fim" deixaria leitura feita e a impressão de que
    // faltou pouco.
    throw new AtoRecusado(
      "MOTIVO_OBRIGATORIO",
      `Informe o motivo (mínimo ${MOTIVO_MIN} caracteres). ${oQue} é o tipo de decisão que alguém `
      + "vai questionar meses depois — sem o motivo, o registro responde \"o quê\" e deixa \"por quê\" "
      + "para a memória de quem clicou.",
      { minimo: MOTIVO_MIN },
    );
  }
  return limpo;
}

/**
 * EXECUTA A EXCLUSÃO. Tudo numa transação: ou o contrato inteiro sai (com a auditoria gravada), ou
 * nada acontece.
 *
 * @param {string} motivo OBRIGATÓRIO (CHECK no banco também).
 * @param {number} [totalConferido] o total que o contador VIU na confirmação.
 */
export async function excluirParcelamento({
  portalClientId, parcelamentoId, motivo, userId, totalConferido = null, agora = new Date(),
}) {
  const motivoLimpo = exigirMotivo(motivo, "Excluir um parcelamento");

  const preview = await previewExclusaoParcelamento({ portalClientId, parcelamentoId, agora });
  if (preview.bloqueios.length) {
    const b = preview.bloqueios[0];
    throw new AtoRecusado(b.code, b.message, { competencia: b.competencia, entryId: b.entryId });
  }
  if (totalConferido != null && Math.abs(r2(totalConferido) - preview.totalDesfeito) > 0.01) {
    // ⚠ Não é cerimônia: entre a tela e o clique, o worker de captura pode ter trazido a guia de
    // mais uma parcela, ou outra sessão pode ter lançado uma baixa. Quem confirmou viu um contrato
    // e estaria excluindo outro.
    throw new AtoRecusado(
      "CONFERENCIA_DIVERGENTE",
      `O que está para ser desfeito (R$ ${preview.totalDesfeito.toFixed(2)}) não é o que foi `
      + `confirmado (R$ ${r2(totalConferido).toFixed(2)}). O contrato mudou desde que a tela foi `
      + "aberta — confira de novo.",
      { totalDesfeito: preview.totalDesfeito, totalConferido: r2(totalConferido) },
    );
  }

  const idsPreservados = preview.lancamentos.lista.filter((l) => l.mesFechado).map((l) => l.id);
  const idsApagados = preview.lancamentos.lista.filter((l) => !l.mesFechado).map((l) => l.id);

  return prisma.$transaction(async (tx) => {
    // ── 1. Reler o que será desfeito, DENTRO da transação ────────────────────────────────────
    const atuais = await tx.accountingEntry.findMany({
      where: { portalClientId, parcelamentoId },
      select: SELECT_LANCAMENTO,
    });
    const contabeis = atuais.filter((e) => !ehLinhaLeve(e));
    if (contabeis.length !== preview.lancamentos.total) {
      throw new AtoRecusado(
        "CONTRATO_MUDOU",
        "O parcelamento mudou enquanto a exclusão era processada (outro lançamento entrou ou saiu) "
        + "— nada foi feito. Confira e tente de novo.",
      );
    }

    // ── 2. Os lançamentos de competência FECHADA ficam, e ganham espelho ─────────────────────
    const contraLancamentos = [];
    for (const e of contabeis.filter((x) => idsPreservados.includes(x.id))) {
      // eslint-disable-next-line no-await-in-loop
      const espelho = await criarContraLancamento(tx, {
        portalClientId, entry: e, competencia: preview.competenciaContraLancamento, agora,
        rotulo: "EXCLUSAO",
      });
      contraLancamentos.push(espelho);
    }

    // ── 3. O resto sai ───────────────────────────────────────────────────────────────────────
    // ⚠ As linhas leves `tipo="PARCELA"` saem NOS DOIS MODOS, inclusive de competência fechada, e
    // isso não fura a regra do mês fechado: elas não têm linha D/C nenhuma, `computeFechamentoBlockers`
    // as ignora explicitamente e toda soma/export do módulo as exclui. Não há saldo para mudar.
    const idsParaApagar = [
      ...idsApagados,
      ...atuais.filter(ehLinhaLeve).map((e) => e.id),
    ];
    if (idsParaApagar.length) {
      await tx.accountingEntry.deleteMany({ where: { id: { in: idsParaApagar }, portalClientId } });
    }

    // ── 4. As guias: DESVINCULADAS, nunca apagadas (ver o cabeçalho deste arquivo) ───────────
    // ⚠ E REABERTAS quando tinham baixa. `Guide.lancamentoId` NÃO TEM FK — ninguém o anula sozinho.
    // Deixar `baixada: true` apontando para um lançamento que acabou de sair (ou que foi anulado por
    // espelho) é o defeito permanente que este módulo já viveu duas vezes: a guia some da fila de
    // pendentes (que exige `baixada: false`) e toda tentativa de relançar responde `ja_baixada`,
    // para sempre, sem caminho de volta por nenhuma tela.
    const guias = await tx.guide.findMany({
      where: { portalClientId, parcelamentoId },
      select: { id: true, baixada: true, lancamentoId: true },
    });
    for (const g of guias) {
      // eslint-disable-next-line no-await-in-loop
      await tx.guide.update({
        where: { id: g.id },
        data: {
          parcelamentoId: null,
          numeroParcela: null,
          quantidadeParcelas: null,
          anoMesParcela: null,
          // O estado de PARCELA da guia não tem sujeito depois disto — ela não é parcela de nada.
          parcelaEstado: null,
          ...(g.baixada || g.lancamentoId
            ? { baixada: false, dataBaixa: null, lancamentoId: null }
            : {}),
          // ⚠ `paymentStatus` NÃO É TOCADO. Se a Receita confirmou o pagamento daquele documento, o
          // pagamento aconteceu — isso é fato dela, não deste contrato. O estorno já faz a mesma
          // distinção; aqui ela é ainda mais clara, porque a guia deixa de pertencer ao acordo e
          // volta a ser uma guia comum, com a vida dela.
        },
      });
    }

    // ── 5. As prestações contratadas saem ────────────────────────────────────────────────────
    // Elas são o CONTRATO (quais prestações existem), não o razão. Saem nos dois modos — inclusive
    // quando o cabeçalho sobrevive, senão as filas de baixa continuariam listando prestações de um
    // acordo que não existe mais.
    const prestacoes = await tx.parcela.deleteMany({ where: { portalClientId, parcelamentoId } });

    // ── 6. O cabeçalho ───────────────────────────────────────────────────────────────────────
    const cabecalhoRemovido = contraLancamentos.length === 0 && idsPreservados.length === 0;
    if (cabecalhoRemovido) {
      await tx.parcelamento.delete({ where: { id: parcelamentoId } });
    } else {
      // ⚠ FICA como âncora do grupo (ver o bloco no cabeçalho deste arquivo), invisível nas telas.
      await tx.parcelamento.update({
        where: { id: parcelamentoId },
        data: {
          status: STATUS_EXCLUIDO,
          // Libera a chave única para o recadastro do MESMO número — o caso do dono.
          numeroParcelamento: null,
          label: `EXCLUÍDO — ${preview.parcelamento.label}`,
          observacoes: [preview.parcelamento.numeroParcelamento
            ? `Excluído em ${agora.toISOString().slice(0, 10)} (nº ${preview.parcelamento.numeroParcelamento}). Motivo: ${motivoLimpo}`
            : `Excluído em ${agora.toISOString().slice(0, 10)}. Motivo: ${motivoLimpo}`,
          `Cabeçalho preservado porque ${idsPreservados.length} lançamento(s) estão em competência fechada e viraram contra-lançamento.`,
          ].join("\n"),
        },
      });
    }

    // ── 7. A AUDITORIA (exigência 1) ─────────────────────────────────────────────────────────
    const ato = await tx.atoParcelamento.create({
      data: {
        portalClientId,
        parcelamentoId,
        ato: ATO.EXCLUSAO,
        labelOriginal: preview.parcelamento.label,
        tipoOriginal: preview.parcelamento.tipo,
        numeroParcelamentoOriginal: preview.parcelamento.numeroParcelamento,
        statusOriginal: preview.parcelamento.status,
        competenciaInicial: preview.parcelamento.competenciaInicial,
        totalValueOriginal: preview.parcelamento.totalValue ?? 0,
        prestacoesRemovidas: prestacoes.count,
        prestacoesQuitadas: preview.prestacoes.quitadas,
        guiasDesvinculadas: guias.length,
        lancamentosApagados: idsApagados.length,
        lancamentosPreservados: idsPreservados.length,
        contraLancamentosCriados: contraLancamentos.length,
        valorTotalDesfeito: preview.totalDesfeito,
        competenciasFechadas: preview.competenciasFechadas.join(",") || null,
        modo: preview.modo,
        competenciaContra: preview.competenciaContraLancamento,
        cabecalhoRemovido,
        motivo: motivoLimpo,
        executadoPorUserId: userId ? String(userId) : null,
        executadoEm: agora,
        // ⚠ CÓPIA do que saiu, item a item: no modo DELECAO essas linhas não existem mais depois
        // deste commit, e um registro que só diz "5 lançamentos" não responde a pergunta que alguém
        // vai fazer daqui a seis meses.
        detalhe: {
          lancamentos: preview.lancamentos.lista,
          guias: preview.guias.lista,
          linhasDeRastreio: preview.lancamentos.linhasDeRastreio,
        },
      },
      select: { id: true },
    });

    return {
      ok: true,
      atoId: ato.id,
      modo: preview.modo,
      motivo: motivoLimpo,
      cabecalhoRemovido,
      prestacoesRemovidas: prestacoes.count,
      guiasDesvinculadas: guias.length,
      lancamentosApagados: idsApagados.length,
      lancamentosPreservados: idsPreservados.length,
      contraLancamentos,
      competenciaContraLancamento: preview.competenciaContraLancamento,
      totalDesfeito: preview.totalDesfeito,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// DESFAZER A RESCISÃO — porque rescindir por engano não pode ter como única saída excluir
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ `rescindirParcelamento` NÃO TINHA INVERSO. O contrato ia para `RESCINDIDO`, a aba deixava de
// mostrá-lo (`renderParcelamentoTab` filtrava `status !== "RESCINDIDO"`) e as prestações dele saíam
// da fila de baixa sem uma palavra. Quem rescindiu o contrato errado ficava com uma saída só —
// excluir um acordo que talvez ele quisesse manter, perdendo as prestações e o histórico junto.
//
// O que se desfaz é o LANÇAMENTO da rescisão (o estorno reverso da provisão, gravado no lote
// `PARC-<id8>-RESCISAO`) e o STATUS. As mesmas regras do resto do módulo: motivo obrigatório,
// auditoria, e mês fechado vira contra-lançamento em vez de delete.
//
// ⚠ O QUE ISTO **NÃO** FAZ: não fala com a Receita. A rescisão do acordo perante a RFB é ato dela;
// desfazê-la aqui corrige o REGISTRO deste escritório, e a tela diz isso com todas as letras.

export async function previewDesfazerRescisao({ portalClientId, parcelamentoId, agora = new Date() }) {
  const parc = await carregarContrato(portalClientId, parcelamentoId);

  const bloqueios = [];
  if (parc.status !== "RESCINDIDO") {
    bloqueios.push({
      code: "PARCELAMENTO_NAO_RESCINDIDO",
      message: `Este parcelamento está ${parc.status} — não há rescisão a desfazer.`,
    });
  }

  // Os lançamentos da rescisão. ⚠ O lote é a chave, e ele é o MESMO nos dois caminhos de
  // `rescindirParcelamento` (com template e sem). Zero encontrados é resposta legítima e frequente:
  // uma rescisão sobre contrato sem provisão não gera lançamento nenhum — foi o caso dos dois
  // contratos rescindidos de produção. A tela mostra o número, inclusive quando ele é zero.
  const lancamentos = await prisma.accountingEntry.findMany({
    where: { portalClientId, parcelamentoId, loteImportacao: loteDaRescisao(parcelamentoId) },
    select: SELECT_LANCAMENTO,
    orderBy: { createdAt: "asc" },
  });
  const fechadas = await competenciasFechadas(portalClientId, lancamentos.map((e) => e.competencia));
  const preservados = lancamentos.filter((e) => fechadas.has(e.competencia));
  const modo = preservados.length ? MODO.CONTRA_LANCAMENTO : MODO.DELECAO;
  const competenciaHoje = competenciaDe(agora);

  const exportado = lancamentos.find((e) => e.status === "EXPORTADO");
  if (exportado) {
    bloqueios.push({
      code: "LOTE_JA_EXPORTADO",
      message: `O lançamento da rescisão "${exportado.historico}" já foi EXPORTADO — ele já saiu `
        + "daqui para a contabilidade.",
      entryId: exportado.id,
    });
  }
  if (modo === MODO.CONTRA_LANCAMENTO && await isMonthClosed(portalClientId, competenciaHoje)) {
    bloqueios.push({
      code: "MES_CORRENTE_FECHADO",
      competencia: competenciaHoje,
      message: `A rescisão está em competência fechada, então desfazê-la sai como contra-lançamento `
        + `em ${competenciaHoje} — que também está fechada. Reabra ${competenciaHoje} para desfazer.`,
    });
  }

  // O QUE VOLTA: as prestações que hoje estão fora da fila por causa da rescisão.
  const parcelas = await prisma.parcela.findMany({
    where: { portalClientId, parcelamentoId },
    select: SELECT_PARCELA_PARA_QUADRO,
  });
  // ⚠ O quadro é pedido como se o contrato JÁ estivesse ativo (`status: "ATIVO"`), de propósito: com
  // `RESCINDIDO`, `quadroDasParcelas` devolve `risco: null` ("não há mais o que prevenir"), e é
  // exatamente o risco que volta a existir que o contador precisa ver ANTES de reativar. Desfazer a
  // rescisão pode devolver um contrato que já nasce rescindível de novo.
  const quadro = quadroDasParcelas(parcelas, { status: "ATIVO", agora });
  const fimDeHoje = new Date(agora);
  fimDeHoje.setHours(23, 59, 59, 999);
  const voltamParaFila = parcelas.filter((p) => !p.guia && !p.origemBaixa
    && p.vencimento && new Date(p.vencimento).getTime() <= fimDeHoje.getTime()).length;

  const lista = lancamentos.map((e) => resumoDoLancamento(e, fechadas));
  return {
    parcelamento: {
      id: parc.id, label: parc.label, tipo: parc.tipo || parc.kind || null,
      numeroParcelamento: parc.numeroParcelamento, status: parc.status,
      numParcelas: parc.numParcelas,
    },
    modo,
    competenciaContraLancamento: modo === MODO.CONTRA_LANCAMENTO ? competenciaHoje : null,
    competenciasFechadas: [...fechadas].sort(),
    lancamentos: { total: lista.length, preservados: preservados.length, lista },
    totalDesfeito: r2(lista.reduce((s, l) => s + l.valor, 0)),
    prestacoes: {
      total: quadro.parcelasTotal,
      quitadas: quadro.parcelasPagas,
      semEvidencia: quadro.parcelasSemEvidencia,
      voltamParaFila,
    },
    // O risco que volta a ser avaliado assim que o contrato ficar ATIVO de novo.
    riscoAoReativar: quadro.risco,
    motivoObrigatorio: true,
    bloqueios,
  };
}

export async function desfazerRescisaoParcelamento({
  portalClientId, parcelamentoId, motivo, userId, agora = new Date(),
}) {
  const motivoLimpo = exigirMotivo(motivo, "Desfazer a rescisão de um parcelamento");

  const preview = await previewDesfazerRescisao({ portalClientId, parcelamentoId, agora });
  if (preview.bloqueios.length) {
    const b = preview.bloqueios[0];
    throw new AtoRecusado(b.code, b.message, { competencia: b.competencia, entryId: b.entryId });
  }

  const idsPreservados = preview.lancamentos.lista.filter((l) => l.mesFechado).map((l) => l.id);
  const idsApagados = preview.lancamentos.lista.filter((l) => !l.mesFechado).map((l) => l.id);

  return prisma.$transaction(async (tx) => {
    const atuais = await tx.accountingEntry.findMany({
      where: { portalClientId, parcelamentoId, loteImportacao: loteDaRescisao(parcelamentoId) },
      select: SELECT_LANCAMENTO,
    });
    if (atuais.length !== preview.lancamentos.total) {
      throw new AtoRecusado(
        "CONTRATO_MUDOU",
        "Os lançamentos da rescisão mudaram enquanto a operação era processada — nada foi feito.",
      );
    }

    const contraLancamentos = [];
    for (const e of atuais.filter((x) => idsPreservados.includes(x.id))) {
      // eslint-disable-next-line no-await-in-loop
      const espelho = await criarContraLancamento(tx, {
        portalClientId, entry: e, competencia: preview.competenciaContraLancamento, agora,
        rotulo: "ESTORNO RESCISAO",
      });
      contraLancamentos.push(espelho);
    }
    if (idsApagados.length) {
      await tx.accountingEntry.deleteMany({ where: { id: { in: idsApagados }, portalClientId } });
    }

    await tx.parcelamento.update({
      where: { id: parcelamentoId },
      data: { status: "ATIVO" },
    });

    // ⚠ O RECÁLCULO RODA DEPOIS DAS ESCRITAS E DENTRO DA TRANSAÇÃO — mesma disciplina do estorno: o
    // número devolvido a quem clicou (e gravado na auditoria) é o do contrato JÁ reativado. Um
    // contrato que volta a existir pode voltar direto para "rescindível", e quem desfez precisa ver
    // isso na resposta, não na próxima vez que abrir a tela.
    const recalculo = await recalcularParcelamento(tx, { portalClientId, parcelamentoId, agora });

    const ato = await tx.atoParcelamento.create({
      data: {
        portalClientId,
        parcelamentoId,
        ato: ATO.RESCISAO_DESFEITA,
        labelOriginal: preview.parcelamento.label,
        tipoOriginal: preview.parcelamento.tipo,
        numeroParcelamentoOriginal: preview.parcelamento.numeroParcelamento,
        statusOriginal: "RESCINDIDO",
        competenciaInicial: null,
        totalValueOriginal: 0,
        prestacoesRemovidas: 0,
        prestacoesQuitadas: preview.prestacoes.quitadas,
        guiasDesvinculadas: 0,
        lancamentosApagados: idsApagados.length,
        lancamentosPreservados: idsPreservados.length,
        contraLancamentosCriados: contraLancamentos.length,
        valorTotalDesfeito: preview.totalDesfeito,
        competenciasFechadas: preview.competenciasFechadas.join(",") || null,
        modo: preview.modo,
        competenciaContra: preview.competenciaContraLancamento,
        cabecalhoRemovido: false,
        motivo: motivoLimpo,
        executadoPorUserId: userId ? String(userId) : null,
        executadoEm: agora,
        riscoNivel: recalculo?.risco?.nivel || null,
        riscoEmAtraso: recalculo?.risco?.emAtraso ?? null,
        detalhe: { lancamentos: preview.lancamentos.lista },
      },
      select: { id: true },
    });

    return {
      ok: true,
      atoId: ato.id,
      modo: preview.modo,
      motivo: motivoLimpo,
      status: "ATIVO",
      lancamentosApagados: idsApagados.length,
      lancamentosPreservados: idsPreservados.length,
      contraLancamentos,
      competenciaContraLancamento: preview.competenciaContraLancamento,
      recalculo,
    };
  });
}
