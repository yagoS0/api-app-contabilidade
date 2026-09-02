// A LIGAÇÃO DO DETECTOR COM O BANCO.
//
// ⚠⚠ O que mais importa aqui é a SEPARAÇÃO: observar não grava, e só a marcação do contador põe a
// linha no fluxo de caixa. Um serviço que gravasse a observação faria a tela mostrar um FATO onde
// há uma SUGESTÃO — e é essa distinção que o desenho inteiro existe para manter.

import {
  ESTADO_DA_SERIE,
  FORA_DO_ALCANCE,
  LADO,
  ORIGEM_DA_SERIE,
  WHERE_SERIE_NO_FLUXO,
  autoAtivarSeriesEstaveis,
  FRASE_DA_RECUSA_DA_SERIE,
  removerSerieDeclarada,
  serieEntraNoFluxo,
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
    /**
     * ⚠⚠ DOIS upserts — e este número já foi 2, virou 1 e voltou a 2, sempre pelo mesmo motivo.
     *
     *   · 27/08: dois (`marcarSerie`, do contador · `declararSerie`, do cliente);
     *   · 28/08: **um** — `declararSerie` foi apagada com a tela "Declarar o que se repete", e
     *     `ORIGEM_DA_SERIE.DECLARADA` ficou sem escritor;
     *   · 29/08: **dois** de novo — o dono pediu a declaração de volta, agora dentro do fluxo de
     *     caixa do cliente. A função foi RECUPERADA de `e9dd2be5`, não reescrita.
     *
     * ⚠ Esta contagem é a guarda que PEGOU as duas mudanças, nos dois sentidos. O número cru é de
     * propósito: escrita nova neste serviço tem de passar por aqui e ser explicada.
     */
    expect((fonte.match(/\.upsert\(/g) || []).length).toBe(2);
    /**
     * ⚠⚠ ESTA LINHA PROIBIA `.delete(` POR INTEIRO ATÉ 29/08/2026, e ela PEGOU a mudança — que é
     * exatamente o que ela existe para fazer. O que entrou foi `removerSerieDeclarada`: o cliente
     * desfazendo a recorrência que ELE declarou, enquanto o contador não decidiu.
     *
     * ⚠ **A proibição não foi afrouxada, ficou mais estreita:** continua sendo UM `.delete(`, e o
     * teste dedicado logo abaixo prova as três travas dele (só `DECLARADA`, só `PENDENTE`, escopo
     * por empresa no `where`). ⚠ `deleteMany` segue PROIBIDO — apagar em lote é o que transforma um
     * id errado num estrago de carteira inteira.
     */
    expect((fonte.match(/\.delete\(/g) || []).length).toBe(1);
    expect(fonte).not.toMatch(/\.deleteMany\(|\.createMany\(/);
    expect(fonte).not.toMatch(/\$executeRaw|\$queryRaw/);
  });
});

describe("⚠⚠ a chave é a CONTRAPARTE, e os dois lados saem da mesma tabela", () => {
  it("⚠⚠ a RECEITA não é mais proposta — só DESPESA sai do detector (30/08/2026)", async () => {
    /**
     * ⚠⚠ ISTO REVERTE 25/08/2026 (*"o mesmo para receita: se eu tenho emitido nota para o mesmo
     * cliente há 3 meses, a chance de continuar com ele é grande"*). Dono, 30/08: *"não precisamos
     * que as notas de entrada apareçam, já que elas são usadas no mês seguinte, então não usamos
     * elas para se repetir."*
     *
     * ⚠⚠ O que ele impede é CONTAGEM DOBRADA, e ela estava viva: desde o v4 a nota emitida vira
     * Entrada no **dia 1 do mês seguinte**, e a série de receita projetaria a mesma nota de novo.
     * Medido em produção: das 12 séries da base, **11 eram de RECEITA e estavam ATIVAS**.
     */
    // ⚠ As emitidas ENTRAM no dublê de propósito: o caso prova que elas são LIDAS e mesmo assim
    // não viram série. Um dublê sem elas provaria só que uma lista vazia não gera nada.
    const { client } = clientDe({
      emitidas: [emitida(5), emitida(6), emitida(7)],
      recebidas: [recebida(5), recebida(6), recebida(7)],
    });
    const r = await ler(client);
    expect(r.series.find((s2) => s2.lado === LADO.RECEITA)).toBeUndefined();
    expect(r.series.length).toBeGreaterThan(0);
    expect(r.series.every((s2) => s2.lado === LADO.DESPESA)).toBe(true);
  });

  it("a despesa se agrupa por `emitenteDoc`", async () => {
    const { client } = clientDe({ recebidas: [recebida(5), recebida(6), recebida(7)] });
    const despesa = (await ler(client)).series.find((s) => s.lado === LADO.DESPESA);
    expect(despesa.chave).toBe("98765432000155");
    expect(despesa.rotulo).toBe("ANTHROPIC BRASIL");
  });

  it("⚠⚠ o detector NÃO consulta mais as notas emitidas (30/08/2026)", async () => {
    // ⚠ Ler 1.897 notas por varredura para descartá-las seria caro e enganoso: alguém veria a query
    // e reintroduziria o `juntar` da receita achando que "já estava quase lá".
    // ⚠ A `whereFaturamentoEmit()` NÃO ficou órfã — ela é a definição de faturamento da casa e tem
    // outros consumidores. O que saiu foi o uso dela AQUI.
    const { client } = clientDe({ emitidas: [emitida(7)], recebidas: [recebida(5), recebida(6), recebida(7)] });
    await ler(client);
    const wheres = client.portalInvoice.findMany.mock.calls.map((c) => c[0].where);
    expect(wheres.every((w) => w.papel === "DEST")).toBe(true);
    expect(wheres.some((w) => w.papel === "EMIT")).toBe(false);
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
    // ⚠ A contagem passou a falar só das RECEBIDAS em 30/08/2026: as emitidas deixaram de ser
    // olhadas, e contar "fora do alcance" numa população que nenhuma regra lê seria aviso falso.
    const { client } = clientDe({ recebidas: [recebida(5), recebida(6), nota({ papel: "DEST", emitenteDoc: null })] });
    const r = await ler(client);
    expect(r.foraDoAlcance.find((f) => f.motivo === FORA_DO_ALCANCE.SEM_CONTRAPARTE).quantos).toBe(1);
  });

  it("⚠ sem nada fora do alcance, a lista fica VAZIA — não se inventa aviso", async () => {
    const { client } = clientDe({ recebidas: [recebida(5)] });
    expect((await ler(client)).foraDoAlcance).toEqual([]);
  });

  it("⚠⚠ a tabela ausente vira `indisponivel`, NUNCA 'esta empresa não tem recorrência'", async () => {
    const p2021 = Object.assign(new Error("tabela não existe"), { code: "P2021" });
    const { client } = clientDe({ recebidas: [recebida(5)], erroNaTabela: p2021 });
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
  // ⚠ RECEBIDAS desde 30/08/2026: o detector não lê mais as emitidas, então uma fixture de
  // emitidas produziria ZERO séries e todo caso daqui mediria a lista vazia.
  const tres = [recebida(5), recebida(6), recebida(7)];

  it("série com padrão claro e SEM marcação NÃO entra no fluxo", async () => {
    const { client } = clientDe({ recebidas: tres });
    const s = (await ler(client)).series[0];
    expect(s.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    // ⚠⚠ ELA SUGERE, E SÓ. `estado` nulo — candidata não é PENDENTE, que é um estado GRAVADO.
    expect(s.entraNoFluxo).toBe(false);
    expect(s.estado).toBeNull();
  });

  it("marcada ATIVA, entra", async () => {
    const { client } = clientDe({
      recebidas: tres,
      // ⚠ A fixture passou de RECEITA para DESPESA em 30/08/2026: série de receita não entra mais no
      // fluxo, e o que ESTE caso mede é a MARCAÇÃO, não o lado. Mantendo RECEITA ele mediria a regra nova.
      marcadas: [{ id: "s-1", lado: LADO.DESPESA, chave: "98765432000155", estado: ESTADO_DA_SERIE.ATIVA, periodicidade: PERIODICIDADE.MENSAL, rotulo: "ANTHROPIC" }],
    });
    const s = (await ler(client)).series[0];
    expect(s.entraNoFluxo).toBe(true);
    expect(s.leitura).toBe(LEITURA.CONTINUA);
  });

  it.each([ESTADO_DA_SERIE.PENDENTE, ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA])(
    "⚠ marcada %s NÃO entra — os três existem para não entrar, cada um por um motivo",
    async (estado) => {
      const { client } = clientDe({
        recebidas: tres,
        marcadas: [{ id: "s-1", lado: LADO.DESPESA, chave: "98765432000155", estado, periodicidade: PERIODICIDADE.MENSAL, rotulo: "X" }],
      });
      expect((await ler(client)).series[0].entraNoFluxo).toBe(false);
    },
  );

  /**
   * ⚠⚠ ESTE TESTE DIZIA `expect(ESTADOS_NO_FLUXO).toEqual([ATIVA])` ATÉ 29/08/2026 — e a constante
   * deixou de existir. Ele fica INVERTIDO, não apagado, porque o argumento dele continua valendo
   * para o caso que ele protegia.
   *
   * **O que ele protegia, e continua protegendo:** a série que o DETECTOR achou não entra no fluxo
   * sem a palavra do contador (dono, 25/08/2026: *"o detector SUGERE com 3 e a linha só entra
   * depois que o contador confirma — a trava é a decisão dele, não o número"*).
   *
   * **O que mudou:** apareceu um caso que não existia quando ele foi escrito — a série que o
   * PRÓPRIO CLIENTE declarou (29/08/2026: *"o cliente pode colocar novas saídas, apenas para
   * visualização deles"*). Ela nasce PENDENTE e tem de aparecer no fluxo DELE.
   *
   * ⚠ O que separa os dois é a ORIGEM, nunca o estado.
   */
  it("⚠⚠ PENDENTE só entra quando a origem é DECLARADA — a DETECTADA continua esperando o contador", () => {
    const decl = (extra) => ({ estado: ESTADO_DA_SERIE.PENDENTE, origem: ORIGEM_DA_SERIE.DECLARADA, ...extra });
    expect(serieEntraNoFluxo(decl())).toBe(true);
    expect(serieEntraNoFluxo({ estado: ESTADO_DA_SERIE.PENDENTE, origem: ORIGEM_DA_SERIE.DETECTADA })).toBe(false);
    expect(serieEntraNoFluxo({ estado: ESTADO_DA_SERIE.ATIVA, origem: ORIGEM_DA_SERIE.DETECTADA })).toBe(true);
  });

  it("⚠⚠ RECUSADA e SUSPENSA ficam fora nas DUAS origens — a recusa tem de tirar a linha da tela", () => {
    for (const origem of Object.values(ORIGEM_DA_SERIE)) {
      expect(serieEntraNoFluxo({ estado: ESTADO_DA_SERIE.RECUSADA, origem })).toBe(false);
      expect(serieEntraNoFluxo({ estado: ESTADO_DA_SERIE.SUSPENSA, origem })).toBe(false);
    }
  });

  it("⚠ estado novo nasce FORA — a resposta é de INCLUSÃO, e a ausência de dado também", () => {
    expect(serieEntraNoFluxo({ estado: "QUALQUER_COISA", origem: ORIGEM_DA_SERIE.DECLARADA })).toBe(false);
    expect(serieEntraNoFluxo(null)).toBe(false);
    expect(serieEntraNoFluxo({})).toBe(false);
  });

  /**
   * ⚠⚠ O `where` DO PRISMA E A FUNÇÃO TÊM DE CONCORDAR, caso a caso.
   *
   * São duas escritas do MESMO critério (uma para o banco filtrar, outra para a tela decidir), e é
   * assim que o fluxo passaria a trazer uma linha que `serieEntraNoFluxo` diz que não entra — uma
   * linha fantasma na tela do cliente, sem erro nenhum.
   */
  it("⚠⚠ `WHERE_SERIE_NO_FLUXO` aceita exatamente o que `serieEntraNoFluxo` aceita", () => {
    const casa = (s) => WHERE_SERIE_NO_FLUXO.OR.some((c) =>
      Object.entries(c).every(([k, v]) => s[k] === v));
    for (const estado of Object.values(ESTADO_DA_SERIE)) {
      for (const origem of Object.values(ORIGEM_DA_SERIE)) {
        expect(casa({ estado, origem })).toBe(serieEntraNoFluxo({ estado, origem }));
      }
    }
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
      recebida(3, { competencia: new Date("2024-03-01T00:00:00.000Z") }),
      recebida(3, { competencia: new Date("2025-03-01T00:00:00.000Z") }),
      recebida(3, { competencia: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    // ⚠ DESPESA, e não RECEITA: a taxa anual do Conselho é despesa — a fixture antiga usava o lado
    // errado e só não incomodava porque o lado não decidia nada até 30/08/2026.
    const marcadas = [{ id: "s-1", lado: LADO.DESPESA, chave: "98765432000155", estado: ESTADO_DA_SERIE.ATIVA, periodicidade: PERIODICIDADE.ANUAL, rotulo: "CONSELHO" }];
    const { client } = clientDe({ recebidas: anuais, marcadas });
    const s = (await ler(client)).series[0];
    expect(s.periodicidade).toBe(PERIODICIDADE.ANUAL);
    expect(s.leitura).toBe(LEITURA.CONTINUA);
  });

  it("⚠⚠ e a MESMA série, sem marcação, é lida como MENSAL e NÃO sugere nada", async () => {
    // É a limitação declarada no cabeçalho: não há de onde deduzir a periodicidade de uma candidata,
    // e ler as três e escolher a que "fecha" seria o sistema decidindo qual é o padrão.
    const anuais = [
      recebida(3, { competencia: new Date("2024-03-01T00:00:00.000Z") }),
      recebida(3, { competencia: new Date("2025-03-01T00:00:00.000Z") }),
      recebida(3, { competencia: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const { client } = clientDe({ recebidas: anuais });
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O CLIENTE DESFAZ A RECORRÊNCIA QUE ELE DECLAROU (29/08/2026).
//
// Lacuna achada ao desenhar a tela: a saída AVULSA já tinha remoção e a RECORRENTE não tinha nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ removerSerieDeclarada", () => {
  const clienteCom = (serie) => {
    const apagadas = [];
    return {
      apagadas,
      client: {
        serieRecorrente: {
          findFirst: jest.fn(async () => serie),
          delete: jest.fn(async ({ where }) => { apagadas.push(where.id); return {}; }),
        },
      },
    };
  };

  it("apaga a série DECLARADA e ainda PENDENTE", async () => {
    const { client, apagadas } = clienteCom({
      id: "s-1", estado: ESTADO_DA_SERIE.PENDENTE, origem: ORIGEM_DA_SERIE.DECLARADA,
    });
    await expect(removerSerieDeclarada({ portalClientId: "emp-1", serieId: "s-1", client }))
      .resolves.toEqual({ ok: true });
    expect(apagadas).toEqual(["s-1"]);
  });

  it("⚠⚠ RECUSA a série DETECTADA — ela é do sistema, o cliente não a criou", async () => {
    // Apagá-la pelo lado do cliente jogaria fora a observação que o detector levou meses juntando.
    const { client, apagadas } = clienteCom({
      id: "s-2", estado: ESTADO_DA_SERIE.PENDENTE, origem: ORIGEM_DA_SERIE.DETECTADA,
    });
    await expect(removerSerieDeclarada({ portalClientId: "emp-1", serieId: "s-2", client }))
      .rejects.toMatchObject({ codigo: RECUSA_DA_SERIE.NAO_DECLARADA });
    expect(apagadas).toEqual([]);
  });

  it("⚠⚠ RECUSA depois de o contador decidir — apagar seria desfazer o ato dele", async () => {
    for (const estado of [ESTADO_DA_SERIE.ATIVA, ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA]) {
      const { client, apagadas } = clienteCom({ id: "s-3", estado, origem: ORIGEM_DA_SERIE.DECLARADA });
      await expect(removerSerieDeclarada({ portalClientId: "emp-1", serieId: "s-3", client }))
        .rejects.toMatchObject({ codigo: RECUSA_DA_SERIE.JA_DECIDIDA });
      expect(apagadas).toEqual([]);
    }
  });

  it("⚠⚠ as duas recusas são DIFERENTES — elas pedem coisas diferentes de quem lê", async () => {
    // "não é sua" é engano; "já foi decidida" é falar com o contador. Um código só faria a tela
    // dizer a mesma frase nos dois, e uma delas estaria errada.
    expect(RECUSA_DA_SERIE.NAO_DECLARADA).not.toBe(RECUSA_DA_SERIE.JA_DECIDIDA);
    expect(FRASE_DA_RECUSA_DA_SERIE[RECUSA_DA_SERIE.NAO_DECLARADA]).toMatch(/detectada pelo sistema/i);
    expect(FRASE_DA_RECUSA_DA_SERIE[RECUSA_DA_SERIE.JA_DECIDIDA]).toMatch(/contador já decidiu/i);
  });

  it("⚠⚠ o ESCOPO POR EMPRESA vive no `where` — conhecer um id não apaga a série de outra", async () => {
    const { client } = clienteCom(null);
    await expect(removerSerieDeclarada({ portalClientId: "emp-1", serieId: "s-9", client }))
      .rejects.toMatchObject({ codigo: RECUSA_DA_SERIE.NAO_ENCONTRADA });
    expect(client.serieRecorrente.findFirst.mock.calls[0][0].where)
      .toEqual({ id: "s-9", portalClientId: "emp-1" });
  });

  it("⚠ sem a tabela ela se declara, em vez de estourar", async () => {
    const client = {
      serieRecorrente: {
        findFirst: jest.fn(async () => { const e = new Error("x"); e.code = "P2021"; throw e; }),
      },
    };
    await expect(removerSerieDeclarada({ portalClientId: "emp-1", serieId: "s-1", client }))
      .rejects.toMatchObject({ codigo: RECUSA_DA_SERIE.INDISPONIVEL });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A SÉRIE QUE ENTRA SOZINHA — a reversão de 25/08, decidida pelo dono em 29/08/2026.
//
// > *"se a variação for = ou menor que 10%, pode ser lançado no fluxo automaticamente."*
//
// ⚠⚠ O que estes casos travam é o que SEGURA a reversão: ela não toca decisão já tomada, ela fica
// distinguível para sempre, e ela não lança nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ autoAtivarSeriesEstaveis", () => {
  const clienteQueGrava = (erroDoCreate = null) => {
    const criadas = [];
    return {
      criadas,
      client: {
        serieRecorrente: {
          create: jest.fn(async ({ data }) => {
            if (erroDoCreate) throw erroDoCreate;
            criadas.push(data);
            return { id: `s-${criadas.length}`, ...data };
          }),
        },
      },
    };
  };

  const serie = (valores, extra = {}) => ({
    lado: LADO.DESPESA, chave: "98765432000155", rotulo: "ANTHROPIC",
    base: { n: valores.length, valores, periodicidade: PERIODICIDADE.MENSAL },
    ...extra,
  });

  it("série estável entra ATIVA", async () => {
    const { client, criadas } = clienteQueGrava();
    const r = await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: [serie([1000, 1050, 1020])], client });
    expect(r.ativadas).toBe(1);
    expect(criadas[0].estado).toBe(ESTADO_DA_SERIE.ATIVA);
    expect(criadas[0].origem).toBe(ORIGEM_DA_SERIE.DETECTADA);
  });

  it("⚠⚠ `confirmadoPor` fica NULO — é o que distingue a automática da confirmada", async () => {
    // Sem isso não há como achar as automáticas no dia em que uma entrar errada.
    const { client, criadas } = clienteQueGrava();
    await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: [serie([1000, 1050, 1020])], client });
    expect(criadas[0].confirmadoPor).toBeNull();
    expect(paraTela({ ...criadas[0], id: "s-1" }).autoAtivada).toBe(true);
  });

  it("⚠ e a confirmada por uma PESSOA não é auto-ativada", () => {
    expect(paraTela({ id: "s-2", estado: ESTADO_DA_SERIE.ATIVA, confirmadoPor: "u-1" }).autoAtivada).toBe(false);
  });

  it("⚠ a DECLARADA pelo cliente também não — ela é PENDENTE, não ATIVA", () => {
    // As duas nascem sem `confirmadoPor`; o que as separa é o estado. Por isso a pergunta é sobre o
    // PAR, nunca sobre um campo só.
    expect(paraTela({ id: "s-3", estado: ESTADO_DA_SERIE.PENDENTE, confirmadoPor: null }).autoAtivada).toBe(false);
  });

  it("⚠⚠ A SÉRIE DA LENTE NÃO ENTRA — 1.000 · 1.050 · 1.180 fica fora da faixa", async () => {
    // É o exemplo do próprio dono, e o caso que separa a FAIXA do coeficiente de variação (que a
    // deixaria passar). O Alessandro Nigro continua pedindo o clique dele.
    const { client, criadas } = clienteQueGrava();
    const r = await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: [serie([1000, 1050, 1180])], client });
    expect(r.ativadas).toBe(0);
    expect(criadas).toEqual([]);
    expect(client.serieRecorrente.create).not.toHaveBeenCalled();
  });

  it("⚠⚠ menos de 3 observações NÃO entra — o piso de 25/08 continua", async () => {
    const { client } = clienteQueGrava();
    await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: [serie([1000, 1010])], client });
    expect(client.serieRecorrente.create).not.toHaveBeenCalled();
  });

  it("⚠⚠ ela NÃO TOCA a série que já existe — é `create`, nunca `upsert`", async () => {
    // O upsert ATUALIZARIA a série existente, e uma RECUSADA ou SUSPENSA pelo contador voltaria por
    // aqui — desfazendo a decisão dele.
    const p2002 = Object.assign(new Error("unique"), { code: "P2002" });
    const { client } = clienteQueGrava(p2002);
    const r = await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: [serie([1000, 1050, 1020])], client });
    expect(r.ativadas).toBe(0);
    // ⚠ E a colisão NÃO é erro: ela significa que alguém já decidiu sobre esta série.
    expect(client.serieRecorrente.create).toHaveBeenCalled();
  });

  it("⚠ a varredura confirma: `upsert` não aparece nesta função", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "SerieRecorrenteService.js"), "utf8");
    const trecho = fonte.slice(fonte.indexOf("export async function autoAtivarSeriesEstaveis"));
    expect(trecho).not.toMatch(/\.upsert\(/);
    expect(trecho).toMatch(/\.create\(/);
  });

  it("⚠⚠ ela NÃO LANÇA NADA — governa a projeção do fluxo, não o razão", async () => {
    const { client } = clienteQueGrava();
    await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: [serie([1000, 1050, 1020])], client });
    expect(client.accountingEntry).toBeUndefined();
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "SerieRecorrenteService.js"), "utf8");
    const trecho = fonte.slice(fonte.indexOf("export async function autoAtivarSeriesEstaveis"));
    expect(trecho).not.toMatch(/accountingEntry|AccountingEntry/);
  });

  it("⚠ lista vazia ou torta não grava nada", async () => {
    const { client } = clienteQueGrava();
    for (const entrada of [[], null, [{}], [{ base: { n: 5 } }]]) {
      await autoAtivarSeriesEstaveis({ portalClientId: "emp-1", series: entrada, client });
    }
    expect(client.serieRecorrente.create).not.toHaveBeenCalled();
  });
});
