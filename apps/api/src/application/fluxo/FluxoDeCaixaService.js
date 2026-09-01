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
//   3 · Nota emitida, no dia 1 do mês SEGUINTE .............. PREVISAO      (base DOCUMENTAL)
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
// ⚠ Mas é previsão DOCUMENTAL, não aprendida: a base é uma nota que existe, com número e data. Por
// isso ela NÃO depende da Fase D.
//
// ⚠⚠ O PRAZO CONFIGURÁVEL POR EMPRESA SAIU EM 29/08/2026 (decisão do dono): a receita cai sempre no
// DIA 1 do mês seguinte. `PortalClient.prazoRecebimentoMeses` deixou de ser lida — e com ela saiu do
// `select` a coluna que, **não aplicada em produção, derrubava este serviço inteiro com P2022** (e
// junto os cards e o pop-up do Painel do cliente). ⚠ Aplicar a migration continua sendo o certo;
// isto só deixou de ser o caminho por onde a falta dela quebrava a tela.

import { prisma } from "../../infrastructure/db/prisma.js";
import { derivarCiclo, SITUACAO } from "../notas/cicloNota.js";
import { whereFaturamentoEmit } from "../notas/apuracao/v2/FechamentoService.js";
import { derivarFolha12m } from "../notas/apuracao/v2/FolhaDerivadaService.js";
// ⚠⚠ REUSADA, nunca reescrita: quem responde *"esta conta é caixa/banco?"* decide pelo PREFIXO do
// `codigoCompleto`. O cabeçalho daquele módulo PROÍBE a versão `!== NAO_DISPONIVEL` — com ela,
// `DISPONIVEL_NAO_CLASSIFICADO` e `INDETERMINADO` entrariam como se fossem caixa.
import { entraNoFluxoDeCaixa } from "../accounting/lib/disponibilidades.js";
import {
  ESTADO_DA_SERIE,
  LADO,
  WHERE_SERIE_NO_FLUXO,
} from "./SerieRecorrenteService.js";
import { ESTADO_DA_SAIDA } from "./SaidaAvulsaService.js";
import { lerSerie, PERIODICIDADE } from "./lib/recorrencia.js";
import {
  DIA_DESCONHECIDO,
  DIRECAO,
  ORIGEM_DO_DIA,
  FONTE,
  FRASE_DO_SEM_IMPOSTO,
  FRASE_DO_SEM_MES,
  HORIZONTE_MESES,
  MESES_ATE_A_RECEITA,
  DIAS_DE_ANTECEDENCIA,
  isoDaData,
  janelaDoFluxo,
  venceEmAte,
  PROCEDENCIA,
  SEM_IMPOSTO,
  SEM_MES,
  aliquotaEfetiva,
  competenciaDaData,
  competenciaDeMeses,
  diaDaData,
  diaDoMesValido,
  encaixarNoMes,
  fraseDaAliquota,
  mesesDaCompetencia,
  montarLinha,
  montarMeses,
  numero,
  projecaoSubstituidaPelaGuia,
  receitaProjetadaPeloHistorico,
  SEM_PROJECAO,
  FRASE_DO_SEM_PROJECAO,
  somarMeses,
} from "./lib/fluxoDeCaixa.js";

const texto = (v) => String(v ?? "").trim();

/** ⚠ A tabela de séries pode não existir (migration é ato do dono) — e isso NÃO derruba o fluxo. */
const tabelaAusente = (e) => e?.code === "P2021";

/** ⚠ A competência do mês corrente. É o "agora" INJETADO na regra pura, que não lê relógio. */
/**
 * ⚠ O DIA de hoje, "AAAA-MM-DD". Mesma disciplina do `cicloDeHoje`: o relógio é lido AQUI, na borda,
 * e desce INJETADO para a regra pura — que continua sem ler relógio nenhum.
 *
 * ⚠ Acessadores UTC, como as colunas de data são escritas. A guia que vence hoje não pode virar
 * "vencida ontem" por causa de fuso.
 */
