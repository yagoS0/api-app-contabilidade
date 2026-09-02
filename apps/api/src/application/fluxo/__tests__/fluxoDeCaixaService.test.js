// O FLUXO DE CAIXA — a ligação com o banco.
//
// ⚠⚠ Este serviço é SÓ LEITURA, e o que ele NÃO entrega é tão importante quanto o que entrega: não
// há `total`, não há saldo acumulado, o DESCONHECIDO não vira zero, e a guia real substitui a
// projeção do mesmo mês.

import { montarFluxoDeCaixa, cicloDeHoje } from "../FluxoDeCaixaService.js";
import { DIRECAO, FONTE, PROCEDENCIA, SEM_IMPOSTO, SEM_MES } from "../lib/fluxoDeCaixa.js";
import {
  ESTADO_DA_SERIE, LADO, WHERE_SERIE_NO_FLUXO, serieEntraNoFluxo,
} from "../SerieRecorrenteService.js";

const CICLO = "2026-08";

/**
 * ⚠⚠ `liberadaCliente: true` NO PADRÃO, e a escolha é deliberada (02/09/2026).
 *
 * Desde *"só confirmada após a liberação"* (dono), a guia em aberto **não liberada** entra no fluxo
 * como PREVISÃO, e a liberada como COMPROMISSO. Os casos da Lei 1 abaixo medem o que uma guia na
 * MÃO DO CLIENTE é — então é esse o estado que eles precisam declarar.
 *
 * ⚠ O outro ramo não fica sem rede: ele tem bloco próprio (*"a guia não liberada é PREVISÃO"*), e
 * lá o `false` é explícito. Um padrão que servisse aos dois esconderia um dos dois.
 */
const guia = (extra = {}) => ({
  id: "g-1", tipo: "SIMPLES", competencia: "2026-07", valor: "1200.00",
  vencimento: new Date("2026-08-20T00:00:00.000Z"), paymentStatus: "OPEN",
  numeroParcela: null, parcelamentoId: null, paymentConfirmedAt: null,
  liberadaCliente: true, ...extra,
});

const nota = (extra = {}) => ({
  id: "n-1", numero: "1042", competencia: new Date("2026-08-01T00:00:00.000Z"),
  total: "8000.00", tomadorNome: "CLINICA LAIF LTDA",
  statusEfetivo: "autorizada", status: "EMITIDA", chaveSubstituida: null, ...extra,
});

const serie = (extra = {}) => ({
  id: "s-1", lado: LADO.DESPESA, chave: "98765432000155", rotulo: "ANTHROPIC",
  periodicidade: "MENSAL", estado: ESTADO_DA_SERIE.ATIVA, origem: "DETECTADA",
  valorDeclarado: null, baseDaObservacao: { n: 3, mediana: 130, min: 120, max: 140, cv: 0.08 },
  ...extra,
});

const apuracao = (extra = {}) => ({
  competencia: "2026-06", receitaInterna: "10000.00", receitaExterna: "0.00",
  dasRetornadoSerpro: "600.00", dasSimuladoSerpro: null, ...extra,
});

function clientDe({ guias = [], notas = [], series = [], snapshot = null, prazo = null, erroNaSerie = null, primeiraNota = undefined, folhas = [], contasDeFolha = [], apuradas = [], transmitidas = [], saidasDoCliente = null, despesas = [], previstas = null } = {}) {
  return {
    portalClient: { findUnique: jest.fn(async () => ({ id: "emp-1", prazoRecebimentoMeses: prazo })) },
    guide: { findMany: jest.fn(async () => guias) },
    portalInvoice: {
      findMany: jest.fn(async () => notas),
      // ⚠ O limite da navegação para trás. `undefined` = "deixe o dublê responder pela fixture";
      // `null` = "esta empresa não tem nota nenhuma", que é um caso de teste legítimo.
      findFirst: jest.fn(async () => (primeiraNota !== undefined ? primeiraNota : (notas[0] || null))),
    },
    serieRecorrente: {
      findMany: jest.fn(async () => {
        if (erroNaSerie) throw erroNaSerie;
        return series;
      }),
    },
    apuracaoSnapshot: {
      findFirst: jest.fn(async () => snapshot),
      // ⚠ A PROVA da apuração transmitida DAQUI. Ver `competenciasApuradas` no serviço.
      findMany: jest.fn(async () => transmitidas.map((competencia) => ({ competencia }))),
    },
    /**
     * ⚠⚠ A PROVA DA APURAÇÃO, e ela é o que promove a entrada da nota a FATO desde 29/08/2026.
     *
     * `pgdasNumeroDeclaracao` vem do índice da PRÓPRIA RFB. ⚠ `apuradas` no dublê são as
     * competências com essa prova — nunca as que o contador AFIRMOU ter entregue.
     */
    companyMonthlyCircular: {
      findMany: jest.fn(async () => apuradas.map((competencia) => ({ competencia }))),
    },
    // ⚠ As duas tabelas que a FOLHA lê. Elas existem no dublê mesmo quando o caso não fala de
    // folha, porque `derivarFolha12m` NÃO tem `catch`: método faltando derruba a suíte inteira, que
    // é exatamente o que se quer se alguém trocar a leitura por uma que engole erro.
    /**
     * ⚠⚠ O DUBLÊ FILTRA POR `tipo`, e isso deixou de ser detalhe em 01/09/2026.
     *
     * Desde que a DESPESA lançada passou a alimentar o fluxo, este delegate é lido DUAS vezes com
     * `where.tipo` diferente. Um dublê que devolvesse a mesma lista para os dois faria a folha
     * aparecer também como despesa — o mesmo dinheiro contado duas vezes — e a asserção passaria.
     * É a mesma lição que o filtro de `estado` das saídas já carrega logo abaixo.
     */
    /**
     * ⚠ `previstas: null` deixa o DELEGATE de fora — o estado real da máquina sem `prisma generate`,
     * e o que a guarda `!client?.lancamentoDeclarado?.findMany` atravessa sem TypeError.
     */
    ...(previstas === null ? {} : { lancamentoDeclarado: { findMany: jest.fn(async () => previstas) } }),
    accountingEntry: {
      findMany: jest.fn(async ({ where } = {}) => (where?.tipo === "DESPESA" ? despesas : folhas)),
    },
    chartOfAccount: { findMany: jest.fn(async () => contasDeFolha) },
    /**
     * ⚠⚠ AS SAÍDAS QUE O CLIENTE ACRESCENTOU.
     *
     * `saidasDoCliente: null` deixa o DELEGATE de fora do dublê de propósito — é o estado REAL da
     * máquina em que o `prisma generate` não rodou (EPERM no Windows com o servidor de dev de pé), e
     * é o que a guarda `!client?.saidaAvulsaCliente?.findMany` existe para atravessar sem TypeError.
     */
    ...(saidasDoCliente === null ? {} : {
      saidaAvulsaCliente: {
        findMany: jest.fn(async ({ where } = {}) => {
          // ⚠ O dublê APLICA o filtro de estado, em vez de devolver tudo: é justamente o filtro que
          // está sob teste (pendente entra, recusada não), e um dublê que o ignorasse deixaria a
          // asserção passar com o serviço lendo qualquer coisa.
          const aceitos = where?.estado?.in || (where?.estado ? [where.estado] : null);
          return (saidasDoCliente || []).filter((s) => !aceitos || aceitos.includes(s.estado));
        }),
      },
    }),
  };
}

/** Um lançamento de folha: a PROVISÃO (débito na conta de despesa). */
const folha = (competencia, valor = "3000.00") => ({
  competencia,
  lines: [{ tipo: "D", valor, conta: "41101" }, { tipo: "C", valor, conta: "233" }],
});

const CONTA_DE_FOLHA = [{ codigo: "41101", nome: "SALARIOS E ORDENADOS", portalClientId: null }];

/**
 * ⚠⚠ O DIA TAMBÉM É INJETADO, e não só o ciclo (28/08/2026).
 *
 * Desde a Lei 1 o serviço compara vencimento com HOJE para separar *vencida* de *vence em 5 dias* —
 * e um teste que dependesse do relógio da máquina passaria em agosto e cairia em setembro.
 */
const HOJE = "2026-08-27";

const montar = (client, extra = {}) =>
  montarFluxoDeCaixa({ portalClientId: "emp-1", cicloAtual: CICLO, hoje: HOJE, client, ...extra });

const doMes = (r, competencia) => r.meses.find((m) => m.competencia === competencia);
const linhasDe = (r, fonte) => r.meses.flatMap((m) => m.linhas).filter((l) => l.fonte === fonte);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE ELE NÃO ENTREGA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ não existe `total`, nem saldo acumulado", () => {
  it("o payload inteiro não tem a chave `total`", async () => {
    const r = await montar(clientDe({ guias: [guia()], notas: [nota()] }));
    // ⚠⚠ `docs/dre-fluxo-caixa.md` proíbe. No instante em que ela existir, alguma tela a imprime.
    expect(JSON.stringify(r)).not.toMatch(/"total"\s*:/);
    expect(r).not.toHaveProperty("total");
  });

  it("⚠⚠ e não há saldo acumulado — sem saldo inicial não há o que acumular", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    expect(JSON.stringify(r)).not.toMatch(/saldoAcumulado|saldoInicial/i);
  });

  it("⚠ cada mês totaliza por PROCEDÊNCIA, e só", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    const m = doMes(r, "2026-08");
    // ⚠ `compromisso` entrou em 28/08/2026 (Lei 1) e é ADITIVO: `fato` e `previsao` continuam com
    // os mesmos nomes. A lista sai de `PROCEDENCIA`, nunca cravada — nível novo sem balde próprio
    // cairia em silêncio dentro de outro.
    expect(Object.keys(m.totais).sort())
      .toEqual(Object.values(PROCEDENCIA).map((x) => x.toLowerCase()).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O CAMPO QUE APAGA O SELO DE DEMONSTRAÇÃO NO PORTAL DO CLIENTE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ `demonstracao: false` é AFIRMADO pelo servidor", () => {
  it("o payload diz, com todas as letras, que estes números são reais", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    // ⚠⚠ O bloco do Painel do cliente lê `demonstracao !== false`: AUSENTE NÃO É `false`. Sem esta
    // linha, o número verdadeiro continuaria saindo debaixo do selo "Dados de demonstração" —
    // a tela chamando de fictício o dinheiro real da empresa.
    expect(r.demonstracao).toBe(false);
  });

  it("⚠ e ele existe MESMO no fluxo vazio — é sobre a PROCEDÊNCIA, não sobre haver linha", async () => {
    const r = await montar(clientDe({}));
    expect(r.demonstracao).toBe(false);
    expect(r.meses.every((m) => m.linhas.length === 0)).toBe(true);
  });
});

