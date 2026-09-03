// ⚠⚠ PARCELAMENTO DO LUCRO PRESUMIDO — a provisão POR TRIBUTO (01/09/2026)
//
// > Dono: *"parcelamento do lucro presumido está completamente incorreto, nele devemos provisionar
// > cada tipo de imposto separado, e não temos suporte a isso"* · *"perceba que lançamos cada
// > imposto individual, depois o total de juros, nesse caso não tem a multa mas também lançaríamos,
// > e depois lançamos no 588 que nesse caso é a conta de parcelamento"*.
//
// O lançamento que ele faz à mão, e que esta entrega passa a produzir:
//
//   D 254  VR REF PARC PIS 01/10/2025 PARC EM 60 PARCELAS                        1.378,30
//   D 255  VR REF PARC COFINS 01/10/2025 PARC EM 60 PARCELAS                     6.361,30
//   D 256  VR REF PARC CSLL 1.TRIM.03/2025, 2.TRIM.06/2025 …                    17.278,70
//   D 250  VR REF PARC IRPJ 1.TRIM.03/2025, 2.TRIM.06/2025 …                    41.230,51
//   D 501  VR REF JUROS S/ PARC PIS, COFINS, CSLL E IRPJ                        14.699,84
//   C 588  VR REF PARC PIS, COFINS, CSLL E IRPJ                                 80.948,65
//
// ⚠⚠ **A MECÂNICA JÁ EXISTIA QUASE INTEIRA.** `linhasProvisaoFromOverride` já aceitava linhas do
// modal com papel próprio, e `MapaContaTributo` já indexa por `(tipoLinha, codigoTributo)`. O que
// faltava eram DUAS linhas: o `codigoTributo` era cravado em `null` (as quatro linhas de tributo
// ficavam indistinguíveis, e as quatro contas colidiam numa só) e o histórico era SEMPRE derivado
// (`PROVISÃO OUTRO Nº 123 — principal`), então a descrição que o contador escreve não existia.

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const store = { parcelamentos: [], parcelas: [], entries: [], memoria: [], seq: 0 };
  const proximo = (p) => { store.seq += 1; return `${p}${store.seq}`; };

  function casa(row, where = {}) {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("lte" in v && !(row[k] != null && row[k] <= v.lte)) return false;
        if ("not" in v && v.not === null && row[k] == null) return false;
        if ("in" in v && !v.in.includes(row[k])) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  const tx = {
    portalClient: { findUnique: jest.fn(async () => ({ razao: "SINTROPIA TECNOLOGIA LTDA", cnpj: "00000000000191" })) },
    parcelamento: {
      findFirst: jest.fn(async ({ where }) => (where.id
        ? store.parcelamentos.find((p) => p.id === where.id) || null
        : store.parcelamentos.find((p) => p.tipo === where.tipo && p.numeroParcelamento === where.numeroParcelamento) || null)),
      create: jest.fn(async ({ data }) => {
        const p = { id: proximo("parc"), diaPagamento: 1, aberturaEntryId: null, ...data };
        store.parcelamentos.push(p);
        return p;
      }),
      update: jest.fn(async ({ where, data }) => {
        const p = store.parcelamentos.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
    },
    // ⚠ A MEMÓRIA DE CONTAS guarda o que foi gravado — é ela que prova que cada tributo aprendeu
    // uma conta PRÓPRIA. Um mock que devolvesse `null` e engolisse a escrita esconderia a entrega.
    mapaContaTributo: {
      findFirst: jest.fn(async ({ where }) => store.memoria.find((m) => casa(m, where)) || null),
      create: jest.fn(async ({ data }) => { const m = { id: proximo("mct"), ...data }; store.memoria.push(m); return m; }),
      update: jest.fn(async ({ where, data }) => {
        const m = store.memoria.find((x) => x.id === where.id) || {};
        Object.assign(m, data);
        return m;
      }),
    },
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        const e = { id: proximo("entry"), ...data, lines: data.lines?.createMany?.data || [] };
        store.entries.push(e);
        return e;
      }),
    },
    guide: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})) },
    tributoParcela: { upsert: jest.fn(async () => ({})) },
    parcela: {
      findMany: jest.fn(async ({ where }) => store.parcelas.filter((p) => casa(p, where))),
      create: jest.fn(async ({ data }) => {
        const p = { id: proximo("pcl"), guiaId: null, origemBaixa: null, baixadaEm: null, ...data };
        store.parcelas.push(p);
        return p;
      }),
      update: jest.fn(async ({ where, data }) => {
        const p = store.parcelas.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const alvo = store.parcelas.filter((p) => casa(p, where));
        alvo.forEach((p) => Object.assign(p, data));
        return { count: alvo.length };
      }),
    },
  };

  return { __store: store, prisma: { ...tx, $transaction: jest.fn(async (cb) => cb(tx)) } };
});

