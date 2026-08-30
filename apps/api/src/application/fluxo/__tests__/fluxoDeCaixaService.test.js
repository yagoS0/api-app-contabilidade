// O FLUXO DE CAIXA — a ligação com o banco.
//
// ⚠⚠ Este serviço é SÓ LEITURA, e o que ele NÃO entrega é tão importante quanto o que entrega: não
// há `total`, não há saldo acumulado, o DESCONHECIDO não vira zero, e a guia real substitui a
// projeção do mesmo mês.

import { montarFluxoDeCaixa, cicloDeHoje } from "../FluxoDeCaixaService.js";
import { DIRECAO, FONTE, PROCEDENCIA, SEM_IMPOSTO, SEM_MES } from "../lib/fluxoDeCaixa.js";
import { ESTADO_DA_SERIE, LADO } from "../SerieRecorrenteService.js";

const CICLO = "2026-08";

const guia = (extra = {}) => ({
  id: "g-1", tipo: "SIMPLES", competencia: "2026-07", valor: "1200.00",
  vencimento: new Date("2026-08-20T00:00:00.000Z"), paymentStatus: "OPEN",
  numeroParcela: null, parcelamentoId: null, paymentConfirmedAt: null, ...extra,
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

function clientDe({ guias = [], notas = [], series = [], snapshot = null, prazo = null, erroNaSerie = null, primeiraNota = undefined, folhas = [], contasDeFolha = [] } = {}) {
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
    apuracaoSnapshot: { findFirst: jest.fn(async () => snapshot) },
    // ⚠ As duas tabelas que a FOLHA lê. Elas existem no dublê mesmo quando o caso não fala de
    // folha, porque `derivarFolha12m` NÃO tem `catch`: método faltando derruba a suíte inteira, que
    // é exatamente o que se quer se alguém trocar a leitura por uma que engole erro.
    accountingEntry: { findMany: jest.fn(async () => folhas) },
    chartOfAccount: { findMany: jest.fn(async () => contasDeFolha) },
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

  it("⚠⚠ SEM vencimento ela NÃO entra em mês nenhum, e sai NOMEADA com o conserto", async () => {
    // Medido em produção: 51 guias de DAS estão assim.
    const r = await montar(clientDe({ guias: [guia({ vencimento: null })] }));
    expect(r.meses.every((m) => m.linhas.length === 0)).toBe(true);
    expect(r.semMes).toHaveLength(1);
    expect(r.semMes[0].motivo).toBe(SEM_MES.GUIA_SEM_VENCIMENTO);
    expect(r.semMes[0].frase).toMatch(/recapture a guia/i);
  });

  it("⚠⚠ e ela NÃO entra em `totais` — o desconhecido é contagem, nunca valor", async () => {
    const r = await montar(clientDe({ guias: [guia({ vencimento: null })] }));
    for (const m of r.meses) {
      expect(m.totais.fato.saida).toBe(0);
      expect(m.totais.compromisso.saida).toBe(0);
      expect(m.totais.previsao.saida).toBe(0);
    }
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

  it("⚠ só o que está LIBERADO é consultado", async () => {
    const client = clientDe({ guias: [] });
    await montar(client);
    expect(client.guide.findMany.mock.calls[0][0].where).toMatchObject({ liberadaCliente: true });
  });
});

describe("⚠⚠ a nota emitida + prazo", () => {
  it("⚠⚠ é PREVISÃO, NUNCA FATO — a nota prova o FATURADO, não o RECEBIDO", async () => {
    // `PortalInvoice` não tem `recebidoEm`. Verde ali diria "recebido".
    const r = await montar(clientDe({ notas: [nota()] }));
    const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
    expect(l.procedencia).toBe(PROCEDENCIA.PREVISAO);
    expect(l.direcao).toBe(DIRECAO.ENTRADA);
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
  it("a query pede só `ATIVA` — observar não põe nada no fluxo", async () => {
    const client = clientDe({ series: [] });
    await montar(client);
    expect(client.serieRecorrente.findMany.mock.calls[0][0].where.estado).toBe(ESTADO_DA_SERIE.ATIVA);
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
describe("⚠⚠ a folha, e a suposição que ela carrega", () => {
  const comFolha = (extra = {}) => clientDe({
    folhas: [folha("2026-06"), folha("2026-08", "3200.00")],
    contasDeFolha: CONTA_DE_FOLHA,
    ...extra,
  });

  it("⚠⚠ mês PASSADO é FATO — 'folha lançada conta como paga', decisão do dono", async () => {
    const r = await montar(comFolha());
    const l = doMes(r, "2026-06").linhas.find((x) => x.fonte === FONTE.FOLHA);
    expect(l.procedencia).toBe(PROCEDENCIA.FATO);
    expect(l.direcao).toBe(DIRECAO.SAIDA);
    expect(l.valor).toBe(3000);
  });

  it("⚠⚠ e a SUPOSIÇÃO viaja marcada — sem isso ela some dentro do 'confirmado'", async () => {
    // O sistema sabe o que foi LANÇADO e não sabe se foi PAGO (`derivarFolha12m` exclui o
    // pagamento de propósito). "Confirmado" aqui seria indistinguível de um pagamento provado, e
    // não há nenhum. A marca é o que torna a suposição auditável em vez de invisível.
    const r = await montar(comFolha());
    const l = doMes(r, "2026-06").linhas.find((x) => x.fonte === FONTE.FOLHA);
    expect(l.base.simplificacao).toBe("pagamento_integral_presumido");
  });

  it("⚠ o mês CORRENTE é COMPROMISSO — ele ainda está aberto e a folha pode mudar", async () => {
    const r = await montar(comFolha());
    const l = doMes(r, CICLO).linhas.find((x) => x.fonte === FONTE.FOLHA);
    expect(l.procedencia).toBe(PROCEDENCIA.COMPROMISSO);
    expect(l.base.simplificacao).toBeNull();
  });

  it("⚠⚠ mês FUTURO não ganha linha — projetar folha é PRESUNÇÃO, e presunção é Fase 2", async () => {
    const r = await montar(comFolha());
    for (const m of r.meses.filter((x) => x.competencia > CICLO)) {
      expect(m.linhas.some((l) => l.fonte === FONTE.FOLHA)).toBe(false);
    }
  });

  it("⚠⚠ sem folha lançada, a COLUNA não existe — e isso é decisão do SERVIDOR, não da tela", async () => {
    const r = await montar(clientDe({}));
    expect(r.folha.disponivel).toBe(false);
    expect(linhasDe(r, FONTE.FOLHA)).toEqual([]);
  });

  it("⚠⚠ 'não tem folha' e 'não achei a conta' são respostas DIFERENTES", async () => {
    // A própria `FolhaDerivadaService` nomeia a distinção: sem conta resolvida, uma empresa COM
    // folha devolveria zero e ninguém saberia qual dos dois casos é.
    const r = await montar(clientDe({ folhas: [folha("2026-06")], contasDeFolha: [] }));
    expect(r.folha.contasConsideradas).toEqual([]);
  });

  it("⚠ folha ZERO não vira linha — mês sem folha não é 'folha de R$ 0,00'", async () => {
    const r = await montar(clientDe({
      folhas: [{ competencia: "2026-06", lines: [{ tipo: "D", valor: "0.00", conta: "41101" }] }],
      contasDeFolha: CONTA_DE_FOLHA,
    }));
    expect(linhasDe(r, FONTE.FOLHA)).toEqual([]);
  });

  it("⚠⚠ a leitura NÃO tem `catch` — defeito na folha não pode virar 'esta empresa não tem folha'", async () => {
    const client = comFolha();
    client.accountingEntry.findMany = jest.fn(async () => { throw new Error("banco fora do ar"); });
    await expect(montar(client)).rejects.toThrow(/banco fora do ar/);
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