describe("⚠⚠ o serviço é SÓ LEITURA", () => {
  it("nenhum método de escrita existe no client, e nada é chamado", async () => {
    const client = clientDe({ guias: [guia()], notas: [nota()], series: [serie()] });
    await montar(client);
    for (const modelo of Object.values(client)) {
      expect(modelo.create).toBeUndefined();
      expect(modelo.update).toBeUndefined();
      expect(modelo.upsert).toBeUndefined();
      expect(modelo.delete).toBeUndefined();
    }
  });

  it("⚠ a varredura de fonte confirma", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "FluxoDeCaixaService.js"), "utf8")
      // ⚠ BLOCO antes de LINHA — um `//` dentro de `/* */` apaga o fechamento.
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(|\$transaction|\$executeRaw/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1 e 2 · AS GUIAS — reescrito em 28/08/2026 pela **Lei 1** da `CONSTITUICAO-do-produto.md`.
//
// ⚠⚠ ESTE BLOCO MEDIA O CONTRÁRIO, e o contrário está preservado no nome antigo dele:
// *"a guia COM vencimento é FATO"*. A Lei 1 desfez isso — *"contabilizado, emitido, gerado,
// vencido: nada disso é fato de caixa"*. Guia gerada e não paga virou COMPROMISSO, e mudou de mês.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ Lei 1 — só o pagamento confirma; a guia gerada é COMPROMISSO", () => {
  const paga = (extra = {}) => guia({
    paymentStatus: "PAID", paymentConfirmedAt: new Date("2026-06-18T00:00:00.000Z"), ...extra,
  });

  it("⚠⚠ a guia PAGA é FATO, e cai no mês do PAGAMENTO — não no do vencimento", async () => {
    // ⚠ Vencimento em agosto, pagamento em junho: se ela caísse no vencimento, junho apareceria sem
    // imposto nenhum e agosto contaria um dinheiro que já saiu.
    const r = await montar(clientDe({ guias: [paga()] }));
    const l = doMes(r, "2026-06").linhas[0];
    expect(l.procedencia).toBe(PROCEDENCIA.FATO);
    expect(l.dia).toBe(18);
    expect(doMes(r, "2026-08").linhas).toHaveLength(0);
  });

  it("⚠⚠ a guia PAGA existia e NÃO CHEGAVA — era ela que esvaziava o passado", async () => {
    // A query filtrava `paymentStatus: { in: ["OPEN","OVERDUE"] }`, então a guia paga sumia do
    // payload INTEIRO: nem em `meses`, nem em `semMes`, nem em `vencidas`. Sem este caso, a janela
    // com 4 meses de passado nasceria sem uma única linha de imposto.
    const client = clientDe({ guias: [] });
    await montar(client);
    expect(client.guide.findMany.mock.calls[0][0].where.paymentStatus.in).toContain("PAID");
  });

  it("⚠⚠ paga SEM data de pagamento não escolhe mês — sai NOMEADA", async () => {
    const r = await montar(clientDe({ guias: [paga({ paymentConfirmedAt: null })] }));
    expect(r.meses.every((m) => m.linhas.length === 0)).toBe(true);
    expect(r.semMes[0].motivo).toBe(SEM_MES.GUIA_PAGA_SEM_DATA);
    // ⚠ Ela ACONTECEU — então não pode virar compromisso; e não se sabe quando — então não pode
    // virar mês. As duas coisas ao mesmo tempo só cabem aqui.
    expect(r.semMes[0].frase).toMatch(/quando o dinheiro saiu/i);
  });

  it("⚠⚠ a guia EM ABERTO é COMPROMISSO, e vive no mês CORRENTE", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    const l = doMes(r, CICLO).linhas[0];
    expect(l.procedencia).toBe(PROCEDENCIA.COMPROMISSO);
    expect(l.direcao).toBe(DIRECAO.SAIDA);
    // ⚠ O vencimento cai no mês corrente, então o dia dela é o dia do vencimento.
    expect(l.dia).toBe(20);
  });

  it("⚠⚠ a guia VENCIDA em mês passado sai do mês CORRENTE — e o dia dela não vale mais", async () => {
    // ⚠⚠ ISTO INVERTE O CASO ANTIGO *"ela NÃO é empurrada para o mês corrente — vencida é uma
    // condição, não um mês"*. O argumento de então: pôr a guia de julho dentro de agosto seria o
    // sistema escolhendo o mês por ela. O que mudou: a Lei 1 diz que a guia em aberto **não é saída
    // de mês nenhum** até ser paga — logo ela não fica em julho, e o dinheiro sai de agosto.
    const r = await montar(clientDe({ guias: [guia({ vencimento: new Date("2026-07-20T00:00:00.000Z") })] }));
    expect(doMes(r, "2026-07").linhas).toHaveLength(0);
    const l = doMes(r, CICLO).linhas[0];
    expect(l.procedencia).toBe(PROCEDENCIA.COMPROMISSO);
    // ⚠ O dia sai NOMEADO, nunca cravado no 20 de um mês que já passou.
    expect(l.dia).toBeNull();
    expect(l.diaDesconhecido.motivo).toBe("compromisso_em_atraso");
  });

  it("⚠⚠ o passado só carrega o que foi PAGO — critério de aceite nº 12 da Constituição", async () => {
    // *"Nenhum mês anterior ao corrente exibe célula âmbar no modo Fluxo, exceto guia vencida ainda
    // aberta — que aparece no corrente, não no passado."* Não é regra de tela: é o que a Lei 1
    // produz sozinha, e este caso é a prova.
    const r = await montar(clientDe({
      guias: [paga(), guia({ id: "g-2", vencimento: new Date("2026-05-20T00:00:00.000Z") })],
    }));
    for (const m of r.meses.filter((x) => x.competencia < CICLO)) {
      expect(m.totais.compromisso.saida).toBe(0);
      expect(m.totais.previsao.saida).toBe(0);
    }
    expect(doMes(r, "2026-06").totais.fato.saida).toBe(1200);
    expect(doMes(r, CICLO).totais.compromisso.saida).toBe(1200);
  });

  it("⚠⚠ a guia em aberto NÃO entra em `fato` — era exatamente aí que ela entrava", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    expect(doMes(r, CICLO).totais.fato.saida).toBe(0);
    expect(doMes(r, CICLO).totais.compromisso.saida).toBe(1200);
  });

  /**
   * ⚠⚠ ESTES DOIS TESTES DIZIAM O CONTRÁRIO ATÉ 30/08/2026, e a decisão que os virou é do dono:
   * *"impostos não estão com data definida; por definição devem ficar no dia do vencimento — temos
   * esses dados, use-os"* · *"a DAS de agosto deveria ter pago dia 20 de agosto, seria a DAS da
   * competência 07"*.
   *
   * Medido na ERISANGELA: o DAS da competência 07 existe, vale R$ 1.437,15 e tem `vencimento` NULO.
   * Pela regra antiga ele caía em `semMes` e **sumia da tabela** — era esse o buraco de agosto.
   *
   * ⚠ O que NÃO mudou: sem competência **também** não há derivação, e aí ela continua saindo
   * nomeada. A âncora é a competência; ausência de dado nunca vira data.
   */
  it("⚠⚠ sem vencimento MAS com competência, ela cai no dia 20 — o dia da lei, marcado como presumido", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: null, competencia: "2026-07" })] }));
    const l = doMes(r, CICLO).linhas.find((x) => x.fonte === FONTE.GUIA);
    expect(l).toBeTruthy();
    expect(l.dia).toBe(20);
    // ⚠⚠ A MARCA É O QUE SEPARA O DIA IMPRESSO NA GUIA DO DIA DERIVADO POR NÓS.
    expect(l.base.vencimentoPresumido).toBe(true);
    expect(r.semMes).toHaveLength(0);
  });

  it("⚠ o vencimento que VEIO da guia não é marcado como presumido", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    expect(doMes(r, CICLO).linhas.find((x) => x.fonte === FONTE.GUIA).base.vencimentoPresumido).toBe(false);
  });

  it("⚠⚠ sem vencimento E sem competência ela continua fora de mês nenhum, NOMEADA", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: null, competencia: null })] }));
    expect(r.meses.every((m) => m.linhas.length === 0)).toBe(true);
    expect(r.semMes).toHaveLength(1);
    expect(r.semMes[0].motivo).toBe(SEM_MES.GUIA_SEM_VENCIMENTO);
    expect(r.semMes[0].frase).toMatch(/recapture a guia/i);
  });

  it("⚠⚠ e ela NÃO entra em `totais` — o desconhecido é contagem, nunca valor", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: null, competencia: null })] }));
    for (const m of r.meses) {
      expect(m.totais.fato.saida).toBe(0);
      expect(m.totais.compromisso.saida).toBe(0);
      expect(m.totais.previsao.saida).toBe(0);
    }
  });

  /**
   * ⚠⚠ GUIA DE R$ 0,00 É MARCADOR, NÃO COMPROMISSO (30/08/2026). Medido na ERISANGELA: 4 guias
   * `SIMPLES` de zero. Elas só ficaram visíveis quando o recorte de `liberadaCliente` caiu, e uma
   * linha de zero AFIRMARIA um imposto de zero reais naquele mês.
   */
  it("⚠⚠ guia de R$ 0,00 não vira linha — ela sai nomeada", async () => {
    const r = await montar(clientDe({ guias: [guia({ valor: "0.00" })] }));
    expect(r.meses.every((m) => m.linhas.length === 0)).toBe(true);
    expect(r.semMes[0].motivo).toBe(SEM_MES.GUIA_SEM_VALOR);
  });

  it("⚠ a parcela de parcelamento tem rótulo próprio — não é o DAS do mês", async () => {
    const r = await montar(clientDe({ guias: [guia({ parcelamentoId: "p-1", numeroParcela: 3 })] }));
    expect(doMes(r, CICLO).linhas[0].rotulo).toMatch(/Parcela 3 de parcelamento/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ VENCIDA PASSOU A SER CONTADA POR **DIA** — e isso fecha uma divergência conhecida.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o que já venceu, e o que vence em 5 dias", () => {
  it("⚠⚠ a guia do MÊS CORRENTE cujo dia já passou É vencida — o corte deixou de ser o mês", async () => {
    // ⚠⚠ ISTO INVERTE o caso *"a guia do mês corrente NÃO é vencida, por mais que o dia já tenha
    // passado"*. O argumento de então era honesto: *"o dia de hoje não entra nesta regra"* — o
    // serviço só recebia a competência. Hoje ele recebe o DIA, injetado, porque o pop-up precisa
    // separar *vencida* de *vence em 5 dias*, e nenhuma das duas cabe em granularidade de mês.
    // ⚠ E era essa a divergência que o `CLAUDE.md` já registrava contra o card "A vencer", que
    // sempre comparou com hoje. As duas telas passam a usar o mesmo dia.
    const r = await montar(clientDe({ guias: [guia({ vencimento: new Date("2026-08-20T00:00:00.000Z") })] }));
    expect(r.vencidas.quantas).toBe(1);
  });

  it("⚠ a que vence HOJE não está vencida — a borda é estrita", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: new Date("2026-08-27T00:00:00.000Z") })] }));
    expect(r.vencidas.quantas).toBe(0);
  });

  it("o alerta junta as vencidas e as que vencem em até 5 dias, com estados distintos", async () => {
    const r = await montar(clientDe({
      guias: [
        guia({ id: "g-v", vencimento: new Date("2026-08-20T00:00:00.000Z"), valor: "900.00" }),
        guia({ id: "g-p", vencimento: new Date("2026-09-01T00:00:00.000Z"), valor: "100.00" }),
        // ⚠ 6 dias: fora do alerta. É a borda do número do dono, e ela é medida.
        guia({ id: "g-f", vencimento: new Date("2026-09-02T00:00:00.000Z"), valor: "50.00" }),
      ],
    }));
    expect(r.alertaDeGuias.itens.map((i) => [i.id, i.estado]))
      .toEqual([["g-v", "overdue"], ["g-p", "due_soon"]]);
    // ⚠ `valor`, nunca `total`: existe varredura no payload proibindo a chave `"total"`.
    expect(r.alertaDeGuias.valor).toBe(1000);
  });

  it("⚠ sem guia nenhuma nessas condições, o alerta vem VAZIO — e vazio é resposta", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: new Date("2026-12-20T00:00:00.000Z") })] }));
    expect(r.alertaDeGuias.itens).toEqual([]);
    expect(r.vencidas).toEqual({ quantas: 0, valor: 0, linhas: [] });
  });

  it("⚠⚠ vencidas e o mês corrente falam da MESMA guia — quem somar os dois conta em dobro", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: new Date("2026-07-20T00:00:00.000Z") })] }));
    expect(r.vencidas.valor).toBe(1200);
    expect(doMes(r, CICLO).totais.compromisso.saida).toBe(1200);
    // ⚠ Por isso `vencidas` NÃO entra em `totais` — ele é lista de conferência, não parcela a somar.
  });

  /**
   * ⚠⚠ ESTE TESTE PRENDIA O RECORTE `liberadaCliente: true`, E ELE CAIU EM 30/08/2026.
   *
   * > Dono: *"o fluxo não tem a ver com o que foi liberado; o fluxo é uma PREVISÃO, o que é liberado
   * > apenas CONFIRMA a previsão."*
   *
   * Medido na ERISANGELA: 7 das 17 guias estavam liberadas. O DAS da competência 07 (R$ 1.437,15) e
   * o INSS de 08 (R$ 178,31) não estavam, e a coluna Impostos de agosto mostrava R$ 651,33 de
   * **parcelas de parcelamento** — sem o imposto do mês.
   *
   * ⚠ Liberar continua governando o que o cliente BAIXA (`GET /client/.../fluxo` e o download). O
   * que ele deixou de governar é o que o fluxo MOSTRA.
   */
  it("⚠⚠ o fluxo NÃO filtra por `liberadaCliente` — ele é previsão, e liberar só confirma", async () => {
    const client = clientDe({ guias: [] });
    await montar(client);
    const where = client.guide.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("liberadaCliente");
  });

  it("⚠ a guia NÃO liberada entra no fluxo, como qualquer outra", async () => {
    const r = await montar(clientDe({ guias: [guia({ liberadaCliente: false })] }));
    expect(doMes(r, CICLO).linhas.some((l) => l.fonte === FONTE.GUIA)).toBe(true);
  });
});

