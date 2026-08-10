// O IMPORT DE EXCEL NÃO TINHA UM ÚNICO TESTE — e o defeito que ele escondia é o mais caro do
// módulo: a memória de históricos GRAVA por uma chave e LIA por outra.
//
// `upsertHistoricoFromImport` passa o texto por `normalizarHistorico` (Q50), então "PAGO INSS -
// 06/2026" é gravado como "PAGO INSS - {{competencia}}". A leitura comparava com
// `normalizeMatchText` cru, que só troca pontuação por espaço — e as chaves `{}` estão na classe de
// pontuação. Resultado: a memória virava `"pago inss competencia"` e a descrição do arquivo virava
// `"pago inss 06 2026"`. Nem o passo exato nem o de substring casam.
//
// Isso atinge exatamente as descrições recorrentes de tributo, que são as que mais se repetem mês a
// mês — 91 dos 230 registros da memória desta base têm dígito no texto. O bloco 3, abaixo, é a
// regressão: ele FALHA no código antigo (com `normalizeMatchText` no lugar de `chaveDeMatch`) e
// passa no novo.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { accountingHistorico: { findMany: jest.fn(async () => []) } },
}));

import * as XLSX from "xlsx";
import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  parseExcelBuffer,
  normalizeMatchText,
  chaveDeMatch,
  findHistoricoMatches,
} from "../excelImport.js";
import { normalizarHistorico } from "../historicoCompetencia.js";

// ── Fábricas ────────────────────────────────────────────────────────────────

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "Plan1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// Como a memória de fato nasce: o texto passa por `normalizarHistorico` ANTES de ser gravado.
// Escrever a fixture já tokenizada à mão esconderia justamente o passo que produz a divergência.
let seq = 0;
function memoria(textoCru, extra = {}) {
  return {
    id: `h${++seq}`,
    text: normalizarHistorico(textoCru),
    historicoSugerido: null,
    contaDebito: "412",
    contaCredito: "111",
    usageCount: 1,
    companyPortalClientId: "emp-1",
    ...extra,
  };
}

async function casar(descricoes, registros) {
  prisma.accountingHistorico.findMany.mockResolvedValue(registros);
  return findHistoricoMatches({ portalClientId: "emp-1", userId: "u1", descriptions: descricoes });
}

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
});

// ── 1. o parser ─────────────────────────────────────────────────────────────

