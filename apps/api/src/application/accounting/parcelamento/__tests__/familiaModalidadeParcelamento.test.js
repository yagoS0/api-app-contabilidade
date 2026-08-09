// AS DUAS FAMÍLIAS DE MODALIDADE — o grupo da busca automática e a chave da memória de contas.
//
// ⚠ O BUG QUE ISTO TRAVA. `Parcelamento.grupo` saía de um PREFIXO:
//
//     /^PARC(SN|MEI)/i.test(dto.tipo) ? "sn_mei" : "outros"
//
// `PERT_SN`, `RELP_SN`, `PERT_MEI` e `RELP_MEI` **não casam com ele**. As quatro caíam em
// `grupo: "outros"`, e os dois filtros da busca automática são `grupo: { not: "outros" }`
// (`workers/serproPgdasdWorker.js` e a rota `.../serpro/parcelamento/capture`): metade das
// modalidades do Simples/MEI era invisível para a captura do SERPRO, **em silêncio** — nenhum erro,
// nenhum log, só parcela que nunca chegava. `PARCSN_ESPECIAL` e `PARCMEI_ESPECIAL` casavam com o
// prefixo e sempre estiveram certas; o defeito era exatamente das quatro PERT/RELP.
//
// ⚠ E O QUE ESTE ARQUIVO PROTEGE DO LADO OPOSTO. O colapso para a família vale na MEMÓRIA DE
// CONTAS e em nenhum outro lugar. A mesma variável `tipoParcelamento` alimenta
// `subtipo: PARC_<TIPO>` e `historicoBase: PROVISÃO <TIPO>` — colapsar na origem mudaria a FORMA e
// o HISTÓRICO do lançamento contábil (proibido sem pedido explícito) e apagaria da contabilidade a
// distinção entre PERT e RELP, que têm reduções de multa e juros: não mudam as contas, mudam os
// valores. O bloco "a modalidade CRUA sobrevive" existe para reprovar quem "simplificar" assim.