describe("⚠⚠ a nota emitida + prazo", () => {
  it("⚠⚠ SEM apuração é PREVISÃO — a nota prova o FATURADO, não o RECEBIDO", async () => {
    // `PortalInvoice` não tem `recebidoEm`. Verde ali diria "recebido".
    const r = await montar(clientDe({ notas: [nota()] }));
    const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
    expect(l.procedencia).toBe(PROCEDENCIA.PREVISAO);
    expect(l.direcao).toBe(DIRECAO.ENTRADA);
  });

  /**
   * ⚠⚠ A PROMOÇÃO POR APURAÇÃO — decisão do dono, 29/08/2026: *"eu estou afirmando, a apuração quer
   * dizer que o dinheiro entrou, pode colocar."*
   *
   * ⚠⚠ **O CRITÉRIO ANTIGO NUNCA TEVE UM TESTE**, e este bloco existe também por isso: até 28/08 a
   * entrada virava `FATO` só por a competência ser anterior ao mês corrente, e a nota da fixture é
   * do MÊS CORRENTE — então o ramo `FATO` nunca era exercido. Ele mudou sem nada ficar vermelho.
   */
  describe("⚠⚠ a apuração é o que promove a entrada a FATO", () => {
    // ⚠ A nota é de JULHO e a entrada cai em AGOSTO. A prova que importa é a da competência da
    // NOTA (julho) — é ela que foi declarada à Receita.
    const notaDeJulho = () => nota({ competencia: new Date("2026-07-01T00:00:00.000Z") });

    it("com `pgdasNumeroDeclaracao` da competência da NOTA ⇒ FATO", async () => {
      const r = await montar(clientDe({ notas: [notaDeJulho()], apuradas: ["2026-07"] }));
      const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
      expect(l.competencia).toBe("2026-08");
      expect(l.procedencia).toBe(PROCEDENCIA.FATO);
      expect(l.base.apuracaoProvada).toBe(true);
    });

    it("com snapshot `transmitida` daquela competência ⇒ FATO", async () => {
      const r = await montar(clientDe({ notas: [notaDeJulho()], transmitidas: ["2026-07"] }));
      expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].procedencia).toBe(PROCEDENCIA.FATO);
    });

    it("⚠⚠ competência PASSADA e SEM apuração ⇒ PREVISÃO — o critério antigo diria FATO", async () => {
      // ⚠⚠ É a mudança visível: um mês passado sem apuração deixa de ter a entrada confirmada.
      // Abre exceção ao critério de aceite nº 12 (*"nenhum mês anterior exibe célula âmbar"*), que
      // nasceu da Lei 1 e falava das GUIAS. Está registrado no serviço, não escondido.
      const r = await montar(clientDe({ notas: [notaDeJulho()] }));
      const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
      expect(l.procedencia).toBe(PROCEDENCIA.PREVISAO);
      expect(l.base.apuracaoProvada).toBe(false);
    });

    it("⚠ a apuração de OUTRA competência não promove — a prova é da competência da nota", async () => {
      const r = await montar(clientDe({ notas: [notaDeJulho()], apuradas: ["2026-06", "2026-08"] }));
      expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].procedencia).toBe(PROCEDENCIA.PREVISAO);
    });

    it("⚠⚠ a marca diz que o provado foi a APURAÇÃO, não o crédito em conta", async () => {
      // ⚠ `PortalInvoice` não tem `recebidoEm`. A promoção não pode se apresentar como recebimento
      // MEDIDO — a marca é o que mantém a suposição auditável em vez de invisível.
      const r = await montar(clientDe({ notas: [notaDeJulho()], apuradas: ["2026-07"] }));
      expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].base.simplificacao)
        .toBe("recebimento_presumido_pela_apuracao");
    });

    it("⚠⚠ a AFIRMAÇÃO do contador NÃO é consultada — só a prova da Receita", async () => {
      // ⚠⚠ `EntregaObrigacaoArquivo(PGDAS_D).transmitidaEm` é o contador dizendo que entregou.
      // `FechamentoService` já escreve por quê ela não vale: *"promovida a comprovação, a afirmação
      // faria o portal responder 'entregue' a partir de nada além de um clique"*. Aqui um clique
      // passaria a confirmar dinheiro no caixa do cliente.
      const client = clientDe({ notas: [notaDeJulho()] });
      await montar(client);
      expect(client.entregaObrigacaoArquivo).toBeUndefined();
      const fs = require("node:fs");
      const path = require("node:path");
      const fonte = fs.readFileSync(path.join(__dirname, "..", "FluxoDeCaixaService.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(fonte).not.toMatch(/entregaObrigacaoArquivo/);
    });

    it("⚠ é UMA consulta por empresa, não uma por nota", async () => {
      const client = clientDe({
        notas: [notaDeJulho(), nota({ id: "n-2", competencia: new Date("2026-06-01T00:00:00.000Z") })],
        apuradas: ["2026-06", "2026-07"],
      });
      await montar(client);
      expect(client.companyMonthlyCircular.findMany).toHaveBeenCalledTimes(1);
    });
  });

  it("nota de agosto entra em setembro — o padrão é competência + 1 mês", async () => {
    const r = await montar(clientDe({ notas: [nota()] }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].competencia).toBe("2026-09");
  });

  /**
   * ⚠⚠ DIA 1 — E ESTE BLOCO SUBSTITUIU O QUE TRAVAVA A REGRA CONTRÁRIA (29/08/2026).
   *
   * Até 28/08 havia aqui `⚠⚠ MÊS, NÃO DIA — inventar 'dia 10' seria fabricar precisão que ninguém
   * informou`, e mais quatro casos sobre o **prazo configurável por empresa**. O dono reverteu:
   *
   * > *"as notas emitidas do mês anterior se tornam a receita do mês seguinte (…) por isso entram
   * > no dia 1."*
   *
   * ⚠ A REGRA GERAL NÃO CAIU: *"dia ausente nunca vira dia inventado"* continua valendo para
   * recorrência, imposto previsto e folha — há testes dela logo abaixo. O que mudou é que o dia 1
   * desta linha deixou de ser invenção do sistema e passou a ser CONVENÇÃO do dono.
   */
  it("⚠⚠ a receita cai no DIA 1, e o motivo do dia desconhecido SOME", async () => {
    const r = await montar(clientDe({ notas: [nota()] }));
    const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
    expect(l.dia).toBe(1);
    // ⚠ `diaDesconhecido` nulo é o ponto: com ele preenchido a tela escreveria "no mês" ao lado de
    // um dia que existe — duas afirmações opostas na mesma linha.
    expect(l.diaDesconhecido).toBeNull();
  });

  it("⚠⚠ e as OUTRAS fontes continuam sem dia — a regra geral não caiu junto", async () => {
    const r = await montar(clientDe({ notas: [nota()], series: [serie()] }));
    const daSerie = linhasDe(r, FONTE.SERIE_DESPESA)[0];
    expect(daSerie.dia).toBeNull();
    expect(daSerie.diaDesconhecido.frase).toMatch(/de quanto em quanto tempo/i);
  });

  it("⚠⚠ a base NOMEIA a nota — é previsão DOCUMENTAL, não aprendida", async () => {
    const r = await montar(clientDe({ notas: [nota()] }));
    const b = linhasDe(r, FONTE.NOTA_EMITIDA)[0].base;
    expect(b.frase).toMatch(/nota nº 1042/);
    expect(b.frase).toMatch(/emitida em 2026-08/);
    expect(b.documental).toBe(true);
  });

  /**
   * ⚠⚠ O PRAZO POR EMPRESA DEIXOU DE SER LIDO — e estes dois testes existem para provar isso, não
   * por acaso.
   *
   * ⚠ Medido antes da mudança: **nenhuma empresa havia configurado o prazo**, e o padrão já era 1.
   * O efeito prático foi zero; o que mudou é que ele parou de ser configurável em silêncio.
   *
   * ⚠⚠ E há um ganho colateral que vale registrar: com a coluna fora do `select`, a ausência da
   * migration `add_prazo_recebimento` em produção **deixou de derrubar o serviço inteiro com
   * P2022** — o que levava junto os cards e o pop-up do Painel do cliente.
   */
  it("⚠⚠ empresa COM prazo configurado é ignorada — a receita cai no mês seguinte do mesmo jeito", async () => {
    const r = await montar(clientDe({ notas: [nota()], prazo: 2 }));
    // Com o prazo valendo, isto seria "2026-10".
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].competencia).toBe("2026-09");
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].base.frase).not.toMatch(/prazo/i);
  });

  it("⚠⚠ o payload não fala mais de prazo, e a coluna saiu do `select`", async () => {
    const client = clientDe({ notas: [nota()], prazo: null });
    const r = await montar(client);
    expect(r).not.toHaveProperty("prazoRecebimento");
    // ⚠ A varredura é sobre o ARGUMENTO passado ao Prisma: é o único jeito de provar que a coluna
    // não é pedida. Um teste de comportamento passaria com ela no `select`.
    const sel = client.portalClient.findUnique.mock.calls[0][0].select;
    expect(sel).not.toHaveProperty("prazoRecebimentoMeses");
  });

  it.each([
    ["cancelada", { statusEfetivo: "cancelada" }],
    // ⚠⚠ Cancelada SÓ no `status`, com `statusEfetivo` NULO. É o caso que a query não pega (ela
    // filtra por `statusEfetivo: "autorizada"`, e nulo não é "cancelada" nem "autorizada") — e é
    // por isso que `derivarCiclo` roda aqui como segunda guarda, em vez de confiar no `where`.
    ["cancelada só no `status`", { statusEfetivo: null, status: "CANCELADA" }],
  ])("⚠⚠ nota %s NÃO vira receita — o ciclo é lido por `derivarCiclo`", async (_n, extra) => {
    const r = await montar(clientDe({ notas: [nota(extra)] }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)).toHaveLength(0);
    expect(r.notas.canceladas).toBe(1);
  });

  /**
   * ⚠⚠ `chaveSubstituida` DIZ *"EU SUBSTITUO AQUELA"*, NÃO *"EU FUI SUBSTITUÍDA"* — e inverter os
   * dois lados do vínculo é um defeito que este projeto já pagou (`NotaDetailModal`, e a marca
   * d'água do DANFSe).
   *
   * A nota SUBSTITUTA é a válida: ela é a que vale, e a receita é dela. Excluí-la faria a receita
   * sumir justamente da nota que substituiu uma errada.
   *
   * ⚠ LIMITE DECLARADO: para saber que uma nota **foi** substituída, `derivarCiclo` precisa do
   * EVENTO ou da nota substituta — e este serviço passa só `{ nota }`. Isso não abre buraco hoje
   * porque a substituição CANCELA a nota substituída (`statusEfetivo: cancelada`), e o cancelamento
   * já a exclui pelos dois caminhos. O que se perde é o RÓTULO (cancelada × substituída), que este
   * fluxo não usa.
   */
  it("⚠⚠ a nota SUBSTITUTA vira receita — ela é a que vale", async () => {
    const substituta = nota({ chaveSubstituida: "x".repeat(50) });
    const r = await montar(clientDe({ notas: [substituta] }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)).toHaveLength(1);
    expect(r.notas.canceladas).toBe(0);
  });

  it("⚠⚠ nota SEM competência vai para DESCONHECIDO, jamais para um mês escolhido", async () => {
    const r = await montar(clientDe({ notas: [nota({ competencia: null })] }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)).toHaveLength(0);
    // ⚠ A query já filtra `competencia: { not: null }`, mas a guarda existe porque quem chama pode
    // mudar a query — e aí a nota sem competência entraria num mês inventado.
    expect(r.semMes.filter((s) => s.motivo === SEM_MES.NOTA_SEM_COMPETENCIA).length).toBeLessThanOrEqual(1);
  });

  it("⚠ a população é a definição de faturamento da CASA", async () => {
    const client = clientDe({ notas: [] });
    await montar(client);
    expect(client.portalInvoice.findMany.mock.calls[0][0].where)
      .toMatchObject({ papel: "EMIT", statusEfetivo: "autorizada" });
  });

  it("⚠ nota cujo recebimento cairia ANTES do mês corrente não entra", async () => {
    const velha = nota({ competencia: new Date("2026-01-01T00:00:00.000Z") });
    const r = await montar(clientDe({ notas: [velha] }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 4 e 5 · AS SÉRIES MARCADAS
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ só a série MARCADA entra no fluxo", () => {
  /**
   * ⚠⚠ ESTE TESTE PEDIA `where.estado === ATIVA` ATÉ 29/08/2026, e o critério passou a ser o par
   * (estado, origem) — ver `serieEntraNoFluxo` em `SerieRecorrenteService.js`.
   *
   * O que ele protegia continua protegido, e está afirmado abaixo: a série DETECTADA e ainda
   * PENDENTE **não** entra. O que passou a entrar é a que o CLIENTE declarou, porque ela é a saída
   * dele — *"apenas para visualização deles"*.
   */
  it("⚠⚠ a query NÃO reescreve o critério — ela usa o `WHERE` compartilhado", async () => {
    const client = clientDe({ series: [] });
    await montar(client);
    const where = client.serieRecorrente.findMany.mock.calls[0][0].where;
    // ⚠ A asserção é sobre o OBJETO compartilhado, não sobre uma cópia com a mesma forma: é a
    // reescrita que se quer impedir, e uma cópia idêntica hoje diverge na primeira correção.
    expect(where.OR).toBe(WHERE_SERIE_NO_FLUXO.OR);
    expect(where.estado).toBeUndefined();
  });

  it("⚠⚠ a série DETECTADA e pendente continua FORA — a decisão de 25/08 não foi tocada", () => {
    expect(serieEntraNoFluxo({ estado: "PENDENTE", origem: "DETECTADA" })).toBe(false);
  });

  it("⚠ a série MENSAL enche a janela DA FRENTE — não os 12 meses da tabela", async () => {
    const r = await montar(clientDe({ series: [serie()] }));
    // ⚠⚠ OITO, não doze — e a diferença é a janela. Ela tem 12 linhas, mas 4 delas olham para
    // TRÁS: uma recorrência não se projeta sobre meses que já aconteceram. Projetar 12 à frente
    // jogaria as 4 últimas para fora da tabela, engordando `foraDoHorizonte` com linhas que ninguém
    // pediu — e `foraDoHorizonte` existe para contar o que se PERDEU.
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(8);
    expect(linhasDe(r, FONTE.SERIE_DESPESA)[0].competencia).toBe(CICLO);
  });

  it("⚠ a ANUAL entra UMA vez — o ritmo é o dela, não o do calendário", async () => {
    const r = await montar(clientDe({ series: [serie({ periodicidade: "ANUAL" })] }));
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(1);
  });

  it("⚠ a TRIMESTRAL entra a cada três meses", async () => {
    const r = await montar(clientDe({ series: [serie({ periodicidade: "TRIMESTRAL" })] }));
    // ⚠ Três: ago, nov e fev. O ritmo é o da série; o teto é o fim da janela.
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(3);
  });

  it("⚠⚠ o valor é a MEDIANA, e a FAIXA viaja junto", async () => {
    const r = await montar(clientDe({ series: [serie()] }));
    const l = linhasDe(r, FONTE.SERIE_DESPESA)[0];
    expect(l.valor).toBe(130);
    expect(l.base.min).toBe(120);
    expect(l.base.max).toBe(140);
    expect(l.base.n).toBe(3);
  });

  it("⚠⚠ com declarado E observado, o OBSERVADO VENCE — decisão do dono", async () => {
    const r = await montar(clientDe({ series: [serie({ valorDeclarado: "1000.00" })] }));
    const l = linhasDe(r, FONTE.SERIE_DESPESA)[0];
    expect(l.valor).toBe(130);
    // ⚠ Os dois viajam: a tela mostra o confronto.
    expect(l.base.valorDeclarado).toBe(1000);
    expect(l.base.valorObservado).toBe(130);
  });

  it("⚠ sem observação, o DECLARADO vale — é o caso da taxa anual", async () => {
    const declarada = serie({ valorDeclarado: "1200.00", baseDaObservacao: null, periodicidade: "ANUAL" });
    const r = await montar(clientDe({ series: [declarada] }));
    expect(linhasDe(r, FONTE.SERIE_DESPESA)[0].valor).toBe(1200);
  });

  it("⚠⚠ série SEM valor nenhum não vira linha muda — sai NOMEADA", async () => {
    const r = await montar(clientDe({ series: [serie({ valorDeclarado: null, baseDaObservacao: null })] }));
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(0);
    expect(r.semMes.some((s) => s.motivo === SEM_MES.SERIE_SEM_VALOR)).toBe(true);
  });

  it("⚠ RECEITA é ENTRADA; DESPESA é SAÍDA", async () => {
    const r = await montar(clientDe({ series: [serie({ lado: LADO.RECEITA })] }));
    expect(linhasDe(r, FONTE.SERIE_RECEITA)[0].direcao).toBe(DIRECAO.ENTRADA);
  });

  it("⚠⚠ sem a tabela, o fluxo CONTINUA — e diz que a previsão por recorrência não existe", async () => {
    const p2021 = Object.assign(new Error("x"), { code: "P2021" });
    const r = await montar(clientDe({ guias: [guia()], erroNaSerie: p2021 }));
    expect(r.recorrenciaIndisponivel).toBe(true);
    expect(doMes(r, "2026-08").linhas).toHaveLength(1);
  });

  it("⚠ erro que NÃO é P2021 sobe — engolir tudo esconderia defeito de verdade", async () => {
    const outro = Object.assign(new Error("conexão caiu"), { code: "P1001" });
    await expect(montar(clientDe({ erroNaSerie: outro }))).rejects.toThrow(/conexão caiu/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 6 · O IMPOSTO PROJETADO
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o imposto projetado", () => {
  it("é receita prevista × alíquota efetiva do último mês apurado", async () => {
    const r = await montar(clientDe({ notas: [nota()], snapshot: apuracao() }));
    const l = linhasDe(r, FONTE.IMPOSTO_PROJETADO)[0];
    // 8000 × 0,06
    expect(l.valor).toBeCloseTo(480, 6);
    expect(l.direcao).toBe(DIRECAO.SAIDA);
    expect(l.procedencia).toBe(PROCEDENCIA.PREVISAO);
  });

  it("⚠⚠ o rótulo NUNCA diz 'imposto calculado', e a frase NOMEIA o mês da alíquota", async () => {
    const r = await montar(clientDe({ notas: [nota()], snapshot: apuracao() }));
    const l = linhasDe(r, FONTE.IMPOSTO_PROJETADO)[0];
    expect(l.rotulo).toMatch(/previsto/i);
    expect(l.rotulo).not.toMatch(/calculado|DAS/i);
    expect(l.base.frase).toMatch(/com base na alíquota de 2026-06/);
  });

  it("⚠⚠ SEM apuração NÃO há linha — e a ausência é NOMEADA", async () => {
    const r = await montar(clientDe({ notas: [nota()], snapshot: null }));
    expect(linhasDe(r, FONTE.IMPOSTO_PROJETADO)).toHaveLength(0);
    expect(r.semImposto.motivo).toBe(SEM_IMPOSTO.SEM_APURACAO);
    expect(r.semImposto.frase).toMatch(/alíquota que ninguém mediu/i);
  });

  it("⚠ sem receita prevista, a ausência tem OUTRO motivo", async () => {
    const r = await montar(clientDe({ guias: [guia()], snapshot: apuracao() }));
    expect(r.semImposto.motivo).toBe(SEM_IMPOSTO.SEM_RECEITA_PROJETADA);
  });

  it("⚠⚠ A GUIA REAL SUBSTITUI A PROJEÇÃO DO MESMO MÊS — as duas nunca coexistem", async () => {
    // Sem isto o mesmo imposto aparece duas vezes no mesmo mês e o contador provisiona o dobro.
    const notaDeJulho = nota({ competencia: new Date("2026-07-01T00:00:00.000Z") });
    const r = await montar(clientDe({ guias: [guia()], notas: [notaDeJulho], snapshot: apuracao() }));
    const agosto = doMes(r, "2026-08");
    expect(agosto.linhas.some((l) => l.fonte === FONTE.GUIA)).toBe(true);
    expect(agosto.linhas.some((l) => l.fonte === FONTE.IMPOSTO_PROJETADO)).toBe(false);
  });

  it("⚠ e a projeção fica nos meses SEM guia", async () => {
    const r = await montar(clientDe({ guias: [guia()], notas: [nota()], snapshot: apuracao() }));
    // a nota de agosto projeta recebimento em setembro, e não há guia lá
    expect(doMes(r, "2026-09").linhas.some((l) => l.fonte === FONTE.IMPOSTO_PROJETADO)).toBe(true);
  });

  it("⚠ a alíquota usada viaja no payload, com a frase", async () => {
    const r = await montar(clientDe({ notas: [nota()], snapshot: apuracao() }));
    expect(r.aliquotaUsada.competencia).toBe("2026-06");
    expect(r.aliquotaUsada.frase).toMatch(/com base na alíquota/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A FOLHA — coluna própria (v3 §3.2), com a simplificação declarada do dono.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a folha do fluxo é o PAGAMENTO, não a provisão", () => {
  /**
   * ⚠⚠ ESTE BLOCO DIZIA O CONTRÁRIO ATÉ 30/08/2026, e o que o virou foram as partidas dobradas
   * REAIS de uma empresa (ERISANGELA), lidas em produção:
   *
   * ```
   * 30/07  VR REF PRO LAB FP 07/2026   D 426 (PRO LABORE)  1.621,00   ← provisão do BRUTO
   * 30/07  VR REF INSS S/PRO LAB       C 240                 178,31   ← INSS retido
   * 30/07  VR PRO LAB LIQ              C 233               1.442,69   ← líquido a pagar
   * 05/08  PAGO PRO-LAB 07/2026        D 233 / C 5         1.442,69   ← O DINHEIRO SAI AQUI
   * ```
   *
   * A coluna mostrava o **D 426 de 1.621,00** na competência da PROVISÃO. Dono: *"você me coloca
   * pró-labore com o INSS junto, valor de 1.621,00, quando são coisas separadas: pró-lab é 1.442,69
   * e INSS 178,31"* · *"se eu provisiono isso em julho eu vou pagar em agosto, deve aparecer em
   * agosto"* · *"as confirmações para o fluxo saem do código 5, que é caixa"*.
   *
   * ⚠⚠ E o erro mais caro era a CONTAGEM DUPLA: os 178,31 de INSS retido estavam dentro dos
   * 1.621,00 **e** também na coluna Impostos, como guia.
   *
   * ⚠ `derivarFolha12m` (a leitura por PROVISÃO) não foi tocada: ela serve o **Fator R**, onde o
   * número certo é o bruto. São duas perguntas sobre o mesmo lançamento.
   */
  const CAIXA = { codigo: "5", codigoCompleto: "111010001", portalClientId: null };
  const DESPESA = { codigo: "426", codigoCompleto: "411010001", portalClientId: null };

  /** A provisão: débito na despesa, crédito no passivo. ⚠ NÃO toca o caixa — logo não é fluxo. */
  const provisao = (competencia, data, valor = "1621.00") => ({
    competencia,
    data: new Date(`${data}T00:00:00.000Z`),
    historico: `VR REF PRO LAB FP ${competencia}`,
    lines: [{ tipo: "D", valor, conta: "426" }, { tipo: "C", valor, conta: "233" }],
  });

  /** O pagamento: baixa o passivo e CREDITA O CAIXA. É ele que é fluxo de caixa. */
  const pagamento = (competencia, data, valor = "1442.69") => ({
    competencia,
    data: new Date(`${data}T00:00:00.000Z`),
    historico: `PAGO PRO-LAB ${competencia}`,
    lines: [{ tipo: "D", valor, conta: "233" }, { tipo: "C", valor, conta: "5" }],
  });

  const comFolha = (folhas) => clientDe({ folhas, contasDeFolha: [CAIXA, DESPESA] });

  it("⚠⚠ a linha sai do PAGAMENTO, com o valor que saiu do caixa — nunca o bruto provisionado", async () => {
    const r = await montar(comFolha([provisao("2026-07", "2026-07-30"), pagamento("2026-07", "2026-08-05")]));
    const l = doMes(r, "2026-08").linhas.find((x) => x.fonte === FONTE.FOLHA);
    expect(l).toBeTruthy();
    // ⚠⚠ 1.442,69 e NÃO 1.621,00: a diferença é o INSS retido, que sai pela GUIA e já está em Impostos.
    expect(l.valor).toBe(1442.69);
    expect(l.direcao).toBe(DIRECAO.SAIDA);
  });

  it("⚠⚠ ela cai no mês do PAGAMENTO, não no da provisão", async () => {
    // Provisão em julho, pagamento em agosto ⇒ a linha é de AGOSTO. Fluxo de caixa é quando o
    // dinheiro sai, não quando a despesa é reconhecida.
    const r = await montar(comFolha([provisao("2026-07", "2026-07-30"), pagamento("2026-07", "2026-08-05")]));
    expect(doMes(r, "2026-07").linhas.some((x) => x.fonte === FONTE.FOLHA)).toBe(false);
    expect(doMes(r, "2026-08").linhas.some((x) => x.fonte === FONTE.FOLHA)).toBe(true);
  });

  it("⚠⚠ ela TEM DIA — e era exatamente isto que faltava", async () => {
    // Dono: *"valores de previsibilidade estão em data nenhuma"* · *"se o último pagamento foi feito
    // dia 16, eu provisiono para dia 16"*. O lançamento de pagamento tem data; a coluna a ignorava.
    const r = await montar(comFolha([pagamento("2026-07", "2026-08-05")]));
    const l = doMes(r, "2026-08").linhas.find((x) => x.fonte === FONTE.FOLHA);
    expect(l.dia).toBe(5);
    expect(l.diaDesconhecido).toBeNull();
  });

  it("⚠⚠ é FATO, e agora sem simplificação nenhuma — a partida dobrada é a prova", async () => {
    // Antes a coluna dizia FATO por uma SUPOSIÇÃO declarada ("folha lançada conta como paga").
    // Hoje o crédito em caixa É o pagamento; não há o que supor.
    const r = await montar(comFolha([pagamento("2026-07", "2026-08-05")]));
    const l = doMes(r, "2026-08").linhas.find((x) => x.fonte === FONTE.FOLHA);
    expect(l.procedencia).toBe(PROCEDENCIA.FATO);
    expect(l.base.simplificacao).toBeUndefined();
    expect(l.base.saidaDeCaixa).toBe(true);
  });

  it("⚠⚠ a PROVISÃO sozinha não vira linha — ela não tocou o caixa", async () => {
    const r = await montar(comFolha([provisao("2026-07", "2026-07-30")]));
    expect(linhasDe(r, FONTE.FOLHA)).toEqual([]);
  });

  it("⚠⚠ quem diz que a conta é caixa é o `codigoCompleto`, NUNCA o reduzido", async () => {
    // O reduzido `5` é CAIXA; o COMPLETO `5` é IRPJ/CSLL. 41 contas do plano têm os dois em grupos
    // diferentes. Com um plano em que o reduzido 5 aponta para uma conta que NÃO é disponibilidade,
    // o crédito deixa de ser fluxo.
    const naoEhCaixa = { codigo: "5", codigoCompleto: "411050001", portalClientId: null };
    const r = await montar(clientDe({
      folhas: [pagamento("2026-07", "2026-08-05")],
      contasDeFolha: [naoEhCaixa, DESPESA],
    }));
    expect(linhasDe(r, FONTE.FOLHA)).toEqual([]);
  });

  it("⚠ o BANCO também é caixa — não é só a conta 5", async () => {
    const banco = { codigo: "7", codigoCompleto: "111020003", portalClientId: null };
    const pagoPeloBanco = {
      competencia: "2026-07",
      data: new Date("2026-08-05T00:00:00.000Z"),
      historico: "PAGO PRO-LAB 07/2026",
      lines: [{ tipo: "D", valor: "1442.69", conta: "233" }, { tipo: "C", valor: "1442.69", conta: "7" }],
    };
    const r = await montar(clientDe({ folhas: [pagoPeloBanco], contasDeFolha: [banco, DESPESA] }));
    expect(doMes(r, "2026-08").linhas.find((x) => x.fonte === FONTE.FOLHA).valor).toBe(1442.69);
  });

  it("⚠ o histórico NÃO decide — texto livre não é dado", async () => {
    // Um lançamento renomeado deixaria de ser visto se a regra lesse "PAGO". A autoridade é a
    // partida dobrada.
    const semPalavraPago = { ...pagamento("2026-07", "2026-08-05"), historico: "TRANSFERENCIA SOCIO" };
    const r = await montar(comFolha([semPalavraPago]));
    expect(doMes(r, "2026-08").linhas.find((x) => x.fonte === FONTE.FOLHA).valor).toBe(1442.69);
  });

  it("⚠ dois pagamentos no mesmo mês viram duas linhas — a soma é da célula, não da regra", async () => {
    const r = await montar(comFolha([
      pagamento("2026-07", "2026-08-05"),
      pagamento("2026-08", "2026-08-30"),
    ]));
    expect(doMes(r, "2026-08").linhas.filter((x) => x.fonte === FONTE.FOLHA)).toHaveLength(2);
  });

  it("⚠⚠ sem pagamento nenhum, a COLUNA não existe — decisão do SERVIDOR, não da tela", async () => {
    const r = await montar(clientDe({}));
    expect(r.folha.disponivel).toBe(false);
    expect(linhasDe(r, FONTE.FOLHA)).toEqual([]);
  });
});

describe("⚠ o horizonte e o ciclo", () => {
  it("⚠⚠ 12 meses, e a janela começa 4 meses ATRÁS do ciclo — não no ciclo", async () => {
    // ⚠⚠ ISTO INVERTE *"12 meses, começando no ciclo pedido"*. `SPEC-fluxo-de-caixa-v3.md` §3.1:
    // *"Sempre 12 meses. Posição padrão: 4 meses passados + mês corrente + 7 futuros."*
    // ⚠ O total NÃO mudou: o que mudou é onde a janela começa. E ela só é legível por causa da
    // Lei 1 — sem a guia PAGA no payload, esses quatro meses viriam vazios.
    const r = await montar(clientDe({ guias: [guia()] }));
    expect(r.meses).toHaveLength(12);
    expect(r.meses[0].competencia).toBe("2026-04");
    expect(r.meses[4].competencia).toBe(CICLO);
    expect(r.meses[11].competencia).toBe("2027-03");
  });

  it("⚠⚠ o CICLO e a JANELA são duas coisas — eram uma só, e por isso o ciano se perdia", async () => {
    // Pedir um mês passado movia os dois juntos: a tabela recuava **e** o mês pintado como "hoje"
    // recuava com ela. Hoje `cicloAtual` responde *"que dia é hoje?"* e `janelaInicio` responde
    // *"onde a tabela começa?"*.
    const r = await montar(clientDe({ guias: [guia()] }), { janelaInicio: "2026-02" });
    expect(r.meses[0].competencia).toBe("2026-02");
    expect(r.cicloAtual).toBe(CICLO);
  });

  it("⚠⚠ a janela NÃO recua antes da primeira nota da empresa", async () => {
    // Oferecer janeiro a uma empresa aberta em março afirmaria que ela faturou zero num mês em que
    // ela não existia. O limite é dado, não invenção.
    const r = await montar(
      clientDe({ guias: [guia()], primeiraNota: { competencia: new Date("2026-03-01T00:00:00.000Z") } }),
      { janelaInicio: "2025-01" },
    );
    expect(r.meses[0].competencia).toBe("2026-03");
    expect(r.janela.podeVoltar).toBe(false);
  });

  it("⚠ para a FRENTE a janela trava na posição padrão — não existe futuro além de corrente+7", async () => {
    const r = await montar(clientDe({ guias: [guia()] }), { janelaInicio: "2026-12" });
    expect(r.meses[0].competencia).toBe("2026-04");
    expect(r.janela.podeAvancar).toBe(false);
  });

  it("⚠ o ciclo é INJETADO — sem ele, o mês corrente, e ele volta explícito", async () => {
    const r = await montarFluxoDeCaixa({ portalClientId: "emp-1", client: clientDe({}) });
    expect(r.cicloAtual).toMatch(/^\d{4}-\d{2}$/);
    expect(r.cicloAtual).toBe(cicloDeHoje());
  });

  /**
   * ⚠⚠ ESTE TESTE EXIGIA O OPOSTO ATÉ 29/08/2026 — *"a coluna do prazo está no `select` EXPLÍCITO,
   * fora dele volta `undefined` sem erro"*. Ele guardava a armadilha do `select` explícito, que
   * este projeto já pagou três vezes.
   *
   * ⚠ A armadilha continua real; o que mudou é que **esta coluna deixou de ser lida**, porque o
   * prazo por empresa saiu (a receita cai sempre no dia 1 do mês seguinte). Ela sai do `select` por
   * decisão, e o teste inverteu de lado junto — senão ele guardaria uma leitura que não existe.
   */
  it("⚠⚠ a coluna do prazo NÃO é mais pedida — e isso é o que a tira do caminho do P2022", async () => {
    const client = clientDe({ prazo: 2 });
    await montar(client);
    const sel = client.portalClient.findUnique.mock.calls[0][0].select;
    expect(sel).not.toHaveProperty("prazoRecebimentoMeses");
    // ⚠ O `select` continua EXPLÍCITO — o que se recusa é a coluna, não a disciplina.
    expect(sel).toHaveProperty("id", true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS SAÍDAS QUE O CLIENTE ACRESCENTOU — e a PENDENTE aparece (29/08/2026).
//
// > Dono: *"o cliente pode modificar as saídas, podendo colocar novas saídas, **apenas para
// > visualização deles**"*.
//
// ⚠⚠ **A PRIMEIRA VERSÃO DESTA LEITURA FILTRAVA SÓ `CONFIRMADA`, E ISSO CONTRADIZIA O PEDIDO EM UMA
// PALAVRA:** o cliente digitava e não via nada até o contador conferir. Uma linha que o autor dela
// não enxerga não é visualização nenhuma. A conferência nunca foi o portão da VISUALIZAÇÃO — ela é
// como o contador fica sabendo, e como a linha vira lançamento (Fase 6).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a saída do cliente entra no fluxo", () => {
  const saida = (extra = {}) => ({
    id: "sa-1", data: new Date("2026-09-10T00:00:00.000Z"), valor: "3000.00",
    descricao: "Reforma da sala", estado: "PENDENTE", ...extra,
  });

  it("⚠⚠ PENDENTE aparece — é o conserto do defeito acima", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida()] }));
    const linhas = linhasDe(r, FONTE.SAIDA_DO_CLIENTE);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].rotulo).toBe("Reforma da sala");
    expect(linhas[0].competencia).toBe("2026-09");
  });

  it("CONFIRMADA também", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida({ estado: "CONFIRMADA" })] }));
    expect(linhasDe(r, FONTE.SAIDA_DO_CLIENTE)).toHaveLength(1);
  });

  it("⚠⚠ RECUSADA NÃO — é o que dá sentido à recusa do contador", async () => {
    // Ele dizer "isto não é despesa desta empresa" tem de tirar a linha da tela; senão a decisão
    // dele não faz nada, e o cliente continua planejando com um número que foi negado.
    const r = await montar(clientDe({ saidasDoCliente: [saida({ estado: "RECUSADA" })] }));
    expect(linhasDe(r, FONTE.SAIDA_DO_CLIENTE)).toHaveLength(0);
  });

  it("⚠⚠ ela é SEMPRE previsão — o cliente planejou, ninguém pagou", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida({ estado: "CONFIRMADA" })] }));
    expect(linhasDe(r, FONTE.SAIDA_DO_CLIENTE)[0].procedencia).toBe(PROCEDENCIA.PREVISAO);
  });

  it("⚠ o DIA é o que a pessoa escreveu — não é precisão fabricada", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida()] }));
    const l = linhasDe(r, FONTE.SAIDA_DO_CLIENTE)[0];
    expect(l.dia).toBe(10);
    expect(l.diaDesconhecido).toBeNull();
  });

  it("⚠⚠ o ESTADO viaja na base — a tela precisa distinguir 'aguardando' de 'conferida'", async () => {
    const pendente = await montar(clientDe({ saidasDoCliente: [saida()] }));
    expect(linhasDe(pendente, FONTE.SAIDA_DO_CLIENTE)[0].base.estadoDaSaida).toBe("PENDENTE");
    expect(linhasDe(pendente, FONTE.SAIDA_DO_CLIENTE)[0].base.frase).toMatch(/não foi conferida/i);

    const conferida = await montar(clientDe({ saidasDoCliente: [saida({ estado: "CONFIRMADA" })] }));
    expect(linhasDe(conferida, FONTE.SAIDA_DO_CLIENTE)[0].base.estadoDaSaida).toBe("CONFIRMADA");
    expect(linhasDe(conferida, FONTE.SAIDA_DO_CLIENTE)[0].base.frase).not.toMatch(/não foi conferida/i);
  });

  it("⚠ a base diz DE QUEM é a linha, e a referência aponta a saída", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida()] }));
    const l = linhasDe(r, FONTE.SAIDA_DO_CLIENTE)[0];
    expect(l.base.doCliente).toBe(true);
    expect(l.referencia).toEqual({ tipo: "saidaAvulsa", id: "sa-1" });
  });

  it("⚠⚠ sem o DELEGATE (o `prisma generate` que não rodou) o fluxo NÃO cai — ele se declara", async () => {
    // No Windows o `generate` falha com EPERM enquanto o servidor de dev segura a DLL do engine.
    // Sem a guarda, `undefined.findMany` derrubaria o fluxo INTEIRO — cards e pop-up junto.
    const r = await montar(clientDe({ guias: [guia()] }));
    expect(r.saidasDoClienteIndisponiveis).toBe(true);
    expect(r.meses.length).toBeGreaterThan(0);
  });

  it("⚠ com o delegate presente, a indisponibilidade some", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [] }));
    expect(r.saidasDoClienteIndisponiveis).toBe(false);
  });
});

