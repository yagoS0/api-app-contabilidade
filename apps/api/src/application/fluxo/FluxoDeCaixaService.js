// O FLUXO DE CAIXA — a ligação com o banco.
//
// ⚠⚠ ESTE SERVIÇO É **SÓ LEITURA**. Ele não grava nada, não marca nada, não cria lançamento nenhum.
// Tudo que ele devolve é DERIVADO na leitura — nunca coluna. Uma projeção gravada envelheceria
// calada, e é o defeito que `divergenciaDeFonte.js` já documenta nesta casa.
//
// ─── OS CINCO CONTRIBUINTES, E A PROCEDÊNCIA DE CADA UM ──────────────────────────────────────
//
//   1 · Guia liberada em aberto COM vencimento .............. FATO
//   2 · Guia liberada em aberto SEM vencimento .............. DESCONHECIDO  (⚠ 51 guias de DAS)
//   3 · Nota emitida + prazo de recebimento ................. PREVISAO      (base DOCUMENTAL)
//   4 · Série de RECEITA marcada (Fase D) ................... PREVISAO
//   5 · Série de DESPESA marcada (Fase D) ................... PREVISAO
//   6 · Imposto projetado sobre (4) ......................... PREVISAO      (⚠ nunca "calculado")
//
// ⚠⚠ O RAZÃO **NÃO É FONTE DESTE FLUXO** — decisão do dono, 25/08/2026: *"esqueça o razão (…) a
// movimentação futura virá do aprendizado."* Nem para o passado, nem para o futuro.
//
// ⚠⚠ A NOTA EMITIDA É **PREVISÃO, NUNCA FATO**. Ela prova que foi FATURADO; não prova que foi
// RECEBIDO, e `PortalInvoice` **não tem `recebidoEm`**. Verde ali diria "recebido", que é o pior
// desfecho possível.
//
// ⚠ Mas é previsão DOCUMENTAL, não aprendida: a base é uma nota que existe, com número e data, mais
// um prazo que o contador configurou. Por isso ela NÃO depende da Fase D.

import { prisma } from "../../infrastructure/db/prisma.js";
import { derivarCiclo, SITUACAO } from "../notas/cicloNota.js";
import { whereFaturamentoEmit } from "../notas/apuracao/v2/FechamentoService.js";
import {
  ESTADO_DA_SERIE,
  LADO,
} from "./SerieRecorrenteService.js";
import { lerSerie, PERIODICIDADE } from "./lib/recorrencia.js";
import {
  DIA_DESCONHECIDO,
  DIRECAO,
  FONTE,
  FRASE_DO_SEM_IMPOSTO,
  FRASE_DO_SEM_MES,
  HORIZONTE_MESES,
  PROCEDENCIA,
  SEM_IMPOSTO,
  SEM_MES,
  aliquotaEfetiva,
  competenciaDaData,
  competenciaDeMeses,
  diaDaData,
  fraseDaAliquota,
  mesesDaCompetencia,
  montarLinha,
  montarMeses,
  numero,
  prazoDeRecebimento,
  projecaoSubstituidaPelaGuia,
  somarMeses,
} from "./lib/fluxoDeCaixa.js";

const texto = (v) => String(v ?? "").trim();

/** ⚠ A tabela de séries pode não existir (migration é ato do dono) — e isso NÃO derruba o fluxo. */
const tabelaAusente = (e) => e?.code === "P2021";