import { __store } from "../../../../infrastructure/db/prisma.js";
import { ingestParcelamentoFromGuide } from "../ParcelamentoV2Service.js";
import { buildDTOsFromManual } from "../entradaManual.js";
import {
  TIPOS_PARCELAMENTO,
  MODALIDADES_SEM_FAMILIA,
  chaveMemoriaContas,
  grupoDoParcelamento,
} from "../contracts.js";

function limpar() {
  __store.parcelamentos.length = 0;
  __store.parcelas.length = 0;
  __store.entries.length = 0;
  __store.memoria.length = 0;
  __store.seq = 0;
}
beforeEach(limpar);

async function criarContrato(header, extra = {}) {
  const { parcelamentoDTO, parcelaDTO } = buildDTOsFromManual({ guide: null, header });
  return ingestParcelamentoFromGuide({
    portalClientId: "pc1", guideId: null, parcelamentoDTO, parcelaDTO, userId: "u1", ...extra,
  });
}

/** O cabeçalho do acordo do dono: 80.948,65 = 66.248,81 de principal + 14.699,84 de juros. */
const HEADER_LP = {
  tipo: "LUCRO_PRESUMIDO",
  numeroParcelamento: "0211.00012.0104884128.26-54",
  quantidadeParcelas: 60,
  valorPrincipal: 66248.81,
  valorJuros: 14699.84,
  valorTotal: 80948.65,
  anoMesParcela: "202511",
  diaPagamento: 20,
};

/** As seis linhas, com o código de receita e a descrição do contador — como o wizard as manda. */
const LINHAS_DO_DONO = [
  { tipoLinha: "PRINCIPAL", codigoTributo: "8109", tipo: "D", conta: "254", valor: 1378.30,
    historico: "VR REF PARC PIS 01/10/2025 PARC EM 60 PARCELAS" },
  { tipoLinha: "PRINCIPAL", codigoTributo: "2172", tipo: "D", conta: "255", valor: 6361.30,
    historico: "VR REF PARC COFINS 01/10/2025 PARC EM 60 PARCELAS" },
  { tipoLinha: "PRINCIPAL", codigoTributo: "2372", tipo: "D", conta: "256", valor: 17278.70,
    historico: "VR REF PARC CSLL  1.TRIM.03/2025 , 2.TRIM.06/2025 E 3.TRIM.09/2025PARC EM 60 PARCELAS" },
  { tipoLinha: "PRINCIPAL", codigoTributo: "2089", tipo: "D", conta: "250", valor: 41230.51,
    historico: "VR REF PARC IRPJ   1.TRIM.03/2025 , 2.TRIM.06/2025 E 3.TRIM.09/2025PARC EM 60 PARCELAS" },
  { tipoLinha: "JUROS", tipo: "D", conta: "501", valor: 14699.84,
    historico: "VR REF JUROS S/ PARC PIS, COFINS, CSLL E IRPJ" },
  { tipoLinha: "PARC", tipo: "C", conta: "588", valor: 80948.65,
    historico: "VR REF  PARC PIS, COFINS, CSLL E IRPJ" },
];