import fs from "node:fs";
import path from "node:path";

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const store = { parcelamentos: [], parcelas: [], entries: [], mapa: [], seq: 0 };

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
    portalClient: { findUnique: jest.fn(async () => ({ razao: "EMPRESA TESTE", cnpj: "00000000000191" })) },
    parcelamento: {
      findFirst: jest.fn(async ({ where }) => (where.id
        ? store.parcelamentos.find((p) => p.id === where.id) || null
        : store.parcelamentos.find((p) => p.tipo === where.tipo && p.numeroParcelamento === where.numeroParcelamento) || null)),
      findUnique: jest.fn(async ({ where }) => store.parcelamentos.find((p) => p.id === where.id) || null),
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
    // ⚠ A memória de verdade: `findFirst`/`create`/`update` sobre linhas guardadas, para que o
    // teste EXERÇA a leitura depois da escrita em vez de espiar o argumento de um mock.
    mapaContaTributo: {
      findFirst: jest.fn(async ({ where }) => store.mapa.find((m) => casa(m, where)) || null),
      create: jest.fn(async ({ data }) => {
        const m = { id: proximo("mapa"), portalClientId: null, codigoTributo: null, ...data };
        store.mapa.push(m);
        return m;
      }),
      update: jest.fn(async ({ where, data }) => {
        const m = store.mapa.find((x) => x.id === where.id);
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
import {
  TIPOS_PARCELAMENTO, FAMILIAS_PARCELAMENTO, MODALIDADES_SEM_FAMILIA,
  familiaDaModalidade, grupoDoParcelamento, chaveMemoriaContas,
} from "../contracts.js";
import {
  ingestParcelamentoFromGuide, resolverContasProvisao, memorizeMapaContaTributo,
} from "../ParcelamentoV2Service.js";
import { buildDTOsFromManual } from "../entradaManual.js";

const SN = FAMILIAS_PARCELAMENTO.SIMPLES_NACIONAL.modalidades;
const MEI = FAMILIAS_PARCELAMENTO.MEI.modalidades;
const AS_OITO = [...SN, ...MEI];
// As quatro que o prefixo deixava de fora. Escritas à mão de propósito: derivá-las da mesma
// estrutura que o código usa faria o teste concordar consigo mesmo.
const AS_QUATRO_DO_BUG = ["PERT_SN", "RELP_SN", "PERT_MEI", "RELP_MEI"];

function limpar() {
  __store.parcelamentos.length = 0;
  __store.parcelas.length = 0;
  __store.entries.length = 0;
  __store.mapa.length = 0;
  __store.seq = 0;
}

const HEADER = {
  numeroParcelamento: "1234567",
  quantidadeParcelas: 3,
  valorPrincipal: 18000,
  valorTotal: 21000,
  anoMesParcela: "202601",
};

async function criarContrato(tipo, extra = {}) {
  const { parcelamentoDTO, parcelaDTO } = buildDTOsFromManual({ guide: null, header: { ...HEADER, tipo } });
  return ingestParcelamentoFromGuide({
    portalClientId: "pc1", guideId: null, parcelamentoDTO, parcelaDTO, userId: "u1", ...extra,
  });
}

beforeEach(limpar);

// ─────────────────────────────────────────────────────────────────────────────
describe("o grupo da busca automática — as OITO entram, INSS/OUTRO ficam fora", () => {
  test.each(AS_OITO)("%s → sn_mei", (tipo) => {
    expect(grupoDoParcelamento(tipo)).toBe("sn_mei");
  });

  test("⚠ as QUATRO do bug entram, e o prefixo antigo prova que não entravam", () => {
    for (const tipo of AS_QUATRO_DO_BUG) {
      // O regex de antes, letra por letra: nenhuma das quatro casa com ele.
      expect(/^PARC(SN|MEI)/i.test(tipo)).toBe(false);
      // E é justamente por isso que a lista fechada existe.
      expect(grupoDoParcelamento(tipo)).toBe("sn_mei");
    }
  });

  test("⚠ PARCSN_ESPECIAL e PARCMEI_ESPECIAL já funcionavam e continuam funcionando", () => {
    for (const tipo of ["PARCSN_ESPECIAL", "PARCMEI_ESPECIAL"]) {
      expect(/^PARC(SN|MEI)/i.test(tipo)).toBe(true); // casavam com o prefixo
      expect(grupoDoParcelamento(tipo)).toBe("sn_mei"); // e seguem em sn_mei
    }
  });

  test.each(MODALIDADES_SEM_FAMILIA)("%s → outros (não tem família, e isso é o desenho)", (tipo) => {
    expect(familiaDaModalidade(tipo)).toBeNull();
    expect(grupoDoParcelamento(tipo)).toBe("outros");
  });

  test("⚠ modalidade DESCONHECIDA fica fora da captura, e um prefixo a teria deixado entrar", () => {
    // `PARCSN_QUALQUER_COISA` casaria com `/^PARC(SN|MEI)/i` e entraria na busca automática sem
    // que ninguém soubesse o que ela é. A lista fechada é o que separa conhecida de nova.
    expect(/^PARC(SN|MEI)/i.test("PARCSN_QUALQUER_COISA")).toBe(true);
    expect(grupoDoParcelamento("PARCSN_QUALQUER_COISA")).toBe("outros");
    expect(grupoDoParcelamento("PARCELAMENTO_MUNICIPAL")).toBe("outros");
    expect(grupoDoParcelamento("")).toBe("outros");
    expect(grupoDoParcelamento(null)).toBe("outros");
  });

  test("todo tipo de TIPOS_PARCELAMENTO está classificado — nenhum fica sem decisão", () => {
    const classificados = new Set([...AS_OITO, ...MODALIDADES_SEM_FAMILIA]);
    expect([...TIPOS_PARCELAMENTO].sort()).toEqual([...classificados].sort());
  });

  test("aceita minúsculas e espaços sem mudar a decisão", () => {
    expect(grupoDoParcelamento(" pert_sn ")).toBe("sn_mei");
    expect(chaveMemoriaContas(" relp_mei ")).toBe("PARCMEI");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("os DOIS pontos de filtro continuam sendo `grupo: { not: \"outros\" }`", () => {
  // ⚠ Sem isto o teste acima vira afirmação sobre uma função que ninguém consulta. Estes são os
  // únicos dois leitores de `grupo` no backend; se um deles mudar de forma, a captura muda de
  // população e o bug pode voltar por outra porta.
  // ⚠ Nada de `import.meta.url`: o Jest da API roda em CommonJS e `import.meta` é erro de SINTAXE
  // — o arquivo inteiro morre antes do primeiro teste. O caminho sai do `rootDir` do Jest
  // (`apps/api`), com a variante da raiz do monorepo, igual a `guides/__tests__/envioSemFila.test.js`.
  const arquivo = (...partes) => [
    path.join(process.cwd(), "src", ...partes),
    path.join(process.cwd(), "apps", "api", "src", ...partes),
  ].find((p) => fs.existsSync(p));

  const FILTROS = [
    ["workers", "serproPgdasdWorker.js"],
    ["routes", "firm", "index.js"],
  ];

  test.each(FILTROS)("%s/%s filtra por grupo != outros", (...partes) => {
    const alvo = arquivo(...partes);
    expect(alvo).toBeTruthy();
    expect(fs.readFileSync(alvo, "utf8")).toContain('grupo: { not: "outros" }');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("a ingestão grava o grupo certo (escrita de verdade, não leitura de regra)", () => {
  test.each(AS_QUATRO_DO_BUG)("%s nasce em sn_mei e passa a ser visível para a captura", async (tipo) => {
    limpar();
    await criarContrato(tipo);
    expect(__store.parcelamentos).toHaveLength(1);
    expect(__store.parcelamentos[0].grupo).toBe("sn_mei");
    expect(__store.parcelamentos[0].tipo).toBe(tipo); // a modalidade crua, intacta
  });

  test("INSS continua em outros — parcelamento previdenciário é manual, sem auto-search", async () => {
    await criarContrato("INSS");
    expect(__store.parcelamentos[0].grupo).toBe("outros");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("a memória de contas colapsa para a FAMÍLIA", () => {
  test("⚠ uma conta preenchida em PERT_SN passa a ser encontrada por RELP_SN", async () => {
    await criarContrato("PERT_SN");
    const parcelamentoId = __store.parcelamentos[0].id;

    // O contador corrige a conta num lançamento do PERT_SN (auto-save do PUT /entries).
    await memorizeMapaContaTributo({
      portalClientId: "pc1",
      entry: { parcelamentoId, lines: [{ conta: "265", tipoLinha: "PRINCIPAL" }] },
      userId: "u1",
    });

    // ⚠ A LINHA GRAVADA É A DA FAMÍLIA — a mesma chave que `MapaContaTributoSeeds` semeia. Chave
    // nova orfanaria as 5 linhas já semeadas em produção; é isto que garante que nada é orfanado.
    expect(__store.mapa).toHaveLength(1);
    expect(__store.mapa[0].tipoParcelamento).toBe("PARCSN");

    // E o irmão de família a encontra — antes disso, seis das oito resolviam em branco sempre.
    const contas = await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "RELP_SN" });
    expect(contas.PRINCIPAL).toBe("265");
    const especial = await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "PARCSN_ESPECIAL" });
    expect(especial.PRINCIPAL).toBe("265");
  });

  test("⚠ as famílias NÃO se misturam: o que o SN aprendeu não vale para o MEI", async () => {
    __store.mapa.push({ id: "m1", portalClientId: null, tipoParcelamento: "PARCSN", tipoLinha: "PRINCIPAL", codigoTributo: null, contaId: "265" });

    expect((await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "PERT_MEI" })).PRINCIPAL).toBe("");
    expect((await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "RELP_SN" })).PRINCIPAL).toBe("265");
  });

  test("⚠ INSS e OUTRO NÃO colapsam — são as chaves que hoje têm linhas aprendidas em produção", async () => {
    expect(chaveMemoriaContas("INSS")).toBe("INSS");
    expect(chaveMemoriaContas("OUTRO")).toBe("OUTRO");

    __store.mapa.push({ id: "m1", portalClientId: null, tipoParcelamento: "OUTRO", tipoLinha: "PRINCIPAL", codigoTributo: null, contaId: "999" });

    // A linha aprendida sob OUTRO continua sendo lida por OUTRO...
    expect((await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "OUTRO" })).PRINCIPAL).toBe("999");
    // ...e NÃO vaza para o padrão de contas do Simples.
    expect((await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "PARCSN" })).PRINCIPAL).toBe("");
  });

  test("modalidade desconhecida guarda e lê sob a própria chave, sem palpite de família", async () => {
    expect(chaveMemoriaContas("PARCELAMENTO_MUNICIPAL")).toBe("PARCELAMENTO_MUNICIPAL");
    __store.mapa.push({ id: "m1", portalClientId: null, tipoParcelamento: "PARCELAMENTO_MUNICIPAL", tipoLinha: "PRINCIPAL", codigoTributo: null, contaId: "777" });
    expect((await resolverContasProvisao({ portalClientId: "pc1", tipoParcelamento: "PARCSN" })).PRINCIPAL).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("⚠ A MODALIDADE CRUA SOBREVIVE — o colapso não chega ao lançamento contábil", () => {
  // Este bloco é o que impede alguém de "simplificar" colapsando `tipoParcelamento` na origem.
  // Se o colapso subir para a variável, `subtipo` e `historicoBase` viram PARCSN/PROVISÃO PARCSN e
  // a contabilidade perde a distinção entre PERT e RELP — que o dono quer preservar porque as duas
  // têm reduções de multa e juros: não mudam as contas, mudam os valores.
  test.each(["PERT_SN", "RELP_SN", "PERT_MEI", "RELP_MEI", "PARCSN_ESPECIAL"])(
    "%s: subtipo e histórico saem com o tipo CRU",
    async (tipo) => {
      limpar();
      await criarContrato(tipo);

      expect(__store.entries.length).toBeGreaterThan(0);
      for (const e of __store.entries) {
        expect(e.subtipo).toBe(`PARC_${tipo}`);
        expect(e.historico.startsWith(`PROVISÃO ${tipo} `)).toBe(true);
      }
      // E nenhum lançamento saiu rotulado com a chave da família.
      expect(__store.entries.some((e) => e.subtipo === "PARC_PARCSN" || e.subtipo === "PARC_PARCMEI")).toBe(false);
    },
  );

  test("o contrato guarda a modalidade crua no `tipo` e no `label`", async () => {
    await criarContrato("RELP_MEI");
    const p = __store.parcelamentos[0];
    expect(p.tipo).toBe("RELP_MEI");
    expect(p.label).toContain("RELP_MEI");
    // O colapso existe SÓ na memória de contas — o contrato não sabe dele.
    expect(p.grupo).toBe("sn_mei");
  });
});
