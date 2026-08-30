// A LIGAÇÃO DO DETECTOR COM O BANCO.
//
// ⚠⚠ O que mais importa aqui é a SEPARAÇÃO: observar não grava, e só a marcação do contador põe a
// linha no fluxo de caixa. Um serviço que gravasse a observação faria a tela mostrar um FATO onde
// há uma SUGESTÃO — e é essa distinção que o desenho inteiro existe para manter.

import {
  ESTADO_DA_SERIE,
  ESTADOS_NO_FLUXO,
  FORA_DO_ALCANCE,
  LADO,
  ORIGEM_DA_SERIE,
  RECUSA_DA_SERIE,
  cicloDeHoje,
  listarSeries,
  marcarSerie,
  paraTela,
  registrarSaidaSugerida,
} from "../SerieRecorrenteService.js";
import { LEITURA, PERIODICIDADE } from "../lib/recorrencia.js";

const AGORA = new Date("2026-08-27T12:00:00.000Z");

/** Uma nota como o Prisma a devolve: `competencia` é `DateTime`, `total` é `Decimal`. */
const nota = (extra = {}) => ({
  clientId: "emp-1",
  competencia: new Date("2026-07-01T00:00:00.000Z"),
  total: "130.00",
  statusEfetivo: "autorizada",
  status: "EMITIDA",
  tomadorDoc: null,
  tomadorNome: null,
  emitenteDoc: null,
  emitenteNome: null,
  ...extra,
});

const emitida = (mes, extra = {}) =>
  nota({
    competencia: new Date(`2026-${String(mes).padStart(2, "0")}-01T00:00:00.000Z`),
    tomadorDoc: "11222333000181",
    tomadorNome: "CLIENTE ALFA",
    ...extra,
  });

const recebida = (mes, extra = {}) =>
  nota({
    competencia: new Date(`2026-${String(mes).padStart(2, "0")}-01T00:00:00.000Z`),
    emitenteDoc: "98765432000155",
    emitenteNome: "ANTHROPIC BRASIL",
    ...extra,
  });

/**
 * ⚠ O dublê devolve as notas conforme o `papel` do `where` — sem isso os dois lados receberiam a
 * mesma lista e o teste provaria a coisa errada.
 */