const linhaDe = (conta) => __store.entries.find((e) => e.lines?.[0]?.conta === conta);

describe("⚠⚠ a modalidade LUCRO_PRESUMIDO existe, e não colapsa para o Simples", () => {
  it("está na lista FECHADA de tipos", () => {
    expect(TIPOS_PARCELAMENTO).toContain("LUCRO_PRESUMIDO");
  });

  it("⚠⚠ a memória de contas dela é PRÓPRIA — nunca a chave do PARCSN", () => {
    // As contas do LP são outras (a memória é por `(tipoLinha, codigoTributo)`, com os códigos
    // 8109/2172/2089/2372). Colapsar para "PARCSN" orfanaria o padrão dela no primeiro acordo.
    expect(MODALIDADES_SEM_FAMILIA).toContain("LUCRO_PRESUMIDO");
    expect(chaveMemoriaContas("LUCRO_PRESUMIDO")).toBe("LUCRO_PRESUMIDO");
    expect(chaveMemoriaContas("PARCSN_ESPECIAL")).toBe("PARCSN"); // o colapso das famílias segue
  });

  it("⚠ fica FORA da busca automática do SERPRO — ela é do Simples/MEI", () => {
    expect(grupoDoParcelamento("LUCRO_PRESUMIDO")).toBe("outros");
  });

  it("⚠⚠ o `kind` legado grava DARF, nunca `SIMPLES`", async () => {
    // O schema declara `SIMPLES | INSS | DARF | OUTRO`, e o acordo do LP é de DARF. Chamá-lo de
    // "SIMPLES" seria gravar natureza errada em silêncio — a classe do prefixo `/^PARC(SN|MEI)/`.
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    expect(__store.parcelamentos[0].kind).toBe("DARF");
    expect(__store.parcelamentos[0].tipo).toBe("LUCRO_PRESUMIDO");
  });
});

describe("⚠⚠ a provisão sai POR TRIBUTO, e ela FECHA", () => {
  it("seis lançamentos: quatro tributos, os juros e a contrapartida", async () => {
    const r = await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    expect(r.ok).toBe(true);
    expect(__store.entries).toHaveLength(6);
    expect(__store.entries.map((e) => e.lines[0].conta)).toEqual(["254", "255", "256", "250", "501", "588"]);
  });

  it("⚠⚠ a soma dos débitos é EXATAMENTE o crédito no 588 — os números do dono", () => {
    // 1.378,30 + 6.361,30 + 17.278,70 + 41.230,51 + 14.699,84 = 80.948,65
    const debitos = LINHAS_DO_DONO.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
    const credito = LINHAS_DO_DONO.find((l) => l.tipo === "C").valor;
    expect(Math.round(debitos * 100) / 100).toBe(credito);
    expect(credito).toBe(80948.65);
  });

  it("⚠⚠ CADA TRIBUTO CARREGA O CÓDIGO DE RECEITA — é ele que dá conta própria a cada um", async () => {
    // Era esta a linha que faltava: `codigoTributo` era cravado em `null`, e as quatro linhas de
    // tributo ficavam indistinguíveis (`PRINCIPAL` + nada). `MapaContaTributo` indexa por
    // `(tipoLinha, codigoTributo)` — sem o código, as quatro contas colidem numa só.
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    expect(linhaDe("254").codigoTributo).toBe("8109"); // PIS
    expect(linhaDe("255").codigoTributo).toBe("2172"); // COFINS
    expect(linhaDe("256").codigoTributo).toBe("2372"); // CSLL
    expect(linhaDe("250").codigoTributo).toBe("2089"); // IRPJ
    // ⚠ E ele desce até a LINHA do lançamento, não só ao cabeçalho.
    expect(linhaDe("254").lines[0].codigoTributo).toBe("8109");
  });

  it("⚠ juros e a contrapartida NÃO ganham código — eles não são de um tributo", async () => {
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    expect(linhaDe("501").codigoTributo).toBeNull();
    expect(linhaDe("588").codigoTributo).toBeNull();
  });

  it("⚠ o papel continua sendo PRINCIPAL — nada de quatro papéis novos", async () => {
    // Decisão do dono: papel é natureza contábil (principal/juros/multa), não nome de tributo.
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    expect(__store.entries.map((e) => e.tipoLinha))
      .toEqual(["PRINCIPAL", "PRINCIPAL", "PRINCIPAL", "PRINCIPAL", "JUROS", "PARC"]);
  });

  it("⚠ código fora da forma de 4 dígitos vira `null`, e NÃO é fabricado", async () => {
    // Padding transformaria um código curto num código plausível e errado — a classe do
    // `cLocEmi="0000000"`.
    await criarContrato(HEADER_LP, {
      provisaoLines: [
        { tipoLinha: "PRINCIPAL", codigoTributo: "81", tipo: "D", conta: "254", valor: 100 },
        { tipoLinha: "PARC", tipo: "C", conta: "588", valor: 100 },
      ],
    });
    expect(linhaDe("254").codigoTributo).toBeNull();
  });
});