describe("⚠⚠⚠ A DESPESA LANÇADA ENTRA NO FLUXO — decisão do dono, 01/09/2026", () => {
  // > *"tudo que virar lançamento deve entrar no fluxo"* … *"nessa linha podemos adicionar a conta
  // > e lançar, **ao lançar entra no fluxo**"*.
  //
  // ⚠⚠ ANTES DISTO A REGRA NÃO VALIA, e foi medição que mostrou: este serviço lia `accountingEntry`
  // **apenas com `tipo: "FOLHA"`**. A despesa que o contador lança na Conferência — o trabalho
  // principal daquela tela — não aparecia no fluxo do cliente em lugar nenhum.

  const CAIXA_C = { codigo: "5", codigoCompleto: "111010001", portalClientId: null };
  const DESPESA_C = { codigo: "401", codigoCompleto: "411020001", portalClientId: null };

  const despesaLancada = (extra = {}) => ({
    competencia: "2026-09",
    historico: "GOOGLE CLOUD BRASIL",
    data: new Date("2026-09-18T00:00:00.000Z"),
    lines: [
      { tipo: "D", valor: "1500.00", conta: "401" },
      { tipo: "C", valor: "1500.00", conta: "5" },
    ],
    ...extra,
  });

  const comDespesa = (despesas) => clientDe({ despesas, contasDeFolha: [CAIXA_C, DESPESA_C] });
  const linhasDeDespesa = (r) => linhasDe(r, "DESPESA_LANCADA");

  it("⚠⚠ ela aparece no fluxo, com fonte própria", async () => {
    const r = await montar(comDespesa([despesaLancada()]));
    expect(linhasDeDespesa(r)).toHaveLength(1);
  });

  it("⚠⚠ como FATO — a partida dobrada prova que o dinheiro saiu", async () => {
    // O lançamento de despesa desta casa é `D despesa / C caixa`: ele AFIRMA a saída do dinheiro.
    // Chamá-lo de previsão faria o dono somá-lo ao que ainda vai acontecer.
    const r = await montar(comDespesa([despesaLancada()]));
    expect(linhasDeDespesa(r)[0].procedencia).toBe("FATO");
  });

  it("⚠ no DIA do lançamento, e é ele que a data do lançamento afirma", async () => {
    const r = await montar(comDespesa([despesaLancada()]));
    const l = linhasDeDespesa(r)[0];
    expect(l.competencia).toBe("2026-09");
    expect(l.dia).toBe(18);
  });

  it("⚠ e como SAÍDA, com o valor da perna que credita caixa", async () => {
    const r = await montar(comDespesa([despesaLancada()]));
    expect(linhasDeDespesa(r)[0].direcao).toBe("SAIDA");
    expect(linhasDeDespesa(r)[0].valor).toBe(1500);
  });

  it("⚠⚠ lançamento que NÃO credita caixa fica de fora — não é saída de dinheiro", async () => {
    // Uma reclassificação entre contas de despesa existe no razão e não tem lugar no fluxo.
    const semCaixa = despesaLancada({
      lines: [
        { tipo: "D", valor: "1500.00", conta: "401" },
        { tipo: "C", valor: "1500.00", conta: "401" },
      ],
    });
    const r = await montar(comDespesa([semCaixa]));
    expect(linhasDeDespesa(r)).toHaveLength(0);
  });

  it("⚠⚠ quem diz que a conta é CAIXA é o `codigoCompleto`, nunca o reduzido", async () => {
    // O reduzido `5` é CAIXA enquanto o COMPLETO `5` é IRPJ/CSLL — 41 contas do plano têm os dois
    // apontando para grupos diferentes, e trocar inverte despesa com imposto sem erro nenhum.
    const naoEhCaixa = { codigo: "5", codigoCompleto: "5", portalClientId: null };
    const r = await montar(clientDe({
      despesas: [despesaLancada()],
      contasDeFolha: [naoEhCaixa, DESPESA_C],
    }));
    expect(linhasDeDespesa(r)).toHaveLength(0);
  });

  it("⚠⚠ a FOLHA não é lida como despesa — são duas perguntas diferentes", async () => {
    // O dublê filtra por `tipo` de propósito: sem isso, a folha apareceria também como despesa e o
    // mesmo dinheiro seria contado duas vezes, com o teste passando.
    const r = await montar(clientDe({
      folhas: [despesaLancada({ historico: "PAGO PRO-LAB 08/2026" })],
      despesas: [],
      contasDeFolha: [CAIXA_C, DESPESA_C],
    }));
    expect(linhasDeDespesa(r)).toHaveLength(0);
  });

  it("⚠ a frase da linha traz o histórico do razão, cru", async () => {
    // É o nome do fornecedor — é ele que faz o cliente reconhecer a linha.
    const r = await montar(comDespesa([despesaLancada()]));
    expect(linhasDeDespesa(r)[0].base.frase).toMatch(/GOOGLE CLOUD BRASIL/);
  });
});