function clientDe({ emitidas = [], recebidas = [], marcadas = [], declaradosOfx = 0, erroNaTabela = null } = {}) {
  const escritas = [];
  return {
    escritas,
    client: {
      portalInvoice: {
        findMany: jest.fn(async (args) => (args?.where?.papel === "DEST" ? recebidas : emitidas)),
      },
      lancamentoDeclarado: { count: jest.fn(async () => declaradosOfx) },
      serieRecorrente: {
        findMany: jest.fn(async () => {
          if (erroNaTabela) throw erroNaTabela;
          return marcadas;
        }),
        findUnique: jest.fn(async ({ where }) => {
          const k = where.portalClientId_lado_chave;
          return marcadas.find((m) => m.lado === k.lado && m.chave === k.chave) || null;
        }),
        upsert: jest.fn(async (args) => {
          escritas.push(args);
          if (erroNaTabela) throw erroNaTabela;
          return { id: "s-1", ...args.create, ...args.update };
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    },
  };
}

const ler = (client, extra = {}) =>
  listarSeries({ portalClientId: "emp-1", cicloAtual: "2026-08", client, ...extra });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ OBSERVAR NÃO GRAVA — é o eixo do módulo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a leitura é SÓ LEITURA", () => {
  it("nenhum método de escrita é chamado ao listar", async () => {
    const { client } = clientDe({ emitidas: [emitida(5), emitida(6), emitida(7)] });
    await ler(client);
    expect(client.serieRecorrente.upsert).not.toHaveBeenCalled();
    expect(client.serieRecorrente.updateMany).not.toHaveBeenCalled();
  });

  it("⚠ a varredura de fonte confirma: o serviço não cria nem apaga série nenhuma na leitura", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "SerieRecorrenteService.js"), "utf8")
      // ⚠ BLOCO antes de LINHA: um `//` dentro de um comentário de bloco apaga o `*/` e o regex
      // não-guloso engole o código real até o `*/` seguinte. Lição de 27/08/2026.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // ⚠ UM upsert, e era DOIS até 28/08/2026: o outro era o de `declararSerie`, a porta do
    // cliente, apagada a pedido do dono. Sobrou o de `marcarSerie`, a porta do contador.
    // ⚠ Esta contagem é a guarda que PEGOU a exclusão — ela é uma varredura de fonte, e o número
    // cru é de propósito: escrita nova neste serviço tem de passar por aqui.
    expect((fonte.match(/\.upsert\(/g) || []).length).toBe(1);
    expect(fonte).not.toMatch(/\.delete(Many)?\(|\.createMany\(/);
    expect(fonte).not.toMatch(/\$executeRaw|\$queryRaw/);
  });
});

describe("⚠⚠ a chave é a CONTRAPARTE, e os dois lados saem da mesma tabela", () => {
  it("a receita se agrupa por `tomadorDoc`", async () => {
    const { client } = clientDe({ emitidas: [emitida(5), emitida(6), emitida(7)] });
    const r = await ler(client);
    const receita = r.series.find((s) => s.lado === LADO.RECEITA);
    expect(receita.chave).toBe("11222333000181");
    expect(receita.contraparteDoc).toBe("11222333000181");
    expect(receita.rotulo).toBe("CLIENTE ALFA");
    expect(receita.base.n).toBe(3);
  });

  it("a despesa se agrupa por `emitenteDoc`", async () => {
    const { client } = clientDe({ recebidas: [recebida(5), recebida(6), recebida(7)] });
    const despesa = (await ler(client)).series.find((s) => s.lado === LADO.DESPESA);
    expect(despesa.chave).toBe("98765432000155");
    expect(despesa.rotulo).toBe("ANTHROPIC BRASIL");
  });

  it("⚠⚠ a receita usa a definição de faturamento da CASA — não uma escrita aqui", async () => {
    const { client } = clientDe({ emitidas: [emitida(7)] });
    await ler(client);
    const where = client.portalInvoice.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ papel: "EMIT", statusEfetivo: "autorizada" });
  });

  it("⚠⚠ nota CANCELADA não é observação — e o critério olha as DUAS colunas", async () => {
    const { client } = clientDe({
      recebidas: [
        recebida(5),
        recebida(6),
        // ⚠ cancelada com `statusEfetivo` NULO: é o caso que olhar só a primeira coluna deixa passar
        recebida(7, { statusEfetivo: null, status: "CANCELADA" }),
      ],
    });
    const despesa = (await ler(client)).series.find((s) => s.lado === LADO.DESPESA);
    expect(despesa.base.n).toBe(2);
  });

  it("⚠ `Decimal` do Prisma entra como valor — o detector o aceita pelo `toString`", async () => {
    const decimal = { toString: () => "1250.75" };
    const { client } = clientDe({ recebidas: [recebida(5, { total: decimal }), recebida(6, { total: decimal }), recebida(7, { total: decimal })] });
    const despesa = (await ler(client)).series.find((s) => s.lado === LADO.DESPESA);
    expect(despesa.valorProjetado).toBe(1250.75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE O SERVIÇO NÃO ALCANÇA SAI CONTADO E NOMEADO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada some em silêncio", () => {
  it("a despesa que só existe no extrato é CONTADA, com o motivo", async () => {
    const { client } = clientDe({ declaradosOfx: 12 });
    const r = await ler(client);
    const fora = r.foraDoAlcance.find((f) => f.motivo === FORA_DO_ALCANCE.CHAVE_DE_DESCRICAO_CARREGA_DATA);
    expect(fora.quantos).toBe(12);
    // ⚠ E a frase diz o que fazer enquanto o conserto não vem.
    expect(fora.frase).toMatch(/declare a recorrência delas à mão/i);
  });

  it("⚠ nota sem contraparte é contada, não descartada calada", async () => {
    const { client } = clientDe({ emitidas: [emitida(5), nota({ tomadorDoc: null })] });
    const r = await ler(client);
    expect(r.foraDoAlcance.find((f) => f.motivo === FORA_DO_ALCANCE.SEM_CONTRAPARTE).quantos).toBe(1);
  });

  it("⚠ sem nada fora do alcance, a lista fica VAZIA — não se inventa aviso", async () => {
    const { client } = clientDe({ emitidas: [emitida(5)] });
    expect((await ler(client)).foraDoAlcance).toEqual([]);
  });

  it("⚠⚠ a tabela ausente vira `indisponivel`, NUNCA 'esta empresa não tem recorrência'", async () => {
    const p2021 = Object.assign(new Error("tabela não existe"), { code: "P2021" });
    const { client } = clientDe({ emitidas: [emitida(5)], erroNaTabela: p2021 });
    const r = await ler(client);
    expect(r.indisponivel).toBe(true);
    // ⚠ E a observação continua respondendo: o detector é puro e não depende da tabela.
    expect(r.series.length).toBe(1);
  });

  it("⚠ erro que NÃO é P2021 sobe — engolir tudo esconderia defeito de verdade", async () => {
    const outro = Object.assign(new Error("conexão caiu"), { code: "P1001" });
    const { client } = clientDe({ erroNaTabela: outro });
    await expect(ler(client)).rejects.toThrow(/conexão caiu/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ SÓ A MARCAÇÃO PÕE A LINHA NO FLUXO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ `entraNoFluxo` é a marcação, nunca a observação", () => {
  const tres = [emitida(5), emitida(6), emitida(7)];

  it("série com padrão claro e SEM marcação NÃO entra no fluxo", async () => {
    const { client } = clientDe({ emitidas: tres });
    const s = (await ler(client)).series[0];
    expect(s.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    // ⚠⚠ ELA SUGERE, E SÓ. `estado` nulo — candidata não é PENDENTE, que é um estado GRAVADO.
    expect(s.entraNoFluxo).toBe(false);
    expect(s.estado).toBeNull();
  });

  it("marcada ATIVA, entra", async () => {
    const { client } = clientDe({
      emitidas: tres,
      marcadas: [{ id: "s-1", lado: LADO.RECEITA, chave: "11222333000181", estado: ESTADO_DA_SERIE.ATIVA, periodicidade: PERIODICIDADE.MENSAL, rotulo: "CLIENTE ALFA" }],
    });
    const s = (await ler(client)).series[0];
    expect(s.entraNoFluxo).toBe(true);
    expect(s.leitura).toBe(LEITURA.CONTINUA);
  });

  it.each([ESTADO_DA_SERIE.PENDENTE, ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA])(
    "⚠ marcada %s NÃO entra — os três existem para não entrar, cada um por um motivo",
    async (estado) => {
      const { client } = clientDe({
        emitidas: tres,
        marcadas: [{ id: "s-1", lado: LADO.RECEITA, chave: "11222333000181", estado, periodicidade: PERIODICIDADE.MENSAL, rotulo: "X" }],
      });
      expect((await ler(client)).series[0].entraNoFluxo).toBe(false);
    },
  );

  it("⚠ e a lista de quem entra é de INCLUSÃO — estado novo nasce FORA do fluxo", () => {
    expect(ESTADOS_NO_FLUXO).toEqual([ESTADO_DA_SERIE.ATIVA]);
  });
});

describe("⚠⚠ a série marcada que perdeu as observações NÃO SOME da tela", () => {
  it("ela aparece, com a leitura de quem não tem nada atrás", async () => {
    const { client } = clientDe({
      marcadas: [{ id: "s-1", lado: LADO.DESPESA, chave: "98765432000155", estado: ESTADO_DA_SERIE.ATIVA, periodicidade: PERIODICIDADE.MENSAL, rotulo: "ANTHROPIC" }],
    });
    const r = await ler(client);
    expect(r.series).toHaveLength(1);
    // ⚠⚠ `SEM_OBSERVACAO`, não `CONTINUA`: ela está no fluxo de caixa projetando dinheiro, e não há
    // uma única observação por trás. Sumir da tela deixaria essa linha inalcançável.
    expect(r.series[0].leitura).toBe(LEITURA.SEM_OBSERVACAO);
    expect(r.series[0].entraNoFluxo).toBe(true);
  });
});

describe("⚠ a periodicidade da série MARCADA manda", () => {
  it("⚠⚠ a taxa ANUAL só é lida como anual porque alguém a declarou assim", async () => {
    const anuais = [
      emitida(3, { competencia: new Date("2024-03-01T00:00:00.000Z") }),
      emitida(3, { competencia: new Date("2025-03-01T00:00:00.000Z") }),
      emitida(3, { competencia: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const marcadas = [{ id: "s-1", lado: LADO.RECEITA, chave: "11222333000181", estado: ESTADO_DA_SERIE.ATIVA, periodicidade: PERIODICIDADE.ANUAL, rotulo: "CONSELHO" }];
    const { client } = clientDe({ emitidas: anuais, marcadas });
    const s = (await ler(client)).series[0];
    expect(s.periodicidade).toBe(PERIODICIDADE.ANUAL);
    expect(s.leitura).toBe(LEITURA.CONTINUA);
  });

  it("⚠⚠ e a MESMA série, sem marcação, é lida como MENSAL e NÃO sugere nada", async () => {
    // É a limitação declarada no cabeçalho: não há de onde deduzir a periodicidade de uma candidata,
    // e ler as três e escolher a que "fecha" seria o sistema decidindo qual é o padrão.
    const anuais = [
      emitida(3, { competencia: new Date("2024-03-01T00:00:00.000Z") }),
      emitida(3, { competencia: new Date("2025-03-01T00:00:00.000Z") }),
      emitida(3, { competencia: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const { client } = clientDe({ emitidas: anuais });
    const s = (await ler(client)).series[0];
    expect(s.periodicidade).toBe(PERIODICIDADE.MENSAL);
    expect(s.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
  });
});

describe("⚠⚠ a evidência viaja, e a FAIXA nunca é omitida", () => {
  it("o VALOR e a EVIDÊNCIA viajam juntos — o ponto sozinho não é resposta", async () => {
    const { client } = clientDe({
      recebidas: [recebida(5, { total: "120.00" }), recebida(6, { total: "130.00" }), recebida(7, { total: "140.00" })],
    });
    const s = (await ler(client)).series[0];
    // ⚠ O valor é a MEDIANA, e ele viaja em `valorProjetado`; a frase descreve a BASE. A tela compõe
    // os dois ("≈ R$ 130, baseado em 3 observações, entre 120 e 140") — a formatação de moeda não
    // mora na regra pura, que não conhece locale.
    expect(s.valorProjetado).toBe(130);
    expect(s.base.min).toBe(120);
    expect(s.base.max).toBe(140);
    expect(s.frase).toMatch(/3 observações/);
    expect(s.frase).toMatch(/entre 120 e 140/);
  });

  it("⚠⚠ havendo faixa, a frase NUNCA sai sem ela — é o que impede o ponto sozinho", async () => {
    // Medido em 27/08/2026: o CV mediano das despesas deste banco é 36,1%. A mediana sozinha
    // erraria por um terço rotineiramente, e o fluxo diria um número que ninguém pode usar.
    const { client } = clientDe({
      recebidas: [recebida(5, { total: "100.00" }), recebida(6, { total: "300.00" }), recebida(7, { total: "200.00" })],
    });
    const s = (await ler(client)).series[0];
    expect(s.base.min).not.toBe(s.base.max);
    expect(s.frase).toMatch(/entre/);
  });

  it("⚠ série de valor constante não inventa faixa — min e max iguais, sem 'entre'", async () => {
    const { client } = clientDe({
      recebidas: [recebida(5), recebida(6), recebida(7)],
    });
    const s = (await ler(client)).series[0];
    expect(s.base.min).toBe(s.base.max);
    expect(s.frase).not.toMatch(/entre/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// A MARCAÇÃO
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("marcarSerie", () => {
  const marcar = (client, extra = {}) =>
    marcarSerie({
      portalClientId: "emp-1",
      lado: LADO.DESPESA,
      chave: "98765432000155",
      rotulo: "ANTHROPIC",
      periodicidade: PERIODICIDADE.MENSAL,
      estado: ESTADO_DA_SERIE.ATIVA,
      usuarioId: "u-1",
      agora: AGORA,
      client,
      ...extra,
    });

  it("⚠⚠ grava a EVIDÊNCIA do instante da decisão", async () => {
    const { client, escritas } = clientDe();
    await marcar(client, { baseDaObservacao: { n: 3, mediana: 130 } });
    expect(escritas[0].create.baseDaObservacao).toEqual({ n: 3, mediana: 130 });
    expect(escritas[0].update.baseDaObservacao).toEqual({ n: 3, mediana: 130 });
  });

  it("⚠ registra QUEM decidiu e QUANDO — inclusive na recusa", async () => {
    const { client, escritas } = clientDe();
    await marcar(client, { estado: ESTADO_DA_SERIE.RECUSADA });
    expect(escritas[0].update).toMatchObject({ estado: ESTADO_DA_SERIE.RECUSADA, confirmadoPor: "u-1", confirmadoEm: AGORA });
  });

  it("⚠ a série marcada pelo contador nasce DETECTADA", async () => {
    const { client, escritas } = clientDe();
    await marcar(client);
    expect(escritas[0].create.origem).toBe(ORIGEM_DA_SERIE.DETECTADA);
  });

  it("⚠ é upsert pela CHAVE NATURAL — a candidata ainda não tem linha", async () => {
    const { client, escritas } = clientDe();
    await marcar(client);
    expect(escritas[0].where.portalClientId_lado_chave)
      .toEqual({ portalClientId: "emp-1", lado: LADO.DESPESA, chave: "98765432000155" });
  });

  it.each([
    ["lado", { lado: "AMBOS" }, RECUSA_DA_SERIE.LADO_INVALIDO],
    ["periodicidade", { periodicidade: "SEMESTRAL" }, RECUSA_DA_SERIE.PERIODICIDADE_INVALIDA],
    ["estado", { estado: "TALVEZ" }, RECUSA_DA_SERIE.ESTADO_INVALIDO],
    ["chave", { chave: "   " }, RECUSA_DA_SERIE.SEM_CHAVE],
  ])("⚠ %s fora do vocabulário RECUSA nomeando", async (_n, extra, codigo) => {
    const { client } = clientDe();
    await expect(marcar(client, extra)).rejects.toMatchObject({ codigo });
  });

  it("⚠⚠ sem a tabela, recusa com `503` nomeado — nunca um 500 mudo", async () => {
    const p2021 = Object.assign(new Error("x"), { code: "P2021" });
    const { client } = clientDe({ erroNaTabela: p2021 });
    await expect(marcar(client)).rejects.toMatchObject({ codigo: RECUSA_DA_SERIE.INDISPONIVEL });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ LÁPIDE — `declararSerie` FOI APAGADA EM 28/08/2026, a pedido do dono.
//
// Ela era a porta do CLIENTE (*"essa é a taxa anual que pago de Conselho"*), e os testes que viviam
// aqui mediam: o vocabulário fechado, o valor obrigatório, a série que nasce PENDENTE, a que não
// sobrescreve uma já confirmada pelo contador, e a varredura provando que **nenhuma conta contábil
// entrava por aquela porta**.
//
// ⚠⚠ **CONSEQUÊNCIA QUE FICA NOMEADA:** com ela, `ORIGEM_DA_SERIE.DECLARADA` deixou de ter
// ESCRITOR — nada, em lugar nenhum, cria uma série declarada. O vocabulário **continua** porque
// linhas com essa origem podem existir no banco, e `leituraDoFluxo` lê `origem`/`valorDeclarado`
// para mostrar o confronto. **Não apague `DECLARADA` achando que é código morto: ela é LEITURA de
// dado que já existe.**
//
// ⚠ E o caso do dono — a taxa ANUAL do Conselho — ficou sem caminho: o detector lê `PortalInvoice`,
// e uma anuidade paga por débito em conta não vira nota nenhuma. `marcarSerie` (a porta do
// contador) continua de pé para o que o detector ENXERGA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("⚠⚠ a saída se REGISTRA, nunca se aplica", () => {
  it("grava que o detector sugeriu, e o estado NÃO muda", async () => {
    const { client } = clientDe();
    await registrarSaidaSugerida({ portalClientId: "emp-1", serieId: "s-1", agora: AGORA, client });
    const args = client.serieRecorrente.updateMany.mock.calls[0][0];
    expect(args.data).toEqual({ saidaSugeridaEm: AGORA });
    // ⚠⚠ `estado` NÃO está no `data`: desmarcar sozinho seria o sistema revogando a decisão do
    // contador, pela mesma razão que a entrada não se marca sozinha.
    expect(args.data.estado).toBeUndefined();
  });

  it("⚠ só a PRIMEIRA vez — a segunda não reescreve a data da sugestão", async () => {
    const { client } = clientDe();
    await registrarSaidaSugerida({ portalClientId: "emp-1", serieId: "s-1", agora: AGORA, client });
    expect(client.serieRecorrente.updateMany.mock.calls[0][0].where.saidaSugeridaEm).toBeNull();
  });

  it("⚠ escopada pela EMPRESA — nunca só pelo id", async () => {
    const { client } = clientDe();
    await registrarSaidaSugerida({ portalClientId: "emp-1", serieId: "s-1", client });
    expect(client.serieRecorrente.updateMany.mock.calls[0][0].where.portalClientId).toBe("emp-1");
  });
});

describe("⚠ o serializador", () => {
  it("`Decimal` vira texto — a tela não recebe objeto do Prisma", () => {
    const r = paraTela({ id: "s-1", valorDeclarado: { toString: () => "1200.00" } });
    expect(r.valorDeclarado).toBe("1200.00");
  });

  it("⚠ nulo continua nulo — `String(null)` daria a palavra \"null\" na tela", () => {
    expect(paraTela({ id: "s-1", valorDeclarado: null }).valorDeclarado).toBeNull();
    expect(paraTela(null)).toBeNull();
  });
});

describe("⚠ o ciclo de hoje", () => {
  it("é a competência do mês corrente, e é INJETADO no detector", () => {
    expect(cicloDeHoje(new Date("2026-08-27T12:00:00.000Z"))).toBe("2026-08");
    expect(cicloDeHoje(new Date("2026-12-31T23:00:00.000Z"))).toBe("2026-12");
  });
});