describe("⚠⚠ a descrição que o CONTADOR escreveu é o histórico", () => {
  it("o histórico é o texto dele, INTEIRO e sem prefixo", async () => {
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    expect(linhaDe("254").historico).toBe("VR REF PARC PIS 01/10/2025 PARC EM 60 PARCELAS");
    // ⚠ Sem `PROVISÃO LUCRO_PRESUMIDO Nº … — principal` grudado na frente: o texto dele carrega os
    // PERÍODOS de cada débito, que nenhum derivado saberia montar.
    expect(linhaDe("256").historico).toMatch(/1\.TRIM\.03\/2025/);
    expect(linhaDe("256").historico).not.toMatch(/PROVIS[ÃA]O/);
  });

  it("⚠⚠ SEM descrição, o histórico é o DERIVADO DE SEMPRE — nenhum contrato existente muda", async () => {
    // É o lado que impede a mudança de quebrar em silêncio todo parcelamento já criado.
    await criarContrato(
      { ...HEADER_LP, tipo: "PARCSN", numeroParcelamento: "9999" },
      {
        provisaoLines: [
          { tipoLinha: "PRINCIPAL", tipo: "D", conta: "265", valor: 100 },
          { tipoLinha: "PARC", tipo: "C", conta: "553", valor: 100 },
        ],
      },
    );
    expect(linhaDe("265").historico).toMatch(/^PROVISÃO PARCSN Nº 9999 — /);
  });

  it("⚠ descrição em branco NÃO apaga o derivado — só texto de verdade vence", async () => {
    await criarContrato(HEADER_LP, {
      provisaoLines: [
        { tipoLinha: "PRINCIPAL", tipo: "D", conta: "254", valor: 100, historico: "   " },
        { tipoLinha: "PARC", tipo: "C", conta: "588", valor: 100 },
      ],
    });
    expect(linhaDe("254").historico).toMatch(/^PROVISÃO LUCRO_PRESUMIDO/);
  });
});