describe("⚠⚠⚠ e a saída LANCADA sai do fluxo — senão o mesmo dinheiro conta duas vezes", () => {
  // ⚠ O aviso que pedia isto foi escrito no MESMO dia, horas antes: quando `LANCADA` entrou na
  // lista, despesa ainda não alimentava o fluxo e tirá-la a faria SUMIR da tela do cliente. Agora o
  // lançamento dela é uma linha por direito próprio.
  const saida = (estado) => ({
    id: "sa-1", data: new Date("2026-09-18T00:00:00.000Z"), valor: "3500.00",
    descricao: "Reforma da sala", estado,
  });
  const doCliente = (r) => linhasDe(r, "SAIDA_DO_CLIENTE");

  it("PENDENTE e CONFIRMADA continuam entrando", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida("PENDENTE"), saida("CONFIRMADA")] }));
    expect(doCliente(r)).toHaveLength(2);
  });

  it("⚠⚠ LANCADA não entra mais — quem a representa agora é o lançamento", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida("LANCADA")] }));
    expect(doCliente(r)).toHaveLength(0);
  });

  it("⚠ e RECUSADA segue fora, como sempre esteve", async () => {
    const r = await montar(clientDe({ saidasDoCliente: [saida("RECUSADA")] }));
    expect(doCliente(r)).toHaveLength(0);
  });

  it("⚠⚠ a linha NÃO some da tela: ela troca de fonte, de PREVISÃO para FATO", async () => {
    // É a leitura que o cliente faz: "você acrescentou" vira "despesa lançada". Some a previsão,
    // aparece o fato — e o total do mês não muda de tamanho por causa disso.
    const r = await montar(clientDe({
      saidasDoCliente: [saida("LANCADA")],
      despesas: [{
        competencia: "2026-09",
        historico: "Reforma da sala",
        data: new Date("2026-09-18T00:00:00.000Z"),
        lines: [
          { tipo: "D", valor: "3500.00", conta: "401" },
          { tipo: "C", valor: "3500.00", conta: "5" },
        ],
      }],
      contasDeFolha: [
        { codigo: "5", codigoCompleto: "111010001", portalClientId: null },
        { codigo: "401", codigoCompleto: "411020001", portalClientId: null },
      ],
    }));
    expect(doCliente(r)).toHaveLength(0);
    const lancadas = linhasDe(r, "DESPESA_LANCADA");
    expect(lancadas).toHaveLength(1);
    expect(lancadas[0].valor).toBe(3500);
    expect(lancadas[0].procedencia).toBe("FATO");
  });
});