describe("1. parseExcelBuffer", () => {
  it("lê Data | Descrição | Valor com cabeçalho", () => {
    const t = parseExcelBuffer(planilha([
      ["Data", "Descrição", "Valor"],
      ["05/07/2026", "ALUGUEL SALA 302", "1.250,00"],
      ["08/07/2026", "ENERGIA CEMIG", 210.5],
    ]));

    expect(t).toHaveLength(2);
    expect(t[0].descricao).toBe("ALUGUEL SALA 302");
    expect(t[0].valor).toBeCloseTo(1250, 2);
    expect(t[0].data.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(t[1].valor).toBeCloseTo(210.5, 2);
    // rowIndex é o índice da LINHA no arquivo — com cabeçalho, a 1ª transação é a linha 1.
    expect(t.map((x) => x.rowIndex)).toEqual([1, 2]);
  });

  it("sem cabeçalho, cai na posição 0/1/2 e a 1ª linha JÁ é transação", () => {
    const t = parseExcelBuffer(planilha([
      ["2026-07-05", "ALUGUEL SALA 302", "1250.00"],
      ["2026-07-08", "ENERGIA CEMIG", "210.50"],
    ]));

    expect(t.map((x) => x.rowIndex)).toEqual([0, 1]);
    expect(t[0].descricao).toBe("ALUGUEL SALA 302");
  });

  it("aliases do cabeçalho: 'histórico' e 'vlr' também são reconhecidos", () => {
    const t = parseExcelBuffer(planilha([
      ["Dt", "Histórico", "Vlr"],
      ["05/07/2026", "TARIFA PACOTE", "34,90"],
    ]));
    expect(t).toHaveLength(1);
    expect(t[0].descricao).toBe("TARIFA PACOTE");
  });

  it("⚠ o valor vem em MÓDULO — o sinal do extrato não decide débito/crédito aqui", () => {
    const t = parseExcelBuffer(planilha([
      ["Data", "Descrição", "Valor"],
      ["05/07/2026", "SAIDA", "-1.250,00"],
    ]));
    expect(t[0].valor).toBeCloseTo(1250, 2);
  });

  it("descarta linha sem data, sem descrição ou com valor não positivo", () => {
    const t = parseExcelBuffer(planilha([
      ["Data", "Descrição", "Valor"],
      ["", "SEM DATA", "10,00"],
      ["05/07/2026", "", "10,00"],
      ["05/07/2026", "VALOR ZERO", "0"],
      ["05/07/2026", "BOA", "10,00"],
    ]));
    expect(t.map((x) => x.descricao)).toEqual(["BOA"]);
  });

  it("acima de 5.000 linhas recusa com EXCEL_TOO_MANY_ROWS", () => {
    const linhas = [["Data", "Descrição", "Valor"]];
    for (let i = 0; i < 5001; i++) linhas.push(["05/07/2026", `L${i}`, "1,00"]);
    expect(() => parseExcelBuffer(planilha(linhas))).toThrow(
      expect.objectContaining({ code: "EXCEL_TOO_MANY_ROWS" }),
    );
  });
});

// ── 2. o match, exato e por substring ───────────────────────────────────────

describe("2. findHistoricoMatches", () => {
  it("casa EXATO ignorando caixa, acento e pontuação", async () => {
    const [m] = await casar(["Energia - CEMIG"], [memoria("ENERGIA CEMIG")]);
    expect(m).toMatchObject({ matchType: "exact", contaDebito: "412", contaCredito: "111" });
  });

  it("casa por SUBSTRING quando a descrição do arquivo é mais longa", async () => {
    const [m] = await casar(["ALUGUEL SALA 302 EDIF CENTRAL"], [memoria("ALUGUEL SALA")]);
    expect(m.matchType).toBe("substring");
  });

  it("no empate de substring vence o mais USADO", async () => {
    const [m] = await casar(
      ["TARIFA PACOTE SERVICOS"],
      [
        memoria("TARIFA", { contaDebito: "401", usageCount: 2 }),
        memoria("TARIFA PACOTE", { contaDebito: "402", usageCount: 9 }),
      ],
    );
    expect(m).toMatchObject({ matchType: "substring", contaDebito: "402" });
  });

  it("o EXATO vence o substring mesmo com uso menor", async () => {
    const [m] = await casar(
      ["TARIFA PACOTE"],
      [
        memoria("TARIFA", { contaDebito: "401", usageCount: 99 }),
        memoria("TARIFA PACOTE", { contaDebito: "402", usageCount: 1 }),
      ],
    );
    expect(m).toMatchObject({ matchType: "exact", contaDebito: "402" });
  });

  it("sem candidato devolve null — e null por posição, não buraco na lista", async () => {
    const r = await casar(["ENERGIA CEMIG", "COISA NUNCA VISTA"], [memoria("ENERGIA CEMIG")]);
    expect(r).toHaveLength(2);
    expect(r[0].matchType).toBe("exact");
    expect(r[1]).toBeNull();
  });

  it("devolve o scope e o historicoSugerido da memória", async () => {
    const [global, empresa] = await casar(
      ["ALUGUEL", "ENERGIA"],
      [
        memoria("ALUGUEL", { companyPortalClientId: null, historicoSugerido: "PAGO ALUGUEL DA SEDE" }),
        memoria("ENERGIA"),
      ],
    );
    expect(global).toMatchObject({ scope: "GLOBAL", historicoSugerido: "PAGO ALUGUEL DA SEDE" });
    expect(empresa).toMatchObject({ scope: "COMPANY", historicoSugerido: null });
  });
});

// ── 3. A REGRESSÃO: a competência tokenizada ────────────────────────────────

describe("3. ⚠ REGRESSÃO — a competência tokenizada não pode quebrar o match", () => {
  it("a chave de gravação e a de leitura são a MESMA", () => {
    // Esta é a asserção que reprova o código antigo pela raiz: as duas chaves eram diferentes.
    const cru = "PAGO INSS - 06/2026";
    expect(chaveDeMatch(cru)).toBe(chaveDeMatch(normalizarHistorico(cru)));
    // E a chave crua NÃO batia com a gravada — o que produzia o defeito.
    expect(normalizeMatchText(cru)).not.toBe(normalizeMatchText(normalizarHistorico(cru)));
  });

  it("⚠ 'PAGO INSS - 06/2026' casa com a memória gravada em 06/2026", async () => {
    const [m] = await casar(["PAGO INSS - 06/2026"], [memoria("PAGO INSS - 06/2026")]);
    expect(m).not.toBeNull();
    expect(m.matchType).toBe("exact");
  });

  it("⚠ e casa com a memória gravada em OUTRO mês — é para isso que a competência é tokenizada", async () => {
    // O mês seguinte é o caso REAL: a memória foi criada em junho e o arquivo é o de julho.
    const [m] = await casar(["PAGO INSS - 07/2026"], [memoria("PAGO INSS - 06/2026")]);
    expect(m).not.toBeNull();
    expect(m.matchType).toBe("exact");
    expect(m.contaDebito).toBe("412");
  });

  it("⚠ o formato AAAA-MM também casa com o MM/AAAA — normalizarHistorico conhece os dois", async () => {
    const [m] = await casar(["DAS SIMPLES NACIONAL 2026-07"], [memoria("DAS SIMPLES NACIONAL 06/2026")]);
    expect(m).not.toBeNull();
  });

  it("⚠ registro LEGADO (gravado antes da Q50, com a competência crua) também passa a casar", async () => {
    // A normalização é aplicada nos DOIS lados justamente por causa destes: o texto no banco ainda
    // tem "06/2026" literal, e re-normalizar é idempotente para quem já está canônico.
    const legado = { ...memoria("X"), text: "PAGO INSS - 06/2026" };
    const [m] = await casar(["PAGO INSS - 08/2026"], [legado]);
    expect(m).not.toBeNull();
  });

  it("data COMPLETA no memo não é confundida com competência (o lookbehind de historicoCompetencia)", async () => {
    // "05/06/2026" continua inteira — se virasse "05/{{competencia}}" duas compras de dias
    // diferentes colidiriam numa entrada só da memória.
    const [m] = await casar(["COMPRA 05/06/2026"], [memoria("COMPRA 07/06/2026")]);
    expect(m).toBeNull();
  });

  it("descrições SEM competência continuam se comportando como antes", async () => {
    const [casa, naoCasa] = await casar(
      ["ENERGIA CEMIG", "AGUA COPASA"],
      [memoria("ENERGIA CEMIG")],
    );
    expect(casa.matchType).toBe("exact");
    expect(naoCasa).toBeNull();
  });
});