export function dataDeHoje(agora = new Date()) {
  const mes = String(agora.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(agora.getUTCDate()).padStart(2, "0");
  return `${agora.getUTCFullYear()}-${mes}-${dia}`;
}

export function cicloDeHoje(agora = new Date()) {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ⚠⚠ AS GUIAS — e a **Lei 1** reescreveu esta função inteira em 28/08/2026.
 *
 * > `CONSTITUICAO-do-produto.md`, Lei 1: *"Dinheiro só confirma com pagamento. Contabilizado,
 * > emitido, gerado, vencido: nada disso é fato de caixa. Uma guia vencida e não paga não é saída
 * > de mês nenhum — é compromisso em atraso, morando no pop-up e como saída prevista do mês
 * > corrente."*
 *
 * **O que esta função fazia até 27/08/2026, e por que mudou:**
 *
 * | | antes | agora |
 * |---|---|---|
 * | guia paga | **não existia** (`paymentStatus` filtrava `OPEN`/`OVERDUE`) | `FATO`, no mês do PAGAMENTO |
 * | guia em aberto | `FATO`, no mês do VENCIMENTO | `COMPROMISSO`, no mês CORRENTE |
 *
 * ⚠⚠ **A GUIA PAGA SUMIA DO PAYLOAD INTEIRO** — nem em `linhas`, nem em `semMes`, nem em
 * `vencidas`. Era isso que fazia um mês passado aparecer sem imposto nenhum: tudo que foi pago
 * tinha desaparecido. É o defeito que impedia a janela com passado de existir.
 *
 * ⚠⚠ **E A GUIA EM ABERTO MUDOU DE MÊS, não só de cor.** Ela morava no mês do vencimento; hoje
 * mora no mês corrente, porque é de lá que o dinheiro vai sair. É daí que sai, sozinho, o critério
 * de aceite nº 12 da Constituição: *"nenhum mês anterior ao corrente exibe célula âmbar"* — o
 * passado passa a carregar só o que foi pago.
 *
 * ⚠⚠ **`liberadaCliente` DEIXOU DE SER O RECORTE EM 30/08/2026** — decisão do dono, medida numa
 * empresa real (ERISANGELA): *"o fluxo não tem a ver com o que foi liberado; o fluxo é uma
 * PREVISÃO, o que é liberado apenas CONFIRMA a previsão."*
 *
 * O que estava acontecendo: das 17 guias da empresa, **7 estavam liberadas**. O DAS da competência
 * 07 (R$ 1.437,15) e o INSS de 08 (R$ 178,31) não estavam — e a coluna Impostos de agosto mostrava
 * **R$ 651,33 de parcelas de parcelamento**, sem o imposto do mês. O número não batia com o portal
 * do contador nem com os lançamentos, e a causa não era conta errada: era recorte.
 *
 * ⚠ Liberar continua significando alguma coisa, e é outra coisa: é o que o cliente pode BAIXAR e
 * pagar (`GET /client/.../fluxo` e o download seguem com o gate). O fluxo diz *quanto vai sair*;
 * a liberação diz *o documento está na sua mão*.
 */
async function linhasDasGuias({ portalClientId, cicloAtual, hoje, client }) {
  const guias = await client.guide.findMany({
    where: {
      portalClientId: String(portalClientId),
      // ⚠⚠ `"PAID"` ENTROU. Sem ele não existe passado: a guia paga é o único imposto que é FATO.
      paymentStatus: { in: ["OPEN", "OVERDUE", "PAID"] },
    },
    select: {
      id: true, tipo: true, competencia: true, valor: true, vencimento: true,
      paymentStatus: true, numeroParcela: true, parcelamentoId: true,
      // ⚠ QUANDO foi pago. Sem esta coluna a guia paga não tem mês, e um fato sem data não se
      // coloca em lugar nenhum — viraria um chute de mês.
      paymentConfirmedAt: true,
      // ⚠⚠ A COMPOSIÇÃO POR TRIBUTO (31/08/2026) — dono: *"as guias de presumido, no caso da
      // sincrosat, aparece como outras (…) apenas no cliente, mas no contador está PIS e COFINS
      // bem denominado."*
      //
      // A DARF do Lucro Presumido é gravada como `tipo: "OUTRA"` — UM documento com até quatro
      // tributos dentro —, e é a composição que diz quais. Ela estava fora deste `select`, então
      // `rotuloDaGuia` nunca teve o que ler e devolvia "OUTRA" cru para o painel e para o fluxo.
      // ⚠ É a armadilha de sempre desta casa: coluna fora de um `select` explícito volta
      // `undefined`, e quem a lê não erra — só não encontra nada.
      extracted: true,
    },
    orderBy: { vencimento: "asc" },
  });

  const linhas = [];
  const semMes = [];
  const emAberto = [];
  /**
   * ⚠⚠ O DIA DO ÚLTIMO IMPOSTO PAGO — é ele que vira a DATA da previsão (decisão do dono, 30/08).
   *
   * ⚠ Só guia de imposto do MÊS conta: a parcela de parcelamento tem calendário próprio (vence no
   * último dia útil), e usá-la aqui poria o DAS previsto no dia 31.
   * ⚠ `paymentConfirmedAt` é quando o dinheiro SAIU, não o vencimento.
   */
  let ultimoPagamento = null;

  for (const g of guias) {
    if (g.paymentStatus === "PAID" && g.paymentConfirmedAt && !g.parcelamentoId) {
      if (!ultimoPagamento || g.paymentConfirmedAt > ultimoPagamento) ultimoPagamento = g.paymentConfirmedAt;
    }
    const rotulo = rotuloDaGuia(g);
    const valor = numero(g.valor);

    /**
     * ⚠⚠ GUIA DE R$ 0,00 NÃO É COMPROMISSO — ela é MARCADOR (30/08/2026).
     *
     * Medido na ERISANGELA: 4 guias `SIMPLES` de R$ 0,00 (competências 01 a 04), sem vencimento.
     * Elas existem como registro de que o mês foi tratado; **não há dinheiro a sair**. Antes elas
     * nem chegavam aqui (o recorte de `liberadaCliente` as escondia); ao abrir o recorte, elas
     * passariam a desenhar quatro linhas de zero na tela do cliente.
     *
     * ⚠ Zero é uma AFIRMAÇÃO ("conferi, é zero") e aqui ele não afirma nada: é ausência de valor.
     * É a mesma distinção que `celula()` faz para não devolver `{ valor: 0 }` no lugar de `null`.
     * ⚠ Ela não some calada: sai nomeada em `semMes`, que é a lista de conferência.
     */
    if (!(valor > 0)) {
      semMes.push({
        motivo: SEM_MES.GUIA_SEM_VALOR,
        frase: FRASE_DO_SEM_MES[SEM_MES.GUIA_SEM_VALOR],
        rotulo,
        valor,
        referencia: { tipo: "guia", id: g.id },
      });
      continue;
    }

    const referencia = { tipo: "guia", id: g.id };
    const paga = g.paymentStatus === "PAID";

    if (paga) {
      const competencia = competenciaDaData(g.paymentConfirmedAt);
      if (!competencia) {
        // ⚠⚠ PAGA E SEM DATA DE PAGAMENTO. Ela **aconteceu**, então não é compromisso; mas não se
        // sabe em que mês, então não entra em mês nenhum. Escolher um (o do vencimento, o de hoje)
        // seria o sistema decidindo quando o dinheiro saiu. Sai nomeada, como a guia sem vencimento.
        semMes.push({
          motivo: SEM_MES.GUIA_PAGA_SEM_DATA,
          frase: FRASE_DO_SEM_MES[SEM_MES.GUIA_PAGA_SEM_DATA],
          rotulo, valor, referencia,
        });
        continue;
      }
      linhas.push(montarLinha({
        fonte: FONTE.GUIA,
        direcao: DIRECAO.SAIDA,
        // ⚠⚠ O ÚNICO `FATO` DESTE MÓDULO. Saiu dinheiro, e há prova.
        procedencia: PROCEDENCIA.FATO,
        competencia,
        dia: diaDaData(g.paymentConfirmedAt),
        valor,
        rotulo,
        base: { frase: `${rotulo} paga`, pagaEm: competencia },
        referencia,
      }));
      continue;
    }

    // ⚠⚠ O VENCIMENTO PODE SER DERIVADO DA COMPETÊNCIA (dia 20 da lei) — ver `vencimentoDaGuia`.
    // ⚠ Só quando NEM ISSO existe (guia sem vencimento E sem competência) ela sai nomeada: aí não
    // há âncora nenhuma, e escolher um mês seria o sistema decidindo quando o dinheiro sai.
    const { data: dataDeVencimento, presumido: vencimentoPresumido } = vencimentoDaGuia(g);
    if (!dataDeVencimento) {
      // ⚠⚠ NÃO VIRA ZERO E NÃO VIRA PREVISÃO. Ela sai nomeada, com o conserto.
      semMes.push({
        motivo: SEM_MES.GUIA_SEM_VENCIMENTO,
        frase: FRASE_DO_SEM_MES[SEM_MES.GUIA_SEM_VENCIMENTO],
        rotulo,
        // ⚠ O VALOR viaja aqui porque esta lista é de CONFERÊNCIA, não de soma — a tela mostra o
        // que está represado. O que não pode é ele entrar em `totais`, e não entra.
        valor,
        referencia,
      });
      continue;
    }

    const vence = isoDaData(dataDeVencimento);
    const atrasada = vence != null && hoje != null && vence < hoje;
    linhas.push(montarLinha({
      fonte: FONTE.GUIA,
      direcao: DIRECAO.SAIDA,
      // ⚠⚠ COMPROMISSO, não FATO: o valor e a data são conhecidos, e o dinheiro **não saiu**.
      procedencia: PROCEDENCIA.COMPROMISSO,
      // ⚠⚠ O MÊS CORRENTE, NÃO O DO VENCIMENTO — Lei 1. A guia de julho que ninguém pagou é
      // dinheiro que sai de AGOSTO, e mostrá-la em julho diria que julho já custou aquilo.
      competencia: cicloAtual,
      // ⚠ O dia do vencimento continua sendo o dia da linha quando ele cai no mês corrente. Fora
      // dele o dia não vale: ele é de outro mês, e usá-lo aqui apontaria para uma data que passou.
      dia: competenciaDaData(dataDeVencimento) === cicloAtual ? diaDaData(dataDeVencimento) : null,
      diaDesconhecido: DIA_DESCONHECIDO.COMPROMISSO_EM_ATRASO,
      valor,
      rotulo,
      base: {
        frase: `${rotulo} gerada${g.competencia ? `, competência ${g.competencia}` : ""}`
          + (vence ? ` · vence em ${vence}` : ""),
        vencimento: vence,
        atrasada,
        // ⚠⚠ A MARCA QUE SEPARA O DIA IMPRESSO NA GUIA DO DIA DERIVADO POR NÓS. Sem ela, os dois
        // ficam indistinguíveis — e a tela afirmaria uma data que o documento não traz.
        vencimentoPresumido,
        // ⚠⚠ O TIPO E A MARCA DE PARCELAMENTO VIAJAM — e é delas que `projecaoSubstituidaPelaGuia`
        // precisa para não deixar uma PARCELA apagar a projeção do DAS do mês. Ver aquela função.
        tipoDaGuia: texto(g.tipo) || "OUTRA",
        ehParcelamento: Boolean(g.parcelamentoId),
      },
      referencia,
    }));

    // ⚠ A lista que alimenta o pop-up sai DAQUI, da mesma consulta — uma segunda query com outro
    // recorte é como as duas telas passam a discordar sobre quantas guias estão em atraso.
    emAberto.push({ id: g.id, rotulo, valor, vencimento: vence, atrasada, competencia: g.competencia });
  }

  return { linhas, semMes, emAberto, diaDoUltimoPagamento: diaDaData(ultimoPagamento) };
}

/**
 * ⚠⚠ O DIA DO VENCIMENTO QUANDO A COLUNA ESTÁ VAZIA (30/08/2026).
 *
 * > Dono: *"impostos não estão com data definida; por definição devem ficar no dia do vencimento —
 * > temos esses dados, use-os."* · *"a DAS de agosto (…) deveria ter pago dia 20 de agosto, seria a
 * > DAS da competência 07."*
 *
 * Medido na ERISANGELA: **o DAS da competência 07 existe como guia, vale R$ 1.437,15, e tem
 * `vencimento` NULO**. Sem esta derivação ele cai em `semMes` e some da tabela — que é
 * exatamente o buraco de agosto.
 *
 * ⚠⚠ **ISTO NÃO É UM DIA INVENTADO, É O DIA DA LEI.** DAS do Simples: *"até o dia 20 do mês
 * subsequente ao período de apuração"* (LC 123/2006, art. 21, III). O INSS do contribuinte
 * individual segue o mesmo dia 20. E a base MEDIDA da empresa concorda: as 6 guias de INSS com
 * vencimento gravado vencem no dia 20 do mês seguinte à competência (uma no dia 19, quando o 20
 * caiu em fim de semana).
 *
 * ⚠ **A DERIVAÇÃO VIAJA MARCADA** (`base.vencimentoPresumido`), e é o que a distingue do vencimento
 * que veio do documento: sem a marca, um dia derivado por nós ficaria indistinguível de um dia
 * impresso na guia.
 * ⚠ **Sem competência não há derivação** — ela é a âncora do cálculo, e sem ela a guia continua
 * saindo nomeada em `semMes`. Ausência de dado não vira data.
 */
const DIA_DO_VENCIMENTO_LEGAL = 20;

export function vencimentoDaGuia(g) {
  if (g?.vencimento) return { data: g.vencimento, presumido: false };
  const comp = texto(g?.competencia);
  if (!/^\d{4}-\d{2}$/.test(comp)) return { data: null, presumido: false };
  const [ano, mes] = comp.split("-").map(Number);
  // ⚠ `Date.UTC` e aritmética de calendário — nada aqui depende do relógio nem do fuso da máquina.
  return { data: new Date(Date.UTC(ano, mes, DIA_DO_VENCIMENTO_LEGAL)), presumido: true };
}

/**
 * Nome curto do tributo de uma linha da composição ("IRRF - ALUG…" → "IRRF").
 *
 * ⚠ ESPELHO de `tributoCurto` (`portal-cliente-web/src/features/guias/lib/rotuloGuia.js`), que por
 * sua vez espelha o do portal do contador. A regra não é inventada aqui.
 */
function tributoCurto(c) {
  if (c?.tributo) return String(c.tributo).trim();
  const den = String(c?.denominacao || "").trim();
  if (den) return (den.split(/\s*[-–—]\s*/)[0] || den).trim();
  return String(c?.codigo || "").trim() || "?";
}

/**
 * ⚠⚠ COMO UMA GUIA SE CHAMA NO FLUXO E NO PAINEL DO CLIENTE (31/08/2026).
 *
 * > Dono: *"as guias de presumido, no caso da sincrosat, aparece como outras (…) elas aparecem
 * > outras apenas no cliente, mas no contador está PIS e COFINS bem denominado."*
 *
 * ⚠⚠ **HAVIA DOIS RÓTULOS, e só um sabia ler a composição.** A **aba Guias** do cliente usa
 * `features/guias/lib/rotuloGuia.js`, que lê `extracted.composicao` e escreve "PIS · COFINS" —
 * conserto de 24/08/2026, amarrado por teste ao rótulo do contador. Já o **painel** (`GuiasVencidas`)
 * e o **fluxo de caixa** recebem o rótulo pronto DAQUI, e esta função devolvia o `tipo` cru. Mesma
 * empresa, mesma guia, dois nomes — dependendo da tela.
 *
 * ⚠ A DARF do Lucro Presumido é UM documento com até quatro tributos dentro, gravado como
 * `tipo: "OUTRA"`. Medido em produção em 31/08/2026: **13 das 20 guias `OUTRA` têm composição**, e
 * a da SINCROSAT traz `PIS - FATURAMENTO - PJ EM GERAL` e `COFINS - FATURAMENTO/PJ EM GERAL`.
 *
 * ⚠⚠ **SEM COMPOSIÇÃO O RÓTULO CONTINUA "OUTRA", e isso é a resposta certa** — as outras 7. É o
 * que está GRAVADO; inventar "PIS · COFINS" numa guia cuja composição não foi lida afirmaria ao
 * cliente quais impostos ele está pagando, sem ninguém ter medido.
 */
function rotuloDaGuia(g) {
  const tipo = texto(g.tipo) || "OUTRA";
  // ⚠ A parcela de parcelamento NÃO é o DAS do mês — o que as separa é o `parcelamentoId`, e a
  // regra é a de `guideContract.isGuiaDeParcelamento`. Aqui só o RÓTULO muda; nenhuma leitura de
  // compliance é reimplementada.
  // ⚠⚠ E ELA DECIDE ANTES DO TIPO, como no rótulo do cliente: a parcela é gravada com o tipo do
  // imposto, então inverter a ordem a faria aparecer como o DAS do mês.
  if (g.parcelamentoId) return `Parcela${g.numeroParcela ? ` ${g.numeroParcela}` : ""} de parcelamento`;
  if (tipo.toUpperCase() === "OUTRA") {
    const comp = Array.isArray(g?.extracted?.composicao) ? g.extracted.composicao : [];
    const nomes = [...new Set(comp.map(tributoCurto).filter(Boolean))];
    if (nomes.length) return nomes.join(" · ");
  }
  return tipo;
}

/**
 * ⚠⚠ QUAIS COMPETÊNCIAS TÊM APURAÇÃO **PROVADA** — decisão do dono, 29/08/2026.
 *
 * > *"eu estou afirmando, a apuração quer dizer que o dinheiro entrou, pode colocar."*
 *
 * Eu havia registrado a ressalva de que apuração prova o FATURAMENTO e não o RECEBIMENTO; ele
 * reafirmou, e a decisão é dele. O que esta função faz é dar à promoção uma PROVA em vez de uma
 * suposição — e é aí que ela melhora o que existia.
 *
 * **O que a promoção substituiu:** até aqui a entrada virava `FATO` só por a competência da nota ser
 * ANTERIOR ao mês corrente, com `simplificacao: "recebimento_integral_presumido"` declarando que
 * aquilo era suposição. Agora ela vira `FATO` quando existe declaração daquela competência.
 *
 * ⚠⚠ **A PROVA É A DA RECEITA, NUNCA A AFIRMAÇÃO DO CONTADOR.** O vocabulário já está fixado neste
 * projeto (`FechamentoService`, `entregaPgdas.js`), e ele separa três coisas:
 *
 * | | vale? | por quê |
 * |---|---|---|
 * | `CompanyMonthlyCircular.pgdasNumeroDeclaracao` | **sim** | o número vem do índice da própria RFB (`CONSDECLARACAO13`) |
 * | `ApuracaoSnapshot.estado === "transmitida"` | **sim** | a declaração existe na Receita, transmitida daqui |
 * | `EntregaObrigacaoArquivo(PGDAS_D).transmitidaEm` | ⚠⚠ **NÃO** | é o contador dizendo que entregou. `FechamentoService` já escreve: *"promovida a comprovação, a afirmação faria o portal responder 'entregue' a partir de nada além de um clique"* |
 *
 * ⚠ Se a afirmação valesse, um clique passaria a confirmar dinheiro no caixa do cliente. É a mesma
 * razão pela qual `marcarSemFaturamento` recusa afirmação contra nota emitida.
 *
 * ⚠ Uma query por empresa, não uma por mês: são dois `findMany` para a janela inteira.
 */
async function competenciasApuradas({ portalClientId, client }) {
  const [circulares, snapshots] = await Promise.all([
    client.companyMonthlyCircular.findMany({
      where: { portalClientId: String(portalClientId), pgdasNumeroDeclaracao: { not: null } },
      select: { competencia: true },
    }).catch(() => []),
    client.apuracaoSnapshot.findMany({
      where: { portalClientId: String(portalClientId), estado: "transmitida" },
      select: { competencia: true },
    }).catch(() => []),
  ]);
  const set = new Set();
  for (const c of [...circulares, ...snapshots]) {
    const k = texto(c?.competencia);
    if (k) set.add(k);
  }
  return set;
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
async function linhasDasNotas({ portalClientId, cicloAtual, janelaInicio, client }) {
  // ⚠ A prova da apuração é lida UMA vez, para a empresa inteira — não uma consulta por nota.
  const apuradas = await competenciasApuradas({ portalClientId, client });
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

  const base = mesesDaCompetencia(janelaInicio || cicloAtual);
  const agora = mesesDaCompetencia(cicloAtual);
  const linhas = [];
  const semMes = [];
  let canceladas = 0;
  // ⚠ O faturamento MEDIDO, por competência da nota. Ele é acumulado ainda que a linha caia fora da
  // janela: a projeção olha o histórico inteiro, e cortar aqui esconderia meses que sustentam a
  // mediana.
  const medido = new Map();
  let ultimaCompetenciaComNota = null;

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

    // ⚠ Acumula ANTES do corte da janela — ver o comentário de `medido`.
    medido.set(competenciaDaNota, (medido.get(competenciaDaNota) || 0) + (numero(n.total) || 0));
    if (!ultimaCompetenciaComNota || competenciaDaNota > ultimaCompetenciaComNota) {
      ultimaCompetenciaComNota = competenciaDaNota;
    }

    const competencia = somarMeses(competenciaDaNota, MESES_ATE_A_RECEITA);
    const emMeses = mesesDaCompetencia(competencia);
    // ⚠⚠ O CORTE MUDOU DE ÂNCORA em 28/08/2026: era o mês CORRENTE, agora é o INÍCIO DA JANELA.
    // Enquanto a tabela só olhava para a frente, cortar no mês corrente era o mesmo; com 4 meses de
    // passado na tela, cortar ali esvaziaria justamente os meses que a janela existe para mostrar.
    if (base == null || emMeses == null || emMeses < base) continue;

    /**
     * ⚠⚠ FATO × PREVISÃO NA NOTA — e o critério MUDOU EM 29/08/2026, por decisão do dono.
     *
     * > *"eu estou afirmando, a apuração quer dizer que o dinheiro entrou, pode colocar."*
     *
     * | | até 28/08 (errata §7.1) | agora |
     * |---|---|---|
     * | vira `FATO` quando | a competência da nota é ANTERIOR ao mês corrente | a competência da nota tem **apuração provada** |
     * | o que sustentava | `simplificacao: "recebimento_integral_presumido"` — suposição declarada | a declaração existe na Receita |
     *
     * ⚠⚠ **ISTO É MAIS ESTRITO, E O EFEITO É VISÍVEL:** um mês passado **sem apuração** deixa de
     * ter a entrada confirmada e passa a mostrá-la como PREVISTA. É a resposta honesta — sem
     * apuração ninguém declarou aquela receita —, mas ela abre uma exceção ao critério de aceite
     * nº 12 da Constituição (*"nenhum mês anterior ao corrente exibe célula âmbar"*), que nasceu da
     * Lei 1 e falava das GUIAS. ⚠ Fica registrado aqui, não escondido.
     *
     * ⚠ Eu havia marcado a ressalva de que apuração prova o FATURAMENTO e não o RECEBIMENTO. O dono
     * reafirmou; a decisão é dele, e o que ela ganha é uma PROVA no lugar de uma suposição.
     *
     * ⚠ `PortalInvoice` continua **sem `recebidoEm`** — não existe registro de recebimento neste
     * banco. Por isso `base.simplificacao` continua viajando quando a promoção acontece: ela diz que
     * o que foi provado é a APURAÇÃO, não o crédito em conta.
     */
    const temApuracao = apuradas.has(competenciaDaNota);
    const procedenciaDaNota = temApuracao ? PROCEDENCIA.FATO : PROCEDENCIA.PREVISAO;

    const quem = texto(n.tomadorNome);
    linhas.push(montarLinha({
      fonte: FONTE.NOTA_EMITIDA,
      direcao: DIRECAO.ENTRADA,
      procedencia: procedenciaDaNota,
      competencia,
      /**
       * ⚠⚠ DIA 1 — decisão do dono, 29/08/2026, e ela REVERTE uma regra travada por teste.
       *
       * > *"as notas emitidas do mês anterior se tornam a receita do mês seguinte (…) por isso
       * > entram no dia 1."*
       *
       * Até aqui esta linha era `dia: null` + `PROJECAO_POR_MES`, sob a regra *"dia ausente nunca
       * vira dia inventado"*. ⚠ **A regra continua valendo para todas as outras fontes sem dia**
       * (recorrência, imposto previsto, folha): elas seguem em "no mês". O que mudou aqui é que o
       * dia 1 deixou de ser invenção do sistema e passou a ser CONVENÇÃO do dono — ele escolheu o
       * dia, e a tela mostra o que ele escolheu.
       */
      dia: 1,
      diaDesconhecido: null,
      valor: numero(n.total),
      rotulo: quem ? `Recebimento — ${quem}` : "Recebimento de nota emitida",
      // ⚠⚠ A BASE NOMEIA A NOTA. É previsão DOCUMENTAL: uma nota que existe, com número e data.
      base: {
        frase: `nota nº ${texto(n.numero) || "?"}, emitida em ${competenciaDaNota}`,
        documental: true,
        // ⚠⚠ O QUE FOI PROVADO É A APURAÇÃO, NÃO O CRÉDITO EM CONTA. A marca continua viajando para
        // que a promoção não se apresente como recebimento MEDIDO: `PortalInvoice` não tem
        // `recebidoEm`, e não há registro de recebimento em lugar nenhum deste banco.
        simplificacao: temApuracao ? "recebimento_presumido_pela_apuracao" : null,
        // ⚠ A PROVA viaja NOMEADA: é ela que responde "por que esta entrada está confirmada?".
        apuracaoProvada: temApuracao,
      },
      referencia: { tipo: "nota", id: n.id },
    }));
  }

  /**
   * ⚠⚠ O FATURAMENTO MEDIDO, POR COMPETÊNCIA DA NOTA — é a base da projeção (30/08/2026).
   *
   * ⚠ A chave é a competência da NOTA, não a do recebimento: o que se repete é o FATURAMENTO. A
   * conversão para o mês em que o dinheiro entra é feita depois, uma vez, por quem projeta.
   * ⚠ Ele sai da MESMA varredura que monta as linhas — uma segunda consulta de faturamento é como
   * as duas leituras começam a discordar sobre a mesma empresa.
   */
  const faturamentoPorMes = new Map();
  for (const [comp, v] of medido) faturamentoPorMes.set(comp, v);

  return { linhas, semMes, canceladas, faturamentoPorMes, ultimaCompetenciaComNota };
}

/**
 * ⚠⚠ AS SÉRIES MARCADAS — e SÓ as marcadas. A observação sozinha não põe nada no fluxo.
 *
 * ⚠ A leitura vem do MESMO detector que a tela do contador usa (`lerSerie`), não de uma segunda
 * conta. E o valor é a MEDIANA com a FAIXA — medido em 27/08/2026, o CV mediano das despesas deste
 * banco é 36,1%, então a mediana sozinha erraria por um terço rotineiramente.
 */
async function linhasDasSeries({ portalClientId, cicloAtual, mesesAProjetar = HORIZONTE_MESES, client }) {
  let marcadas = [];
  try {
    marcadas = await client.serieRecorrente.findMany({
      // ⚠⚠ O CRITÉRIO NÃO É REESCRITO AQUI — ele vem de `WHERE_SERIE_NO_FLUXO`, ao lado da função
      // `serieEntraNoFluxo` que a conferência usa. Duas escritas do mesmo critério fariam o fluxo
      // trazer uma linha que a outra diz que não entra, e a divergência apareceria como linha
      // fantasma na tela do cliente.
      where: { portalClientId: String(portalClientId), ...WHERE_SERIE_NO_FLUXO },
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
    /**
     * ⚠⚠ O DIA DA RECORRÊNCIA — e a ORDEM É A REGRA (31/08/2026).
     *
     * > Dono: *"eu quero que entre em algum dia, pode ser no dia em que a nota foi emitida (…)
     * > pode ser modificado posteriormente"* e *"ou alterado a data"*.
     *
     * ⚠⚠ **O CLIENTE VENCE A ESTIMATIVA, SEMPRE.** Quem paga sabe quando paga; a mediana das
     * emissões é palpite sobre o passado. Se a estimativa vencesse, a próxima varredura desfaria a
     * correção dele em silêncio — e ele corrigiria de novo, para sempre.
     * ⚠ Sem nenhum dos dois a linha continua em "no mês", com o motivo de sempre. Ausência de dia
     * NÃO vira dia 1: inventar precisão é o que este payload existe para não fazer.
     */
    const diaDoCliente = diaDoMesValido(s.diaDoMes);
    const diaEstimado = diaDoMesValido(s.baseDaObservacao?.dia);
    const diaDaSerie = diaDoCliente != null ? diaDoCliente : diaEstimado;
    const origemDoDia = diaDoCliente != null
      ? ORIGEM_DO_DIA.CLIENTE
      : (diaEstimado != null ? ORIGEM_DO_DIA.EMISSAO : null);
    const passo = { MENSAL: 1, TRIMESTRAL: 3, ANUAL: 12 }[s.periodicidade] || 1;
    // ⚠ A série se repete ao longo do horizonte, no ritmo dela. Uma linha só, no mês corrente,
    // faria uma recorrência mensal parecer um pagamento único.
    // ⚠⚠ ELE PROJETA ATÉ O FIM DA JANELA, NÃO 12 MESES CEGOS (28/08/2026). Enquanto a janela
    // começava no mês corrente as duas coisas eram a mesma; com 4 meses de passado na tela, projetar
    // 12 à frente joga os 4 últimos para FORA da janela — e eles iam engordar `foraDoHorizonte`,
    // que existe para contar o que se perdeu, não o que nunca foi pedido.
    for (let i = 0; i < mesesAProjetar; i += passo) {
      const competenciaDaVez = competenciaDeMeses(base + i);
      // ⚠⚠ O dia é ENCAIXADO no mês, e isso não é detalhe: dia 31 numa série mensal cairia fora de
      // fevereiro, abril, junho, setembro e novembro. Sem o encaixe, a linha SUMIRIA nesses meses —
      // dinheiro desaparecendo da projeção cinco vezes por ano, sem erro nenhum na tela.
      const diaDaLinha = diaDaSerie == null ? null : encaixarNoMes(competenciaDaVez, diaDaSerie);
      linhas.push(montarLinha({
        fonte: ehReceita ? FONTE.SERIE_RECEITA : FONTE.SERIE_DESPESA,
        direcao: ehReceita ? DIRECAO.ENTRADA : DIRECAO.SAIDA,
        procedencia: PROCEDENCIA.PREVISAO,
        competencia: competenciaDaVez,
        dia: diaDaLinha,
        // ⚠ Com dia, o motivo SOME — deixá-lo preenchido faria a tela dizer "não sabemos o dia"
        // embaixo de um dia. Sem dia, ele continua sendo o de sempre.
        diaDesconhecido: diaDaLinha == null ? DIA_DESCONHECIDO.SERIE_SEM_DIA : null,
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
          // ⚠⚠ DE ONDE VEIO O DIA — é o que permite às duas telas distinguirem "estimado pelas
          // emissões" de "informado pelo cliente". Ver `ORIGEM_DO_DIA`.
          origemDoDia,
          // ⚠ Os dias observados viajam como `valores` viaja: sem eles, "por que dia 4?" não tem
          // resposta. Na SPO são 20, 2 e 4 — a mediana não é óbvia olhando só o resultado.
          diasObservados: Array.isArray(s.baseDaObservacao?.dias) ? s.baseDaObservacao.dias : null,
          // ⚠⚠ O ESTADO DA SÉRIE VIAJA — achado NO NAVEGADOR em 29/08/2026, no mock: sem ele a tela
          // do cliente mostrava botão "Remover" em recorrência que o contador JÁ tinha confirmado,
          // e o servidor recusaria com `serie_ja_decidida`. Um botão que sempre falha é pior que a
          // ausência dele. ⚠ É o par do `estadoDaSaida` da avulsa, e as duas usam "PENDENTE" com o
          // mesmo significado: esperando a palavra do contador.
          estadoDaSerie: s.estado || null,
          // ⚠ A PERIODICIDADE viaja porque a tela do cliente precisa DIZER "todo mês" para a
          // recorrência que ele mesmo declarou. Sem ela, a única coisa que a tela sabe é quantas
          // vezes a linha aparece na janela — e "aparece 8× nos próximos meses" descreve a TABELA,
          // não o compromisso. São coisas diferentes para quem se planeja.
          periodicidade: s.periodicidade || null,
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
 * ⚠⚠ AS SAÍDAS QUE O PRÓPRIO CLIENTE ACRESCENTOU — decisão do dono, 29/08/2026.
 *
 * > *"o cliente pode modificar as saídas, podendo colocar novas saídas, apenas para visualização
 * > deles (…) e essas saídas que o cliente digitar aparece para o contador na aba de conferência."*
 *
 * ⚠⚠ **SÓ AS `CONFIRMADA` ENTRAM NO FLUXO.** É a mesma trava da série marcada: uma afirmação não
 * vira linha de caixa sozinha — o contador confirma primeiro. A `PENDENTE` existe, aparece na fila
 * dele, e **não** soma em lugar nenhum.
 *
 * ⚠ ESTA É A AVULSA, a que tem DATA. O que o cliente diz se REPETIR vira `SerieRecorrente` com
 * `origem: DECLARADA` e sai por `linhasDasSeries` — lá a evidência da recorrência é renderizada.
 *
 * ⚠⚠ E ELA TEM DIA DE VERDADE. Diferente de toda outra previsão deste fluxo, aqui o dia foi
 * ESCRITO por uma pessoa — não é o sistema fabricando precisão, é o cliente dizendo quando pretende
 * pagar. Por isso `diaDesconhecido` fica nulo.
 */
async function linhasDasSaidasDoCliente({ portalClientId, cicloAtual, janelaInicio, client }) {
  let saidas = [];
  try {
    /**
     * ⚠⚠ A GUARDA COBRE DUAS AUSÊNCIAS DIFERENTES, e a segunda é a que morde primeiro.
     *
     *   · a TABELA não existe (P2021) — a migration é ato do dono, como em `series_recorrentes`;
     *   · o DELEGATE não existe (`client.saidaAvulsaCliente` é `undefined`) — o `prisma generate`
     *     não rodou depois do schema mudar. No Windows ele falha com EPERM quando o servidor de dev
     *     está de pé, então este estado é REAL, não hipotético.
     *
     * ⚠ Sem a segunda, o `undefined.findMany` seria um TypeError e derrubaria **o fluxo inteiro** —
     * cards e pop-up do Painel do cliente junto. É exatamente o estrago que a coluna do prazo fora
     * do `select` causava, por outro caminho.
     */
    if (!client?.saidaAvulsaCliente?.findMany) return { linhas: [], indisponivel: true };
    /**
     * ⚠⚠ **PENDENTE ENTRA NO FLUXO, e isto CORRIGE a primeira versão desta função (29/08/2026).**
     *
     * Ela lia só `CONFIRMADA` — ou seja, o cliente digitava uma saída e **não via nada** até o
     * contador conferir. Isso contradiz o pedido em uma palavra: *"o cliente pode modificar as
     * saídas, podendo colocar novas saídas, **apenas para visualização deles**"*. Uma linha que
     * o autor dela não enxerga não é visualização nenhuma.
     *
     * ⚠ **A CONFERÊNCIA NÃO PERDEU A FUNÇÃO** — ela nunca foi o portão da visualização. Ela é como
     * o CONTADOR fica sabendo o que o cliente escreveu, e (Fase 6) como isso vira lançamento. O que
     * ela decide é o destino CONTÁBIL da linha, não a existência dela no fluxo do cliente.
     *
     * ⚠⚠ **RECUSADA NÃO ENTRA**, e é o que dá sentido à recusa: o contador dizer "isto não é
     * despesa desta empresa" tem de tirar a linha da tela, senão a decisão dele não faz nada.
     * ⚠ O estado viaja em `base.estadoDaSaida` — a tela precisa distinguir *"aguardando o seu
     * contador"* de *"conferida"*, e as duas são previsão do mesmo jeito.
     */
    saidas = await client.saidaAvulsaCliente.findMany({
      where: {
        portalClientId: String(portalClientId),
        /**
         * ⚠⚠ `LANCADA` FICA DE FORA — e o aviso que pedia isto foi escrito no MESMO dia, algumas
         * horas antes (01/09/2026).
         *
         * Quando a saída lançada entrou nesta lista, `linhasDasDespesasLancadas` não existia e
         * despesa não alimentava o fluxo: tirá-la daqui a faria SUMIR da tela do cliente. Agora o
         * lançamento dela é uma linha do fluxo por direito próprio (FONTE.DESPESA_LANCADA, com a
         * partida dobrada como prova), e manter as duas contaria **o mesmo dinheiro duas vezes**.
         *
         * ⚠ A linha não some da tela: ela troca de fonte — deixa de ser *"Você acrescentou"*
         * (PREVISÃO) e passa a ser *"Despesa lançada"* (FATO), que é exatamente o que aconteceu
         * com ela.
         */
        estado: { in: [ESTADO_DA_SAIDA.PENDENTE, ESTADO_DA_SAIDA.CONFIRMADA] },
      },
      select: { id: true, data: true, valor: true, descricao: true, estado: true },
      orderBy: { data: "asc" },
    });
  } catch (e) {
    if (!tabelaAusente(e)) throw e;
    return { linhas: [], indisponivel: true };
  }

  const base = mesesDaCompetencia(janelaInicio || cicloAtual);
  const linhas = [];
  for (const s of saidas) {
    const competencia = competenciaDaData(s.data);
    const emMeses = mesesDaCompetencia(competencia);
    // ⚠ Fora da janela para trás é descartado aqui — `montarMeses` já conta o que cai fora para a
    // frente. Uma saída planejada há um ano não é notícia.
    if (base == null || emMeses == null || emMeses < base) continue;

    linhas.push(montarLinha({
      fonte: FONTE.SAIDA_DO_CLIENTE,
      direcao: DIRECAO.SAIDA,
      // ⚠⚠ SEMPRE PREVISÃO. O cliente planejou; ninguém pagou. Chamá-la de fato faria o dono da
      // empresa somá-la ao que já aconteceu.
      procedencia: PROCEDENCIA.PREVISAO,
      competencia,
      // ⚠ O dia é o que a PESSOA escreveu — não é precisão fabricada.
      dia: diaDaData(s.data),
      valor: numero(s.valor),
      rotulo: texto(s.descricao) || "Saída planejada",
      // ⚠ A base diz DE QUEM é a linha. Sem isso, ela se confundiria com o que o sistema previu, e
      // o cliente não saberia qual das duas ele mesmo escreveu.
      // ⚠⚠ E diz o ESTADO: pendente e conferida são a mesma previsão para a soma, mas não para quem
      // lê — uma ainda pode ser recusada pelo contador, a outra não. A tela só pode dizer isso se o
      // estado chegar até ela; e é ele que decide se o botão de remover aparece (o servidor recusa
      // apagar depois da decisão, e um botão que sempre falha é pior que a ausência dele).
      base: {
        frase: texto(s.estado) === ESTADO_DA_SAIDA.PENDENTE
          ? "você acrescentou esta saída — ela ainda não foi conferida pelo seu contador"
          : "você acrescentou esta saída",
        doCliente: true,
        estadoDaSaida: texto(s.estado) || ESTADO_DA_SAIDA.PENDENTE,
      },
      referencia: { tipo: "saidaAvulsa", id: s.id },
    }));
  }
  return { linhas, indisponivel: false };
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
function linhasDoImposto({ linhasDeReceita, aliquota, cicloAtual, diaDoUltimoPagamento = null }) {
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
      /**
       * ⚠⚠ O DIA VEM DO ÚLTIMO PAGAMENTO DAQUELE IMPOSTO (30/08/2026) — decisão do dono:
       * *"eu disse expressamente que as datas deveriam ser iguais às do último pagamento"* ·
       * *"se o último pagamento foi feito dia 16, eu provisiono para dia 16"*.
       *
       * ⚠ Até aqui esta linha era `dia: null` + `IMPOSTO_SEGUE_A_RECEITA`, e o dono viu o efeito na
       * tela: *"valores de previsibilidade de impostos estão em data nenhuma"*.
       * ⚠⚠ **NÃO É UM DIA INVENTADO: É O COMPORTAMENTO MEDIDO DA PRÓPRIA EMPRESA.** Sem nenhum
       * pagamento no histórico não há o que observar, e aí a linha CONTINUA sem dia, com o motivo —
       * ausência de dado nunca vira data.
       */
      dia: diaDoUltimoPagamento,
      diaDesconhecido: diaDoUltimoPagamento ? null : DIA_DESCONHECIDO.IMPOSTO_SEGUE_A_RECEITA,
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
export async function montarFluxoDeCaixa({ portalClientId, cicloAtual, janelaInicio = null, hoje = null, client = prisma }) {
  const ciclo = texto(cicloAtual) || cicloDeHoje();
  const dia = texto(hoje) || dataDeHoje();

  const [empresa, primeiraNota] = await Promise.all([
    client.portalClient.findUnique({
      where: { id: String(portalClientId) },
      // ⚠⚠ A COLUNA PRECISA ESTAR NO `select` EXPLÍCITO. Fora dele ela volta `undefined` **sem erro**,
      // a rota responde 200, e a tela "só não mostra" — este projeto já foi mordido TRÊS vezes por
      // isso (`legacyCompanySelect`, carga tributária, `codigoMunicipioIbge`).
      select: { id: true },
    }),
    // ⚠⚠ O LIMITE DA NAVEGAÇÃO PARA TRÁS (v3 §3.1) — a nota mais antiga da empresa.
    // ⚠ Não é "12 meses atrás": empresa aberta em março não tem janeiro, e oferecer janeiro faria
    // a tela afirmar que ela faturou zero num mês em que ela não existia.
    client.portalInvoice.findFirst({
      where: { clientId: String(portalClientId), ...whereFaturamentoEmit(), competencia: { not: null } },
      select: { competencia: true },
      orderBy: { competencia: "asc" },
    }),
  ]);

  const janela = janelaDoFluxo({
    cicloAtual: ciclo,
    janelaInicio: texto(janelaInicio) || null,
    companyStart: competenciaDaData(primeiraNota?.competencia),
  });
  const inicio = janela?.inicio || ciclo;
  // ⚠ Quantos meses da janela ainda estão à frente — é até onde a projeção recorrente vai.
  const mesesFuturosDaJanela = Math.max(
    0,
    (janela?.horizonte ?? HORIZONTE_MESES) - ((mesesDaCompetencia(ciclo) ?? 0) - (mesesDaCompetencia(inicio) ?? 0)),
  );

  const [guias, notas, series, snapshot, folha, saidasDoCliente, despesas] = await Promise.all([
    linhasDasGuias({ portalClientId, cicloAtual: ciclo, hoje: dia, client }),
    linhasDasNotas({ portalClientId, cicloAtual: ciclo, janelaInicio: inicio, client }),
    linhasDasSeries({ portalClientId, cicloAtual: ciclo, mesesAProjetar: mesesFuturosDaJanela, client }),
    ultimaApuracao({ portalClientId, client }),
    // ⚠⚠ A FOLHA PASSOU A SAIR DO PAGAMENTO (a saída de caixa), não da provisão bruta — ver o
    // cabeçalho de `linhasDaFolhaPelaSaidaDeCaixa`. `linhasDaFolha` (a leitura por provisão) fica
    // no arquivo, SEM CHAMADOR e com lápide: ela é a leitura que o Fator R usa, e apagá-la aqui
    // convidaria alguém a "consertar" a conferência do Fator R junto.
    linhasDaFolhaPelaSaidaDeCaixa({ portalClientId, cicloAtual: ciclo, janelaInicio: inicio, client }),
    linhasDasSaidasDoCliente({ portalClientId, cicloAtual: ciclo, janelaInicio: inicio, client }),
    // ⚠⚠ A DESPESA LANÇADA — o que faz valer a regra do dono (*"ao lançar entra no fluxo"*). Até
    // 01/09/2026 ela não estava aqui, e o trabalho principal da Conferência não chegava ao cliente.
    linhasDasDespesasLancadas({ portalClientId, cicloAtual: ciclo, janelaInicio: inicio, client }),
  ]);

  const aliquota = aliquotaEfetiva(snapshot);

  /**
   * ⚠⚠ A RECEITA PROJETADA PELO HISTÓRICO (30/08/2026) — decisão do dono:
   *
   * > *"o último mês é base para todos os meses à frente, e depois vão se ajustando (…) se em 3
   * > meses seguidos aparece a mesma receita, pode colocar ela para frente até o final da amostra,
   * > e ir ajustando se aparecer faturamento diferente. **Sempre a mediana.**"*
   *
   * ⚠⚠ **ELA COMEÇA DEPOIS DO ÚLTIMO MÊS QUE JÁ TEM RECEITA REAL**, e é isso que faz o *"ir
   * ajustando"* acontecer sozinho: chegando nota nova, aquele mês deixa de ser projetado na leitura
   * seguinte, sem ninguém apagar nada. A projeção nunca sobrescreve o que existe.
   *
   * ⚠ A conversão de competência da NOTA para o mês do RECEBIMENTO é feita aqui, uma vez
   * (`MESES_ATE_A_RECEITA`) — a regra pura fala de meses de FATURAMENTO, e misturar as duas
   * unidades dentro dela faria o "+1" ser aplicado duas vezes em alguma correção futura.
   */
  const ultimoMesComReceita = notas.ultimaCompetenciaComNota
    ? somarMeses(notas.ultimaCompetenciaComNota, MESES_ATE_A_RECEITA)
    : null;
  const primeiroProjetado = ultimoMesComReceita ? somarMeses(ultimoMesComReceita, 1) : null;
  const quantosProjetar = primeiroProjetado
    ? Math.max(0, (mesesDaCompetencia(inicio) ?? 0) + (janela?.horizonte ?? HORIZONTE_MESES)
      - (mesesDaCompetencia(primeiroProjetado) ?? 0))
    : 0;
  const receitaProjetada = primeiroProjetado
    ? receitaProjetadaPeloHistorico({
      faturamentoPorMes: notas.faturamentoPorMes,
      primeiroMesAProjetar: primeiroProjetado,
      quantosMeses: quantosProjetar,
    })
    : { linhas: [], base: null, motivo: SEM_PROJECAO.SEM_FATURAMENTO };

  const receitaPrevista = [...notas.linhas, ...receitaProjetada.linhas, ...series.linhas]
    .filter((l) => l.direcao === DIRECAO.ENTRADA);
  /**
   * ⚠⚠ O DIA EM QUE ESTA EMPRESA COSTUMA PAGAR O IMPOSTO — medido, não arbitrado.
   *
   * > Dono: *"as datas deveriam ser iguais às do último pagamento"* · *"se o último pagamento foi
   * > feito dia 16, eu provisiono para dia 16."*
   *
   * ⚠ Ele sai da consulta que `linhasDasGuias` JÁ FEZ — uma segunda ida ao banco para perguntar
   * sobre as mesmas guias é como duas leituras da mesma coisa começam a divergir, e custa uma query
   * por abertura de tela.
   */
  const diaDoUltimoPagamento = guias.diaDoUltimoPagamento ?? null;
  const imposto = linhasDoImposto({
    linhasDeReceita: receitaPrevista,
    aliquota,
    cicloAtual: ciclo,
    diaDoUltimoPagamento,
  });

  /**
   * ⚠⚠ O QUE JÁ VENCEU, E AGORA A CONTA É POR **DIA** — não mais por mês.
   *
   * Até 27/08/2026 "vencida" era `competencia < mês corrente`, e o `CLAUDE.md` registrava a
   * consequência: *"guia que vence dia 20 do mês corrente e hoje é dia 25 fica no mês corrente"* —
   * ou seja, **não contava como vencida**. Era a divergência conhecida contra o card "A vencer",
   * que sempre comparou com HOJE.
   *
   * ⚠⚠ O pop-up (v3 §1) obriga a fechar essa distância: ele precisa distinguir *vencida* de *vence
   * em até 5 dias*, e nenhuma das duas cabe em granularidade de mês. Agora as duas telas comparam
   * com o MESMO dia, injetado.
   *
   * ⚠ As duas listas saem da MESMA consulta de guias. Uma segunda query com outro recorte é
   * exatamente como o card e a ressalva passaram a discordar sobre a mesma empresa.
   */
  const vencidas = guias.emAberto.filter((g) => g.atrasada);
  const aVencer = guias.emAberto.filter((g) => !g.atrasada && venceEmAte(g.vencimento, dia, DIAS_DE_ANTECEDENCIA));

  const todas = [
    ...guias.linhas, ...notas.linhas, ...series.linhas, ...imposto.linhas, ...folha.linhas,
    // ⚠ Mesma forma de linha, mesmo balde de saída — o que a distingue é a FONTE e a PROCEDÊNCIA
    // (FATO: a partida dobrada prova que o dinheiro saiu).
    ...despesas.linhas,
    // ⚠ O que o CLIENTE acrescentou entra por último, mas sem privilégio nenhum: mesma forma de
    // linha, mesmo balde de saída, mesma procedência PREVISAO.
    ...saidasDoCliente.linhas,
    // ⚠ A receita projetada entra no MESMO conjunto: mesma direção, mesmo balde, mesma procedência
    // PREVISAO. Ela não é um bloco à parte da tabela.
    ...receitaProjetada.linhas,
  ];
  // ⚠⚠ A GUIA REAL SUBSTITUI A PROJEÇÃO DO MESMO MÊS — as duas nunca coexistem, senão o mesmo
  // imposto aparece duas vezes e o contador provisiona o dobro.
  const semDuplicata = projecaoSubstituidaPelaGuia(todas);
  const { meses, foraDoHorizonte } = montarMeses({ linhas: semDuplicata, cicloAtual: ciclo, janelaInicio: inicio });

  return {
    /**
     * ⚠⚠ ESTE CAMPO É O QUE APAGA O SELO DE DEMONSTRAÇÃO NO PORTAL DO CLIENTE, e ele precisa ser
     * uma AFIRMAÇÃO do servidor.
     *
     * O bloco do Painel lê `demonstracao !== false` (`features/painel/BlocoDeDemonstracao.jsx`):
     * ausente NÃO é `false`. A escolha é deliberada — com `=== true`, uma resposta que simplesmente
     * não trouxesse o campo (coluna fora de um `select`, backend novo que esqueceu) apresentaria
     * ficção como fato, em silêncio. Com `!== false`, o modo de falhar é "selo a mais".
     *
     * ⚠ Logo: quem diz que estes números são reais é ESTA LINHA, no servidor. O front não pode
     * fabricá-la — fabricada, ela seria a tela afirmando sobre si mesma.
     */
    demonstracao: false,
    cicloAtual: ciclo,
    horizonte: HORIZONTE_MESES,
    meses,
    // ⚠⚠ NADA SOME EM SILÊNCIO: o que não pôde ser posto em mês nenhum sai NOMEADO, com o conserto.
    semMes: [...guias.semMes, ...notas.semMes, ...series.semMes],
    /**
     * ⚠⚠ O QUE JÁ VENCEU E NÃO FOI PAGO.
     *
     * ⚠ Ela continua tendo compartimento próprio **e** continua aparecendo nos meses — mas o
     * significado dos dois mudou com a Lei 1: nos meses ela é `COMPROMISSO` do mês CORRENTE (é de
     * lá que o dinheiro sai), e aqui ela é a lista de conferência que o pop-up consome.
     * ⚠⚠ Elas NÃO se somam: quem somar `vencidas.valor` com a saída do mês corrente conta a mesma
     * guia duas vezes. É por isso que este compartimento diz `quantas` e `valor` e **não** entra em
     * `totais` — que é a mesma regra que ele sempre teve.
     */
    vencidas: {
      quantas: vencidas.length,
      valor: vencidas.reduce((s, g) => s + (numero(g.valor) || 0), 0),
      linhas: vencidas,
    },
    /**
     * ⚠⚠ O QUE ALIMENTA O POP-UP (v3 §1) — vencidas **e** as que vencem em até 5 dias.
     *
     * ⚠ `ackPending` não é decidido aqui: quem sabe se alguém já deu ciência é a tabela
     * `CienciaDeGuias`, e ela é consultada na rota. Deste módulo sai o FATO (quais guias estão
     * pegando fogo); o "já avisamos?" é outra pergunta, com outro dono.
     */
    alertaDeGuias: {
      diasDeAntecedencia: DIAS_DE_ANTECEDENCIA,
      itens: [
        ...vencidas.map((g) => ({ ...g, estado: "overdue" })),
        ...aVencer.map((g) => ({ ...g, estado: "due_soon" })),
      ],
      // ⚠⚠ CHAMA-SE `valor`, E NÃO `total` — e não é preciosismo. Há uma varredura no payload
      // inteiro proibindo a chave `"total"` (`docs/dre-fluxo-caixa.md`), porque no dia em que ela
      // existir alguma tela a imprime como se fosse o total do fluxo. Aqui a soma é legítima (são
      // todos compromissos vencidos, da mesma natureza), mas o NOME não pode ser o proibido.
      // ⚠ `vencidas.valor` já usava esta palavra: o vocabulário é o da casa.
      valor: [...vencidas, ...aVencer].reduce((s, g) => s + (numero(g.valor) || 0), 0),
    },
    /**
     * ⚠ ONDE A TABELA COMEÇA, e até onde as setas andam — para a tela DESABILITAR a seta em vez de
     * a deixar não responder. Botão que não responde se lê como defeito.
     */
    janela,
    /**
     * ⚠⚠ A COLUNA FOLHA SÓ EXISTE SE HOUVER FOLHA (v3 §3.2) — e quem decide é o servidor, não a tela.
     *
     * ⚠ `disponivel: false` e `contasConsideradas: []` dizem coisas DIFERENTES: a primeira é "esta
     * empresa não tem folha lançada" (estado normal de quem não tem empregado), a segunda é "o
     * plano de contas desta empresa não casa com nenhuma conta de folha" — defeito de cadastro.
     * Colapsá-las faria a segunda passar por normal.
     */
    folha: { disponivel: folha.disponivel, contasConsideradas: folha.contasConsideradas },
    // ⚠ O que caiu fora dos 12 meses é CONTADO — uma guia vencida ou uma projeção distante não pode
    // evaporar.
    foraDoHorizonte: foraDoHorizonte.length,
    // ⚠ A ausência do imposto projetado é NOMEADA — nunca uma linha que simplesmente não aparece.
    semImposto: imposto.semImposto,
    aliquotaUsada: aliquota ? { ...aliquota, frase: fraseDaAliquota(aliquota) } : null,
    // ⚠⚠ Sem a tabela de séries, a previsão por recorrência não existe — e isso é DITO, em vez de
    // "esta empresa não tem recorrência nenhuma".
    recorrenciaIndisponivel: series.indisponivel,
    // ⚠⚠ Mesma disciplina, para a outra tabela: "não pudemos ler as suas saídas" ≠ "você não
    // acrescentou nenhuma". Sem este campo, a migration não aplicada faria a tela afirmar a segunda.
    saidasDoClienteIndisponiveis: saidasDoCliente.indisponivel,
    // ⚠⚠ NÃO EXISTE `total`, e nem `saldoAcumulado`: sem saldo inicial (fora do escopo por decisão
    // do dono) não há saldo a acumular, e a soma de 12 meses é o número que alguém imprime.
    notas: {
      canceladas: notas.canceladas,
    },
  };
}

/**
 * ⚠⚠ A FOLHA — coluna própria do v3 §3.2, e a **única** que traz uma simplificação declarada.
 *
 * > Decisão do dono, 28/08/2026: *"folha lançada conta como paga"*.
 *
 * ⚠⚠ **ISTO É SUPOSIÇÃO DECLARADA, NÃO MEDIÇÃO — e é a mesma da nota (errata §7.1).** O sistema
 * sabe quanto de folha foi **lançado** por mês e **não sabe se foi paga**: `derivarFolha12m` soma o
 * débito na conta de DESPESA e **exclui o pagamento de propósito**. Pela Lei 1, não provado pago
 * seria compromisso — e aí todo mês passado ficaria âmbar, contra o critério de aceite nº 12.
 * O dono escolheu a simplificação, e ela **viaja marcada** em `base.simplificacao`: sem isso,
 * "confirmado" aqui seria indistinguível de um pagamento provado, e não há nenhum.
 * ⚠ Ela morre na Fase 4, junto com a do recebimento da nota.
 *
 * ⚠ **A REGRA NÃO FOI REESCRITA AQUI.** `derivarFolha12m` é a mesma função que o `FechamentoModal`
 * usa para conferir o Fator R — ela sabe resolver a conta de despesa e descartar o pagamento. Uma
 * segunda soma de folha divergiria da conferência do contador na primeira correção.
 * ⚠ O que mudou nela foi só o `client` virar injetável: o fluxo é todo dublê nos testes.
 *
 * ⚠⚠ **MÊS FUTURO NÃO GANHA LINHA NESTA FASE.** Projetar folha é PRESUNÇÃO, e presunção é Fase 2.
 * Célula sem linha vira traço — que é a resposta honesta para "ainda não sabemos".
 */
/**
 * ⚠⚠ A FOLHA DO FLUXO PASSOU A SER O **PAGAMENTO**, NUNCA A PROVISÃO BRUTA (30/08/2026).
 *
 * > Dono: *"se caixa é cinco, as confirmações para o fluxo saem do código 5, que é caixa — entrada
 * > entra no cinco e saída sai no cinco"* · *"você me coloca pró-labore com o INSS junto, valor de
 * > 1.621,00, quando são coisas separadas: pró-lab é 1.442,69 e INSS 178,31"* · *"se eu provisiono
 * > isso em julho, eu vou pagar em agosto — deve aparecer em agosto (…) se o último pagamento foi
 * > feito dia 16, eu PROVISIONO em agosto para dia 16."*
 *
 * ⚠⚠ **AS PARTIDAS DOBRADAS REAIS DA ERISANGELA PROVAM OS TRÊS PONTOS** (lidas em produção):
 *
 * ```
 * 30/07  VR REF PRO LAB FP 07/2026        D 426 (PRO LABORE)   1.621,00   ← provisão do BRUTO
 * 30/07  VR REF INSS S/PRO LAB FP 07      C 240                  178,31   ← INSS retido (passivo)
 * 30/07  VR PRO LAB LIQ FP 07/2026        C 233                1.442,69   ← líquido a pagar
 * 05/08  PAGO PRO-LAB 07/2026             D 233 / C 5          1.442,69   ← O DINHEIRO SAI AQUI
 * ```
 *
 * O que a coluna mostrava era o **D 426 de 1.621,00**, na competência da PROVISÃO. Três erros num
 * número só:
 *
 *   1. ⚠⚠ **VALOR** — 1.621,00 é o bruto; do caixa saem **1.442,69**. Os 178,31 de INSS retido saem
 *      depois, pela GUIA — e a guia já está na coluna Impostos. **O INSS estava contado DUAS VEZES.**
 *   2. ⚠⚠ **MÊS** — a provisão é de julho, o pagamento é de **agosto**. Fluxo de caixa é quando o
 *      dinheiro sai, não quando a despesa é reconhecida.
 *   3. ⚠⚠ **DIA** — o lançamento de pagamento TEM data (05/08), e a coluna mostrava "no mês".
 *
 * ⚠ **`derivarFolha12m` NÃO FOI TOCADA, e não pode ser.** Ela existe para conferir o **Fator R**,
 * onde o número certo é o BRUTO da folha (é isso que a LC 123 manda comparar com o RBT12). Mudá-la
 * consertaria o fluxo e estragaria a apuração. São duas perguntas diferentes sobre o mesmo
 * lançamento: *"quanto custou a folha?"* × *"quanto saiu do caixa?"*.
 *
 * ⚠⚠ **QUEM DIZ QUE UMA CONTA É CAIXA É O `codigoCompleto`, NUNCA O REDUZIDO NEM O NOME.**
 * `AccountingEntryLine.conta` guarda o **reduzido**, e o reduzido `5` é CAIXA enquanto o COMPLETO
 * `5` é IRPJ/CSLL — 41 contas do plano têm os dois apontando para grupos diferentes, e trocar
 * inverte despesa com imposto sem erro nenhum. Por isso o reduzido é traduzido pelo plano e a
 * pergunta é feita a `entraNoFluxoDeCaixa` (`accounting/lib/disponibilidades.js`), REUSADA.
 */
async function linhasDaFolhaPelaSaidaDeCaixa({ portalClientId, cicloAtual, janelaInicio, client }) {
  const [entries, plano] = await Promise.all([
    client.accountingEntry.findMany({
      where: { portalClientId: String(portalClientId), tipo: "FOLHA" },
      select: {
        competencia: true, historico: true, data: true,
        lines: { select: { tipo: true, valor: true, conta: true } },
      },
      orderBy: { data: "asc" },
    }),
    client.chartOfAccount.findMany({
      where: { OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }] },
      select: { codigo: true, codigoCompleto: true, portalClientId: true },
    }),
  ]);

  // ⚠ A da EMPRESA vence a global quando o reduzido colide — a global é o padrão, não a autoridade.
  const completoDoReduzido = new Map();
  for (const c of plano) {
    const k = texto(c.codigo);
    if (!k) continue;
    const atual = completoDoReduzido.get(k);
    if (!atual || (c.portalClientId && !atual.portalClientId)) completoDoReduzido.set(k, c);
  }
  const ehCaixa = (reduzido) => {
    const c = completoDoReduzido.get(texto(reduzido));
    return c ? entraNoFluxoDeCaixa(c) : false;
  };

  const base = mesesDaCompetencia(janelaInicio || cicloAtual);
  const linhas = [];
  const pagamentos = [];

  for (const e of entries) {
    // ⚠⚠ O PAGAMENTO É A LINHA QUE CREDITA CAIXA. Não é o histórico ("PAGO …") — texto livre não é
    // dado, e um lançamento renomeado deixaria de ser visto. A partida dobrada é a autoridade.
    const saida = (e.lines || [])
      .filter((l) => String(l.tipo).toUpperCase() === "C" && ehCaixa(l.conta))
      .reduce((s, l) => s + (numero(l.valor) || 0), 0);
    if (!(saida > 0)) continue;

    const competencia = competenciaDaData(e.data);
    if (!competencia) continue;
    pagamentos.push({ competencia, dia: diaDaData(e.data), valor: saida });

    const emMeses = mesesDaCompetencia(competencia);
    if (base == null || emMeses == null || emMeses < base) continue;

    linhas.push(montarLinha({
      fonte: FONTE.FOLHA,
      direcao: DIRECAO.SAIDA,
      // ⚠⚠ **FATO**, e agora com razão: o dinheiro saiu do caixa, e a partida dobrada é a prova.
      // Antes a coluna dizia FATO por uma SIMPLIFICAÇÃO declarada (*"folha lançada conta como
      // paga"*) — hoje não há suposição nenhuma neste ramo.
      procedencia: PROCEDENCIA.FATO,
      competencia,
      // ⚠ O DIA vem do lançamento. Era exatamente isto que faltava: *"valores de previsibilidade
      // estão em data nenhuma"*.
      dia: diaDaData(e.data),
      valor: saida,
      rotulo: "Folha de pagamento",
      base: {
        frase: `${texto(e.historico) || "Pagamento de folha"} · saiu do caixa em ${isoDaData(e.data)}`,
        competenciaDaProvisao: texto(e.competencia) || null,
        // ⚠ A prova de que este número é caixa, e não provisão.
        saidaDeCaixa: true,
      },
    }));
  }

  return { linhas, disponivel: linhas.length > 0, pagamentos };
}

/**
 * ⚠⚠⚠ A DESPESA LANÇADA ENTRA NO FLUXO — decisão do dono, 01/09/2026.
 *
 * > *"tudo que virar lançamento deve entrar no fluxo, mas nem tudo do fluxo necessariamente deve
 * > ser um lançamento"* … *"nessa linha podemos adicionar a conta e lançar, **ao lançar entra no
 * > fluxo**"*.
 *
 * ⚠⚠ **ANTES DISTO A REGRA DELE NÃO VALIA, e foi medição que mostrou:** este serviço lia
 * `accountingEntry` **apenas com `tipo: "FOLHA"`**. A despesa que o contador lançava na Conferência
 * — que é o trabalho principal daquela tela — **não aparecia no fluxo do cliente em lugar nenhum**.
 * O dono via a saída sumir depois de lançada e concluía, com razão, que faltava alguma coisa.
 *
 * ⚠ **É IRMÃ de `linhasDaFolhaPelaSaidaDeCaixa`, e não uma generalização dela.** As duas respondem
 * perguntas diferentes (*"quanto saiu de folha?"* × *"quanto saiu de despesa?"*), alimentam colunas
 * diferentes na tela do cliente e a da folha ainda devolve `pagamentos`, que é usado para outra
 * conta. Fundi-las faria `disponivel` e `pagamentos` passarem a significar duas coisas.
 *
 * ⚠⚠ **O CRITÉRIO É O MESMO, E É A PARTIDA DOBRADA — nunca o histórico.** A linha que credita CAIXA
 * é o pagamento. O reduzido é traduzido pelo plano antes da pergunta, porque o reduzido `5` é CAIXA
 * enquanto o COMPLETO `5` é IRPJ/CSLL: 41 contas do plano têm os dois apontando para grupos
 * diferentes, e trocar inverte despesa com imposto sem erro nenhum.
 *
 * ⚠⚠ **`PROCEDENCIA.FATO`, e sem simplificação:** o lançamento de despesa desta casa é
 * `D despesa / C caixa` — ele AFIRMA que o dinheiro saiu, e a data dele é a data em que saiu. É a
 * invariante que `application/declarados/CLAUDE.md` documenta em 155/155 lançamentos medidos.
 */
async function linhasDasDespesasLancadas({ portalClientId, cicloAtual, janelaInicio, client }) {
  const [entries, plano] = await Promise.all([
    client.accountingEntry.findMany({
      where: { portalClientId: String(portalClientId), tipo: "DESPESA" },
      select: {
        competencia: true, historico: true, data: true,
        lines: { select: { tipo: true, valor: true, conta: true } },
      },
      orderBy: { data: "asc" },
    }),
    client.chartOfAccount.findMany({
      where: { OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }] },
      select: { codigo: true, codigoCompleto: true, portalClientId: true },
    }),
  ]);

  // ⚠ A da EMPRESA vence a global quando o reduzido colide — a global é o padrão, não a autoridade.
  const completoDoReduzido = new Map();
  for (const c of plano) {
    const k = texto(c.codigo);
    if (!k) continue;
    const atual = completoDoReduzido.get(k);
    if (!atual || (c.portalClientId && !atual.portalClientId)) completoDoReduzido.set(k, c);
  }
  const ehCaixa = (reduzido) => {
    const c = completoDoReduzido.get(texto(reduzido));
    return c ? entraNoFluxoDeCaixa(c) : false;
  };

  const base = mesesDaCompetencia(janelaInicio || cicloAtual);
  const linhas = [];

  for (const e of entries) {
    const saida = (e.lines || [])
      .filter((l) => String(l.tipo).toUpperCase() === "C" && ehCaixa(l.conta))
      .reduce((s, l) => s + (numero(l.valor) || 0), 0);
    // ⚠ Lançamento que não credita caixa não é saída de dinheiro (uma reclassificação entre contas
    // de despesa, por exemplo). Ele existe no razão e NÃO tem lugar no fluxo.
    if (!(saida > 0)) continue;

    const competencia = competenciaDaData(e.data);
    if (!competencia) continue;

    const emMeses = mesesDaCompetencia(competencia);
    if (base == null || emMeses == null || emMeses < base) continue;

    linhas.push(montarLinha({
      fonte: FONTE.DESPESA_LANCADA,
      direcao: DIRECAO.SAIDA,
      procedencia: PROCEDENCIA.FATO,
      competencia,
      dia: diaDaData(e.data),
      valor: saida,
      rotulo: "Despesa lançada",
      base: {
        // ⚠ O histórico do razão desta casa é o nome do fornecedor cru — é ele que faz o cliente
        // reconhecer a linha. Uma frase montada aqui diria menos que o dado.
        frase: `${texto(e.historico) || "Despesa"} · saiu do caixa em ${isoDaData(e.data)}`,
        competenciaDaProvisao: texto(e.competencia) || null,
        saidaDeCaixa: true,
      },
    }));
  }

  return { linhas, disponivel: linhas.length > 0 };
}

async function linhasDaFolha({ portalClientId, cicloAtual, client }) {
  // ⚠ `competenciasDe12Meses` devolve os 12 meses ANTERIORES ao que se pede — então pedir o mês
  // seguinte é o que inclui o mês corrente na janela. Sem o +1 a folha do mês corrente sumia.
  // ⚠⚠ SEM `catch`, DE PROPÓSITO. A tentação é engolir o erro para "o fluxo não cair" — e aí um
  // defeito na leitura da folha vira "esta empresa não tem folha", em silêncio, para sempre. É a
  // mesma disciplina que `linhasDasSeries` já aplica: lá só o P2021 (tabela ausente) é tratado, e
  // *"erro que NÃO é P2021 sobe — engolir tudo esconderia defeito de verdade"*.
  const derivada = await derivarFolha12m({
    portalClientId: String(portalClientId),
    competencia: somarMeses(cicloAtual, 1),
    client,
  });

  if (!derivada || !derivada.disponivel) {
    // ⚠⚠ `disponivel: false` é "não há folha lançada", e `contasConsideradas` vazio é "não achei a
    // conta" — a própria `FolhaDerivadaService` nomeia a diferença. As duas sobem, porque a segunda
    // é defeito de cadastro e a primeira é o estado normal de quem não tem empregado.
    return { linhas: [], disponivel: false, contasConsideradas: derivada?.contasConsideradas || [] };
  }

  const agora = mesesDaCompetencia(cicloAtual);
  const linhas = [];
  for (const m of derivada.porMes) {
    const valor = numero(m.valor);
    // ⚠ Zero não vira linha: mês sem folha lançada não é "folha de R$ 0,00".
    if (!valor) continue;
    const passado = agora != null && mesesDaCompetencia(m.competencia) < agora;
    linhas.push(montarLinha({
      fonte: FONTE.FOLHA,
      direcao: DIRECAO.SAIDA,
      // ⚠ Passado ⇒ FATO pela simplificação; mês corrente ⇒ COMPROMISSO, porque ele ainda está
      // aberto e a folha dele ainda pode mudar.
      procedencia: passado ? PROCEDENCIA.FATO : PROCEDENCIA.COMPROMISSO,
      competencia: m.competencia,
      // ⚠ O lançamento tem competência, não dia — a data de pagamento da folha não está aqui.
      dia: null,
      diaDesconhecido: DIA_DESCONHECIDO.FOLHA_SEM_DIA,
      valor,
      rotulo: "Folha de pagamento",
      base: {
        frase: `${m.lancamentos} lançamento(s) de folha na competência ${m.competencia}`,
        lancamentos: m.lancamentos,
        simplificacao: passado ? "pagamento_integral_presumido" : null,
      },
    }));
  }
  return { linhas, disponivel: true, contasConsideradas: derivada.contasConsideradas };
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