describe("⚠⚠ a descrição do PAGAMENTO fica guardada na CONFIG do contrato", () => {
  // A outra metade do pedido: *"descrição da provisão **e descrição do pagamento**"*. A config do
  // pagamento guardava só papel + lado + conta, e o texto era descartado na entrada — a provisão
  // saía com a frase do contador e a baixa, todo mês, com o derivado.
  const PAGAMENTO_DO_DONO = [
    { tipoLinha: "PARC", tipo: "D", conta: "588", historico: "PAGO PARC PIS,COFINS,CSLL E IRPJ" },
    { tipoLinha: "JUROS", tipo: "D", conta: "501", historico: "PAGO JUROS S/ PARC" },
    { tipoLinha: "CAIXA", tipo: "C", conta: "5" },
  ];

  it("a frase de cada papel é PERSISTIDA junto da conta", async () => {
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO, pagamentoLines: PAGAMENTO_DO_DONO });
    const cfg = __store.parcelamentos[0].configPagamento;
    expect(cfg.find((l) => l.tipoLinha === "PARC")).toMatchObject({
      conta: "588", historico: "PAGO PARC PIS,COFINS,CSLL E IRPJ",
    });
    expect(cfg.find((l) => l.tipoLinha === "JUROS").historico).toBe("PAGO JUROS S/ PARC");
  });

  it("⚠ papel SEM frase não ganha a chave — config antiga continua legível sem migração", async () => {
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO, pagamentoLines: PAGAMENTO_DO_DONO });
    const caixa = __store.parcelamentos[0].configPagamento.find((l) => l.tipoLinha === "CAIXA");
    expect(caixa.conta).toBe("5");
    // `undefined` some do JSON: ausência de chave é "sem frase", e o histórico é o derivado.
    expect(caixa.historico).toBeUndefined();
  });
});

describe("⚠⚠ a memória aprende UMA CONTA POR TRIBUTO", () => {
  it("as quatro contas são gravadas separadas, cada uma com o seu código", async () => {
    // É o retorno prático do `codigoTributo`: no parcelamento seguinte, cada tributo volta
    // pré-preenchido com a conta certa em vez de as quatro colidirem numa só.
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });

    const doPrincipal = __store.memoria.filter((m) => m.tipoLinha === "PRINCIPAL");
    expect(doPrincipal).toHaveLength(4);
    // ⚠ `contaId` é o nome da coluna na memória (`MapaContaTributo`), não `conta`.
    const porCodigo = Object.fromEntries(doPrincipal.map((m) => [m.codigoTributo, m.contaId]));
    expect(porCodigo).toEqual({ "8109": "254", "2172": "255", "2372": "256", "2089": "250" });
  });

  it("⚠ e a chave da memória é a do LUCRO PRESUMIDO, não a do Simples", async () => {
    await criarContrato(HEADER_LP, { provisaoLines: LINHAS_DO_DONO });
    for (const m of __store.memoria) expect(m.tipoParcelamento).toBe("LUCRO_PRESUMIDO");
  });
});

describe("⚠ o contrato: é o VALOR DA PARCELA que desconta do 588", () => {
  it("as prestações nascem com o valor do recibo, e N × valor fecha o consolidado", async () => {
    // > Dono: *"o valor da parcela está descrito no documento, e pode ser digitado pelo contador,
    // > o valor da parcela é que desconta do 588"*.
    // É isso que faz o passivo ZERAR na última parcela — e é a conferência que o parser do recibo
    // repete sobre `quantidadeParcelas × valorParcela` contra o total consolidado.
    // ⚠ `header.valorParcela` — é ele que `buildDTOsFromManual` usa quando não há guia nem
    // composição por tributo, e é o que vira `valorPrevisto` de cada prestação. Sem ele o contrato
    // do wizard nascia valendo ZERO, não baixável (é a forma da SINTROPIA nº 1 em produção).
    await criarContrato({ ...HEADER_LP, valorParcela: 1349.14 }, { provisaoLines: LINHAS_DO_DONO });
    expect(__store.parcelas.length).toBeGreaterThan(0);
    const previstos = [...new Set(__store.parcelas.map((p) => Number(p.valorPrevisto)))];
    expect(previstos).toEqual([1349.14]);
    // 60 × 1.349,14 = 80.948,40, contra 80.948,65 — a diferença é o arredondamento por prestação.
    expect(Math.abs(60 * 1349.14 - 80948.65)).toBeLessThanOrEqual(60 * 0.01);
  });
});