/** ⚠ A competência do mês corrente. É o "agora" INJETADO na regra pura, que não lê relógio. */
export function cicloDeHoje(agora = new Date()) {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ⚠⚠ AS GUIAS — e as duas metades dela têm PROCEDÊNCIAS DIFERENTES.
 *
 * A guia liberada e em aberto **com** vencimento é FATO: existe, tem valor e tem dia. A **sem**
 * vencimento é DESCONHECIDO — ela existe e o mês não se sabe. Medido em produção: **51 guias de
 * DAS** estão assim, e o backfill que as conserta é ato do dono.
 *
 * ⚠ `liberadaCliente: true` é o mesmo recorte de `GET /client/.../fluxo`, que o `PainelPage` já
 * consome — ele vira um contribuinte deste fluxo, e não uma segunda definição do mesmo conjunto.
 */
async function linhasDasGuias({ portalClientId, client }) {
  const guias = await client.guide.findMany({
    where: {
      portalClientId: String(portalClientId),
      liberadaCliente: true,
      paymentStatus: { in: ["OPEN", "OVERDUE"] },
    },
    select: {
      id: true, tipo: true, competencia: true, valor: true, vencimento: true,
      paymentStatus: true, numeroParcela: true, parcelamentoId: true,
    },
    orderBy: { vencimento: "asc" },
  });

  const linhas = [];
  const semMes = [];
  for (const g of guias) {
    const rotulo = rotuloDaGuia(g);
    const valor = numero(g.valor);
    if (!g.vencimento) {
      // ⚠⚠ NÃO VIRA ZERO E NÃO VIRA PREVISÃO. Ela sai nomeada, com o conserto.
      semMes.push({
        motivo: SEM_MES.GUIA_SEM_VENCIMENTO,
        frase: FRASE_DO_SEM_MES[SEM_MES.GUIA_SEM_VENCIMENTO],
        rotulo,
        // ⚠ O VALOR viaja aqui porque esta lista é de CONFERÊNCIA, não de soma — a tela mostra o
        // que está represado. O que não pode é ele entrar em `totais`, e não entra.
        valor,
        referencia: { tipo: "guia", id: g.id },
      });
      continue;
    }
    linhas.push(montarLinha({
      fonte: FONTE.GUIA,
      direcao: DIRECAO.SAIDA,
      procedencia: PROCEDENCIA.FATO,
      competencia: competenciaDaData(g.vencimento),
      // ⚠ A guia TEM dia — ela é a única linha deste fluxo que tem.
      dia: diaDaData(g.vencimento),
      valor,
      rotulo,
      base: { frase: `${rotulo} gerada${g.competencia ? `, competência ${g.competencia}` : ""}` },
      referencia: { tipo: "guia", id: g.id },
    }));
  }
  return { linhas, semMes };
}

function rotuloDaGuia(g) {
  const tipo = texto(g.tipo) || "OUTRA";
  // ⚠ A parcela de parcelamento NÃO é o DAS do mês — o que as separa é o `parcelamentoId`, e a
  // regra é a de `guideContract.isGuiaDeParcelamento`. Aqui só o RÓTULO muda; nenhuma leitura de
  // compliance é reimplementada.
  if (g.parcelamentoId) return `Parcela${g.numeroParcela ? ` ${g.numeroParcela}` : ""} de parcelamento`;
  return tipo;
}

/**
 * ⚠⚠ A NOTA EMITIDA + O PRAZO — a ENTRADA do fluxo, e ela não depende da Fase D.
 *
 * > Dono, 25/08/2026: *"notas emitidas em junho vão entrar de receita em julho."*
 *
 * ⚠ O ciclo da nota é respeitado por `derivarCiclo`, **nunca** por `statusEfetivo` cru: cancelada e
 * substituída não entram, e `statusEfetivo` só guarda `autorizada|cancelada` — substituição não
 * cabe nela.
 *
 * ⚠⚠ NOTA SEM COMPETÊNCIA vai para DESCONHECIDO, jamais para um mês escolhido pelo sistema.
 */
async function linhasDasNotas({ portalClientId, prazo, cicloAtual, client }) {
  const notas = await client.portalInvoice.findMany({
    where: {
      clientId: String(portalClientId),
      ...whereFaturamentoEmit(),
      total: { not: null },
      // ⚠ Só o que ainda pode virar recebimento: nota velha demais já foi recebida (ou não será), e
      // projetá-la encheria o fluxo de meses passados. O corte é o horizonte olhando para trás.
      competencia: { not: null },
    },
    select: {
      id: true, numero: true, competencia: true, total: true, tomadorNome: true,
      statusEfetivo: true, status: true, chaveSubstituida: true,
    },
    orderBy: { competencia: "asc" },
  });

  const base = mesesDaCompetencia(cicloAtual);
  const linhas = [];
  const semMes = [];
  let canceladas = 0;

  for (const n of notas) {
    // ⚠⚠ O CICLO DA NOTA, não `statusEfetivo` cru. Cancelada e substituída não viram receita.
    const ciclo = derivarCiclo({ nota: n });
    if (ciclo && ciclo.situacao !== SITUACAO.AUTORIZADA) { canceladas += 1; continue; }

    const competenciaDaNota = competenciaDaData(n.competencia);
    if (!competenciaDaNota) {
      semMes.push({
        motivo: SEM_MES.NOTA_SEM_COMPETENCIA,
        frase: FRASE_DO_SEM_MES[SEM_MES.NOTA_SEM_COMPETENCIA],
        rotulo: `Nota ${texto(n.numero) || "sem número"}`,
        valor: numero(n.total),
        referencia: { tipo: "nota", id: n.id },
      });
      continue;
    }

    const competencia = somarMeses(competenciaDaNota, prazo.meses);
    const emMeses = mesesDaCompetencia(competencia);
    // ⚠ O que caiu antes do mês corrente não entra: ou já foi recebido, ou é cobrança — e nenhuma
    // das duas é uma PREVISÃO de entrada futura. Ele é contado em `foraDoHorizonte`, no fim.
    if (base == null || emMeses == null || emMeses < base) continue;

    const quem = texto(n.tomadorNome);
    linhas.push(montarLinha({
      fonte: FONTE.NOTA_EMITIDA,
      direcao: DIRECAO.ENTRADA,
      // ⚠⚠ PREVISÃO, NUNCA FATO. A nota prova que foi FATURADO; não prova que foi RECEBIDO, e
      // `PortalInvoice` não tem `recebidoEm`. Verde aqui diria "recebido".
      procedencia: PROCEDENCIA.PREVISAO,
      competencia,
      // ⚠⚠ MÊS, NÃO DIA: o prazo é contado em meses. Inventar "dia 10" seria fabricar precisão que
      // ninguém informou.
      dia: null,
      diaDesconhecido: DIA_DESCONHECIDO.PROJECAO_POR_MES,
      valor: numero(n.total),
      rotulo: quem ? `Recebimento — ${quem}` : "Recebimento de nota emitida",
      // ⚠⚠ A BASE NOMEIA A NOTA. É previsão DOCUMENTAL: uma nota que existe, com número e data.
      base: {
        frase: `nota nº ${texto(n.numero) || "?"}, competência ${competenciaDaNota} · prazo de `
          + `${prazo.meses} ${prazo.meses === 1 ? "mês" : "meses"}`
          // ⚠⚠ "NINGUÉM CONFIGUROU" ≠ "CONFIGURADO COMO 1", e a frase diz qual dos dois é.
          + (prazo.configurado ? "" : " (padrão — ninguém configurou o prazo desta empresa)"),
        documental: true,
        prazoConfigurado: prazo.configurado,
      },
      referencia: { tipo: "nota", id: n.id },
    }));
  }

  return { linhas, semMes, canceladas };
}

/**
 * ⚠⚠ AS SÉRIES MARCADAS — e SÓ as marcadas. A observação sozinha não põe nada no fluxo.
 *
 * ⚠ A leitura vem do MESMO detector que a tela do contador usa (`lerSerie`), não de uma segunda
 * conta. E o valor é a MEDIANA com a FAIXA — medido em 27/08/2026, o CV mediano das despesas deste
 * banco é 36,1%, então a mediana sozinha erraria por um terço rotineiramente.
 */
async function linhasDasSeries({ portalClientId, cicloAtual, client }) {
  let marcadas = [];
  try {
    marcadas = await client.serieRecorrente.findMany({
      where: { portalClientId: String(portalClientId), estado: ESTADO_DA_SERIE.ATIVA },
    });
  } catch (e) {
    if (!tabelaAusente(e)) throw e;
    // ⚠ Sem a tabela, o fluxo continua respondendo com guias e notas. O que não funciona é a
    // previsão por recorrência — e isso é DITO, em `indisponivel`.
    return { linhas: [], semMes: [], indisponivel: true };
  }

  const base = mesesDaCompetencia(cicloAtual);
  const linhas = [];
  const semMes = [];

  for (const s of marcadas) {
    // ⚠ O valor projetado da série marcada: o DECLARADO quando existe (é o que a pessoa afirmou), e
    // a mediana observada quando não. ⚠⚠ Quando os DOIS existem, o OBSERVADO VENCE — decisão do
    // dono. Quem calcula a mediana é o detector; aqui só se escolhe entre os dois.
    const leitura = lerSerie({
      observacoes: [],
      periodicidade: s.periodicidade || PERIODICIDADE.MENSAL,
      cicloAtual,
      jaMarcada: true,
    });
    const declarado = numero(s.valorDeclarado);
    const observado = numero(s.baseDaObservacao?.mediana);
    const valor = observado != null ? observado : declarado;

    if (valor == null) {
      semMes.push({
        motivo: SEM_MES.SERIE_SEM_VALOR,
        frase: FRASE_DO_SEM_MES[SEM_MES.SERIE_SEM_VALOR],
        rotulo: texto(s.rotulo) || texto(s.chave),
        valor: null,
        referencia: { tipo: "serie", id: s.id },
      });
      continue;
    }

    const ehReceita = s.lado === LADO.RECEITA;
    const passo = { MENSAL: 1, TRIMESTRAL: 3, ANUAL: 12 }[s.periodicidade] || 1;
    // ⚠ A série se repete ao longo do horizonte, no ritmo dela. Uma linha só, no mês corrente,
    // faria uma recorrência mensal parecer um pagamento único.
    for (let i = 0; i < HORIZONTE_MESES; i += passo) {
      linhas.push(montarLinha({
        fonte: ehReceita ? FONTE.SERIE_RECEITA : FONTE.SERIE_DESPESA,
        direcao: ehReceita ? DIRECAO.ENTRADA : DIRECAO.SAIDA,
        procedencia: PROCEDENCIA.PREVISAO,
        competencia: competenciaDeMeses(base + i),
        dia: null,
        diaDesconhecido: DIA_DESCONHECIDO.SERIE_SEM_DIA,
        valor,
        rotulo: texto(s.rotulo) || texto(s.chave),
        // ⚠⚠ A EVIDÊNCIA CONGELADA NA DECISÃO viaja com a linha — é ela que responde "por que esta
        // linha está no fluxo?" daqui a seis meses. A faixa vai junto, sempre.
        base: {
          frase: leitura.base ? `recorrência marcada · ${s.periodicidade}` : null,
          n: numero(s.baseDaObservacao?.n),
          min: numero(s.baseDaObservacao?.min),
          max: numero(s.baseDaObservacao?.max),
          cv: numero(s.baseDaObservacao?.cv),
          origem: s.origem,
          // ⚠ Declarado E observado juntos: a tela mostra o confronto, e o observado é o que vale.
          valorDeclarado: declarado,
          valorObservado: observado,
        },
        referencia: { tipo: "serie", id: s.id },
      }));
    }
  }
  return { linhas, semMes, indisponivel: false };
}

/**
 * ⚠⚠ O IMPOSTO PROJETADO — e ele NUNCA é "imposto calculado".
 *
 * `receita projetada × alíquota efetiva do último mês APURADO`. Três travas do plano, todas aqui:
 *
 *   ⚠⚠ O RÓTULO É OBRIGATÓRIO (*"com base na alíquota de <mês>"*). Sem alíquota medida, **não há
 *      linha** — um número saído de alíquota que ninguém mediu teria cara de apuração.
 *   ⚠⚠ NÃO SE RECALCULA A FAIXA sobre receita projetada: projeção sobre projeção sobre ato fiscal é
 *      onde o número deixa de significar algo.
 *   ⚠⚠ NÃO REALIMENTA O RBT12 e NUNCA é uma guia. E a guia real SUBSTITUI esta linha no mesmo mês.
 */
function linhasDoImposto({ linhasDeReceita, aliquota, cicloAtual }) {
  if (!aliquota) {
    return { linhas: [], semImposto: { motivo: SEM_IMPOSTO.SEM_APURACAO, frase: FRASE_DO_SEM_IMPOSTO[SEM_IMPOSTO.SEM_APURACAO] } };
  }
  const porMes = new Map();
  for (const l of linhasDeReceita) {
    if (l.direcao !== DIRECAO.ENTRADA || !l.competencia) continue;
    porMes.set(l.competencia, (porMes.get(l.competencia) || 0) + (numero(l.valor) || 0));
  }
  if (porMes.size === 0) {
    return { linhas: [], semImposto: { motivo: SEM_IMPOSTO.SEM_RECEITA_PROJETADA, frase: FRASE_DO_SEM_IMPOSTO[SEM_IMPOSTO.SEM_RECEITA_PROJETADA] } };
  }

  const frase = fraseDaAliquota(aliquota);
  const linhas = [];
  for (const [competencia, receita] of porMes) {
    if (!(receita > 0)) continue;
    linhas.push(montarLinha({
      fonte: FONTE.IMPOSTO_PROJETADO,
      direcao: DIRECAO.SAIDA,
      procedencia: PROCEDENCIA.PREVISAO,
      competencia,
      dia: null,
      diaDesconhecido: DIA_DESCONHECIDO.IMPOSTO_SEGUE_A_RECEITA,
      valor: receita * aliquota.valor,
      // ⚠⚠ "Imposto PREVISTO", nunca "imposto calculado" nem "DAS".
      rotulo: "Imposto previsto sobre a receita prevista",
      base: {
        frase,
        aliquota: aliquota.valor,
        competenciaDaAliquota: aliquota.competencia,
        procedenciaDaAliquota: aliquota.procedencia,
        receitaPrevista: receita,
      },
      referencia: null,
    }));
  }
  return { linhas, semImposto: null, cicloAtual };
}

/**
 * ⚠⚠ O FLUXO INTEIRO — SÓ LEITURA, e sem a chave `total` em lugar nenhum.
 *
 * @param {string} args.cicloAtual "AAAA-MM" — ⚠ INJETADO. A regra pura não lê relógio.
 */
export async function montarFluxoDeCaixa({ portalClientId, cicloAtual, client = prisma }) {
  const ciclo = texto(cicloAtual) || cicloDeHoje();

  const empresa = await client.portalClient.findUnique({
    where: { id: String(portalClientId) },
    // ⚠⚠ A COLUNA PRECISA ESTAR NO `select` EXPLÍCITO. Fora dele ela volta `undefined` **sem erro**,
    // a rota responde 200, e a tela "só não mostra" — este projeto já foi mordido TRÊS vezes por
    // isso (`legacyCompanySelect`, carga tributária, `codigoMunicipioIbge`).
    select: { id: true, prazoRecebimentoMeses: true },
  });
  const prazo = prazoDeRecebimento(empresa?.prazoRecebimentoMeses);

  const [guias, notas, series, snapshot] = await Promise.all([
    linhasDasGuias({ portalClientId, client }),
    linhasDasNotas({ portalClientId, prazo, cicloAtual: ciclo, client }),
    linhasDasSeries({ portalClientId, cicloAtual: ciclo, client }),
    ultimaApuracao({ portalClientId, client }),
  ]);

  const aliquota = aliquotaEfetiva(snapshot);
  const receitaPrevista = [...notas.linhas, ...series.linhas].filter((l) => l.direcao === DIRECAO.ENTRADA);
  const imposto = linhasDoImposto({ linhasDeReceita: receitaPrevista, aliquota, cicloAtual: ciclo });

  /**
   * ⚠⚠ A GUIA VENCIDA NÃO SOME — achado exercitando contra o banco REAL, em 27/08/2026.
   *
   * Ela tem vencimento no PASSADO, então cai fora dos 12 meses à frente e ia embora como um número
   * em `foraDoHorizonte`. Mas ela é **dinheiro que ainda tem de sair** — é a linha mais urgente que
   * um fluxo de caixa pode ter, e some justamente de quem precisa vê-la.
   *
   * ⚠ Ela ganha compartimento PRÓPRIO em vez de ser empurrada para o mês corrente: pôr uma guia
   * vencida em julho dentro de agosto seria o sistema escolhendo o mês por ela — a mesma coisa que
   * a guia sem vencimento tem proibido. Vencida é uma condição, não um mês.
   */
  const primeiroMes = mesesDaCompetencia(ciclo);
  const vencidas = guias.linhas.filter((l) => {
    const m = mesesDaCompetencia(l.competencia);
    return m != null && primeiroMes != null && m < primeiroMes;
  });
  const guiasNoHorizonte = guias.linhas.filter((l) => !vencidas.includes(l));

  const todas = [...guiasNoHorizonte, ...notas.linhas, ...series.linhas, ...imposto.linhas];
  // ⚠⚠ A GUIA REAL SUBSTITUI A PROJEÇÃO DO MESMO MÊS — as duas nunca coexistem, senão o mesmo
  // imposto aparece duas vezes e o contador provisiona o dobro.
  const semDuplicata = projecaoSubstituidaPelaGuia(todas);
  const { meses, foraDoHorizonte } = montarMeses({ linhas: semDuplicata, cicloAtual: ciclo });

  return {
    cicloAtual: ciclo,
    horizonte: HORIZONTE_MESES,
    meses,
    // ⚠⚠ NADA SOME EM SILÊNCIO: o que não pôde ser posto em mês nenhum sai NOMEADO, com o conserto.
    semMes: [...guias.semMes, ...notas.semMes, ...series.semMes],
    /**
     * ⚠⚠ O QUE JÁ VENCEU E NÃO FOI PAGO — a linha mais urgente do fluxo.
     *
     * ⚠ Ela vem com o VALOR e a contagem, e é o único compartimento fora dos meses que carrega
     * valor — porque aqui o mês É conhecido (está no passado), diferente de `semMes`, onde ele é
     * desconhecido. Somá-la a um mês futuro seria dizer que ela vence de novo.
     */
    vencidas: {
      quantas: vencidas.length,
      valor: vencidas.reduce((s, l) => s + (numero(l.valor) || 0), 0),
      linhas: vencidas,
    },
    // ⚠ O que caiu fora dos 12 meses é CONTADO — uma guia vencida ou uma projeção distante não pode
    // evaporar.
    foraDoHorizonte: foraDoHorizonte.length,
    prazoRecebimento: prazo,
    // ⚠ A ausência do imposto projetado é NOMEADA — nunca uma linha que simplesmente não aparece.
    semImposto: imposto.semImposto,
    aliquotaUsada: aliquota ? { ...aliquota, frase: fraseDaAliquota(aliquota) } : null,
    // ⚠⚠ Sem a tabela de séries, a previsão por recorrência não existe — e isso é DITO, em vez de
    // "esta empresa não tem recorrência nenhuma".
    recorrenciaIndisponivel: series.indisponivel,
    // ⚠⚠ NÃO EXISTE `total`, e nem `saldoAcumulado`: sem saldo inicial (fora do escopo por decisão
    // do dono) não há saldo a acumular, e a soma de 12 meses é o número que alguém imprime.
    notas: {
      canceladas: notas.canceladas,
    },
  };
}

/** ⚠ O último mês APURADO com receita e DAS — é dele que a alíquota efetiva sai. */
async function ultimaApuracao({ portalClientId, client }) {
  return client.apuracaoSnapshot.findFirst({
    where: {
      portalClientId: String(portalClientId),
      // ⚠ Só o que a RFB calculou ou recebeu. O motor local é conferência NOSSA, e o plano proíbe
      // projetar sobre a nossa própria conta.
      OR: [{ dasRetornadoSerpro: { not: null } }, { dasSimuladoSerpro: { not: null } }],
    },
    select: {
      competencia: true, receitaInterna: true, receitaExterna: true,
      dasRetornadoSerpro: true, dasSimuladoSerpro: true,
    },
    orderBy: { competencia: "desc" },
  });
}