describe("⚠⚠⚠ SÓ O QUE FOI LANÇADO É SAÍDA DE DESPESA NO FLUXO — regra do dono, 01/09/2026", () => {
  // > *"só entra no fluxo aquilo que for lançado, ou seja as saídas do fluxo são as despesas
  // > lançadas, o resto do fluxo continua como está"*.
  //
  // ⚠⚠ ESTE BLOCO MEDIA A `DESPESA_PREVISTA` — o que o contador liberava no fluxo SEM lançar. Ela
  // nasceu e morreu no mesmo dia: a regra acima a tornou sem sentido. Não é um contribuinte que
  // sumiu, é a pergunta que ele respondia que deixou de ser feita.
  //
  // ⚠ O RESTO DO FLUXO NÃO FOI TOCADO: guias, notas, séries, imposto, folha e as saídas do cliente
  // continuam entrando como sempre entraram.

  it("⚠⚠ não existe mais fonte de despesa PREVISTA — só a lançada", async () => {
    const r = await montar(clientDe({ previstas: [{
      id: "dec-1",
      previstoNoFluxoEm: new Date("2026-09-25T00:00:00.000Z"),
      valor: "1500.00",
      valorAjustado: null,
      descricaoOriginal: "GOOGLE CLOUD BRASIL",
    }] }));
    expect(linhasDe(r, "DESPESA_PREVISTA")).toHaveLength(0);
  });

  it("⚠⚠ e nem a coluna existe mais — ela foi APAGADA do banco em 02/09/2026", async () => {
    // ⚠⚠ A lápide durou um dia: `previstoNoFluxoEm` saiu do schema por decisão do dono, depois de
    // medido que estava VAZIA (0 preenchidas em 38 linhas) e sem leitor nem escritor.
    // ⚠ O caso FICA mesmo sem a coluna: ele prova que o fluxo não tem fonte de despesa PREVISTA —
    // e isso continua sendo verdade a ser defendida, com coluna ou sem ela.
    const cliente = clientDe({ previstas: [] });
    const r = await montar(cliente);
    expect(linhasDe(r, "DESPESA_PREVISTA")).toHaveLength(0);
    expect(cliente.lancamentoDeclarado.findMany).not.toHaveBeenCalled();
  });

  it("⚠ o resto do fluxo continua como está — a regra falou só das saídas de despesa", async () => {
    const r = await montar(clientDe({
      guias: [guia()],
      notas: [nota()],
      saidasDoCliente: [{
        id: "sa-1", data: new Date("2026-09-18T00:00:00.000Z"), valor: "3500.00",
        descricao: "Reforma da sala", estado: "PENDENTE",
      }],
    }));
    expect(linhasDe(r, "GUIA").length + linhasDe(r, "NOTA_EMITIDA").length).toBeGreaterThan(0);
    expect(linhasDe(r, "SAIDA_DO_CLIENTE")).toHaveLength(1);
  });
});


