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
  numeroParcela: null, parcelamentoId: null, ...extra,
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

function clientDe({ guias = [], notas = [], series = [], snapshot = null, prazo = null, erroNaSerie = null } = {}) {
  return {
    portalClient: { findUnique: jest.fn(async () => ({ id: "emp-1", prazoRecebimentoMeses: prazo })) },
    guide: { findMany: jest.fn(async () => guias) },
    portalInvoice: { findMany: jest.fn(async () => notas) },
    serieRecorrente: {
      findMany: jest.fn(async () => {
        if (erroNaSerie) throw erroNaSerie;
        return series;
      }),
    },
    apuracaoSnapshot: { findFirst: jest.fn(async () => snapshot) },
  };
}

const montar = (client, extra = {}) =>
  montarFluxoDeCaixa({ portalClientId: "emp-1", cicloAtual: CICLO, client, ...extra });

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
    expect(Object.keys(m.totais).sort()).toEqual(["desconhecido", "fato", "previsao"]);
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
// 1 e 2 · AS GUIAS — as duas metades têm PROCEDÊNCIAS diferentes.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a guia COM vencimento é FATO; SEM vencimento é DESCONHECIDO", () => {
  it("com vencimento, ela cai no mês do vencimento, com DIA", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    const l = doMes(r, "2026-08").linhas[0];
    expect(l.procedencia).toBe(PROCEDENCIA.FATO);
    expect(l.direcao).toBe(DIRECAO.SAIDA);
    expect(l.dia).toBe(20);
    expect(l.valor).toBe(1200);
    // ⚠ A guia é a ÚNICA linha deste fluxo que tem dia próprio.
    expect(l.diaDesconhecido).toBeNull();
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
      expect(m.totais.previsao.saida).toBe(0);
    }
  });

  it("⚠ a parcela de parcelamento tem rótulo próprio — não é o DAS do mês", async () => {
    const r = await montar(clientDe({ guias: [guia({ parcelamentoId: "p-1", numeroParcela: 3 })] }));
    expect(doMes(r, "2026-08").linhas[0].rotulo).toMatch(/Parcela 3 de parcelamento/);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ A GUIA VENCIDA — achada exercitando contra o banco REAL, em 27/08/2026.
  //
  // Ela tem vencimento no PASSADO, cai fora dos 12 meses à frente, e ia embora como um número em
  // `foraDoHorizonte`. Mas é **dinheiro que ainda tem de sair** — a linha mais urgente que um fluxo
  // de caixa pode ter, sumindo justamente de quem precisa vê-la.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ a guia VENCIDA não some — ela ganha compartimento próprio, com valor", async () => {
    const vencida = guia({ id: "g-9", vencimento: new Date("2026-07-20T00:00:00.000Z"), valor: "900.00" });
    const r = await montar(clientDe({ guias: [guia(), vencida] }));
    expect(r.vencidas.quantas).toBe(1);
    expect(r.vencidas.valor).toBe(900);
    expect(r.vencidas.linhas[0].referencia.id).toBe("g-9");
  });

  it("⚠⚠ e ela NÃO é empurrada para o mês corrente — vencida é uma condição, não um mês", async () => {
    // Pôr uma guia vencida em julho dentro de agosto seria o sistema escolhendo o mês por ela — a
    // mesma coisa que a guia SEM vencimento tem proibido.
    const vencida = guia({ id: "g-9", vencimento: new Date("2026-07-20T00:00:00.000Z") });
    const r = await montar(clientDe({ guias: [vencida] }));
    expect(doMes(r, "2026-08").linhas).toHaveLength(0);
    expect(doMes(r, "2026-08").totais.fato.saida).toBe(0);
  });

  it("⚠ sem guia vencida, o compartimento vem zerado — e zero é resposta, não ausência", async () => {
    const r = await montar(clientDe({ guias: [guia()] }));
    expect(r.vencidas).toEqual({ quantas: 0, valor: 0, linhas: [] });
  });

  it("⚠ a guia do mês corrente NÃO é vencida, por mais que o dia já tenha passado", async () => {
    // O corte é por MÊS: dizer que a guia do dia 5 deste mês "venceu" exigiria saber que dia é hoje,
    // e o dia de hoje não entra nesta regra — só a competência, que é injetada.
    const r = await montar(clientDe({ guias: [guia({ vencimento: new Date("2026-08-05T00:00:00.000Z") })] }));
    expect(r.vencidas.quantas).toBe(0);
    expect(doMes(r, "2026-08").linhas).toHaveLength(1);
  });

  it("⚠ só o que está LIBERADO e EM ABERTO é consultado", async () => {
    const client = clientDe({ guias: [] });
    await montar(client);
    expect(client.guide.findMany.mock.calls[0][0].where).toMatchObject({
      liberadaCliente: true,
      paymentStatus: { in: ["OPEN", "OVERDUE"] },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3 · A NOTA EMITIDA — a ENTRADA, e ela é PREVISÃO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
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

  it("⚠⚠ MÊS, NÃO DIA — inventar 'dia 10' seria fabricar precisão que ninguém informou", async () => {
    const r = await montar(clientDe({ notas: [nota()] }));
    const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
    expect(l.dia).toBeNull();
    expect(l.diaDesconhecido.frase).toMatch(/contado em meses/i);
  });

  it("⚠⚠ a base NOMEIA a nota — é previsão DOCUMENTAL, não aprendida", async () => {
    const r = await montar(clientDe({ notas: [nota()] }));
    const b = linhasDe(r, FONTE.NOTA_EMITIDA)[0].base;
    expect(b.frase).toMatch(/nota nº 1042/);
    expect(b.frase).toMatch(/competência 2026-08/);
    expect(b.documental).toBe(true);
  });

  it("⚠⚠ 'ninguém configurou' aparece na frase — o padrão não pode passar por decisão", async () => {
    const r = await montar(clientDe({ notas: [nota()], prazo: null }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].base.frase).toMatch(/padrão — ninguém configurou/i);
    expect(r.prazoRecebimento).toEqual({ meses: 1, configurado: false });
  });

  it("⚠ configurado, a frase NÃO diz que é padrão", async () => {
    const r = await montar(clientDe({ notas: [nota()], prazo: 2 }));
    const l = linhasDe(r, FONTE.NOTA_EMITIDA)[0];
    expect(l.competencia).toBe("2026-10");
    expect(l.base.frase).not.toMatch(/padrão/i);
  });

  it("⚠⚠ prazo ZERO é 'recebo à vista', e vale — não cai no padrão", async () => {
    const r = await montar(clientDe({ notas: [nota()], prazo: 0 }));
    expect(linhasDe(r, FONTE.NOTA_EMITIDA)[0].competencia).toBe("2026-08");
    expect(r.prazoRecebimento.configurado).toBe(true);
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

  it("a série MENSAL se repete pelos 12 meses", async () => {
    const r = await montar(clientDe({ series: [serie()] }));
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(12);
  });

  it("⚠ a ANUAL entra UMA vez — o ritmo é o dela, não o do calendário", async () => {
    const r = await montar(clientDe({ series: [serie({ periodicidade: "ANUAL" })] }));
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(1);
  });

  it("⚠ a TRIMESTRAL entra a cada três meses", async () => {
    const r = await montar(clientDe({ series: [serie({ periodicidade: "TRIMESTRAL" })] }));
    expect(linhasDe(r, FONTE.SERIE_DESPESA)).toHaveLength(4);
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

describe("⚠ o horizonte e o ciclo", () => {
  it("12 meses, começando no ciclo pedido", async () => {
    const r = await montar(clientDe({}));
    expect(r.horizonte).toBe(12);
    expect(r.meses).toHaveLength(12);
    expect(r.meses[0].competencia).toBe(CICLO);
  });

  it("⚠ o ciclo é INJETADO — sem ele, o mês corrente, e ele volta explícito", async () => {
    const r = await montarFluxoDeCaixa({ portalClientId: "emp-1", client: clientDe({}) });
    expect(r.cicloAtual).toMatch(/^\d{4}-\d{2}$/);
    expect(r.cicloAtual).toBe(cicloDeHoje());
  });

  it("⚠⚠ a coluna do prazo está no `select` EXPLÍCITO — fora dele volta `undefined` sem erro", async () => {
    const client = clientDe({ prazo: 2 });
    await montar(client);
    expect(client.portalClient.findUnique.mock.calls[0][0].select).toHaveProperty("prazoRecebimentoMeses", true);
  });
});