// -------------------------------------------------------------------------------------------------
// ⚠⚠⚠ A GUIA SÓ VIRA COMPROMISSO DEPOIS DE LIBERADA (02/09/2026).
//
// > Dono, em três frases da mesma conversa: *"as únicas guias que devem aparecer no portal do
// > cliente são as liberadas pelo contador"* · *"no caso do fluxo a previsão permanece"* · **"só
// > confirmada após a liberação"**.
//
// ⚠⚠ AS TRÊS JUNTAS DESENHAM UMA COISA SÓ, e nenhuma delas sozinha: o fluxo continua contando TODA
// guia (a previsão do imposto não depende de o documento ter sido enviado — decisão de 30/08, que
// fica de pé), mas a liberação decide o PESO da linha. Enquanto o papel não está na mão do cliente,
// aquilo é previsão nossa; depois, é compromisso dele.
//
// ⚠ Isto NÃO é o recorte que caiu em 30/08. Aquele ESCONDIA a guia do fluxo — e era o que fazia o
// número não bater com o portal do contador. Aqui nada some.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠⚠ a liberação decide a PROCEDÊNCIA da guia — nunca se ela existe", () => {
  const linhaDaGuia = (r) => linhasDe(r, "GUIA")[0];

  it("⚠⚠ liberada e em aberto: COMPROMISSO", async () => {
    const r = await montar(clientDe({ guias: [guia({ liberadaCliente: true })] }));
    expect(linhaDaGuia(r).procedencia).toBe("COMPROMISSO");
  });

  it("⚠⚠⚠ NÃO liberada e em aberto: PREVISÃO — o cliente não recebeu o documento", async () => {
    const r = await montar(clientDe({ guias: [guia({ liberadaCliente: false })] }));
    expect(linhaDaGuia(r).procedencia).toBe("PREVISAO");
  });

  it("⚠⚠ e ela CONTINUA NO FLUXO, com o mesmo valor — a previsão permanece", async () => {
    // ⚠⚠ É a diferença para o recorte que caiu em 30/08: lá a guia SUMIA, e o imposto do mês
    // desaparecia da tela do cliente. Aqui ela conta igual; o que muda é como ela é lida.
    const liberada = await montar(clientDe({ guias: [guia({ liberadaCliente: true })] }));
    const nao = await montar(clientDe({ guias: [guia({ liberadaCliente: false })] }));
    expect(linhasDe(nao, "GUIA")).toHaveLength(1);
    expect(linhaDaGuia(nao).valor).toBe(linhaDaGuia(liberada).valor);
    expect(linhaDaGuia(nao).competencia).toBe(linhaDaGuia(liberada).competencia);
  });

  it("⚠⚠ o `where` continua SEM `liberadaCliente` — recorte aqui é o defeito de 30/08", async () => {
    const cliente = clientDe({ guias: [guia()] });
    await montar(cliente);
    const where = cliente.guide.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("liberadaCliente");
  });

  it("⚠⚠⚠ a guia PAGA é FATO mesmo sem liberação — o pagamento é fato consumado", async () => {
    // ⚠ Escondê-la esvaziaria o passado do fluxo, que é o defeito que a Lei 1 consertou em 28/08.
    // O dinheiro saiu; nenhuma decisão de envio desfaz isso.
    const r = await montar(clientDe({
      guias: [guia({
        liberadaCliente: false,
        paymentStatus: "PAID",
        paymentConfirmedAt: new Date("2026-08-10T00:00:00.000Z"),
      })],
    }));
    expect(linhaDaGuia(r).procedencia).toBe("FATO");
  });

  it("⚠⚠⚠ o POP-UP só cobra o que foi liberado", async () => {
    // ⚠⚠ Ele interrompe o cliente dizendo "isto está vencido, veja suas guias" — e leva para a aba
    // Guias, que desde hoje mostra só as liberadas. Cobrar por um documento que a tela seguinte não
    // tem, e que ele nem pode baixar, seria mandá-lo procurar o que não existe para ele.
    const vencida = { vencimento: new Date("2026-08-01T00:00:00.000Z"), paymentStatus: "OVERDUE" };
    const r = await montar(clientDe({
      guias: [
        guia({ id: "g-lib", liberadaCliente: true, ...vencida }),
        guia({ id: "g-nao", liberadaCliente: false, ...vencida }),
      ],
    }));
    const ids = (r.alertaDeGuias?.itens || []).map((i) => i.id);
    expect(ids).toContain("g-lib");
    expect(ids).not.toContain("g-nao");
  });

  it("⚠⚠⚠ a linha DIZ por que é previsão — «Previsto» sozinho seria mentira por omissão", async () => {
    // ⚠⚠ `PROCEDENCIA.PREVISAO` chega à tela do cliente como **"Previsto"**, e o próprio
    // `leituraDoFluxo` do portal avisa: *"chamá-lo de previsão diria que alguém estimou o número, e
    // ninguém estimou"*. Aqui ninguém estimou mesmo — o valor está impresso na guia. O que falta é
    // o documento chegar. Sem esta frase, o cliente leria o número como chute nosso.
    const r = await montar(clientDe({ guias: [guia({ liberadaCliente: false })] }));
    expect(linhaDaGuia(r).base.frase).toMatch(/ainda não liberada pelo seu contador/i);
  });

  it("⚠ e a liberada NÃO carrega essa ressalva — ela não tem o que ressalvar", async () => {
    const r = await montar(clientDe({ guias: [guia({ liberadaCliente: true })] }));
    expect(linhaDaGuia(r).base.frase).not.toMatch(/não liberada/i);
  });

  it("⚠ mas as DUAS continuam somando no fluxo — o pop-up recorta, a previsão não", async () => {
    const vencida = { vencimento: new Date("2026-08-01T00:00:00.000Z"), paymentStatus: "OVERDUE" };
    const r = await montar(clientDe({
      guias: [
        guia({ id: "g-lib", liberadaCliente: true, ...vencida }),
        guia({ id: "g-nao", liberadaCliente: false, ...vencida }),
      ],
    }));
    expect(linhasDe(r, "GUIA")).toHaveLength(2);
  });
});
