// ⚠⚠ O CASO RELATADO PELO DONO, PONTA A PONTA.
//
// Medido em produção, 24/08/2026: `DARF_CSLL` tinha TRÊS memórias vivas na mesma empresa —
// `595 → 256` (certa) e `595 → 137` (errada, de 05/08; `137` é `1.2.1.06.0003 CSLL`, conta de
// ATIVO sob INCENTIVOS FISCAIS). Como `usageCount` é **0 em quase toda a base**, o desempate caía
// em `updatedAt desc`: vencia a ÚLTIMA ESCRITA, não a correta.
//
// Sem este teste o conserto não está provado — a regra pura passar isolada não diz nada sobre qual
// linha o lookup escolhe.

import { jest } from "@jest/globals";
import { lookupAccountsFromHistorico } from "../AccountingEntryGeneratorService.js";

// O plano real, na parte que importa.
const PLANO = [
  { portalClientId: null, codigo: "595", codigoCompleto: "511010002", nome: "(-) CSLL" },
  { portalClientId: null, codigo: "499", codigoCompleto: "411030005", nome: "CONTRIBUICAO SOCIAL" },
  { portalClientId: null, codigo: "256", codigoCompleto: "211050007", nome: "CSLL A RECOLHER" },
  { portalClientId: null, codigo: "137", codigoCompleto: "121060003", nome: "CSLL" },
  { portalClientId: null, codigo: "419", codigoCompleto: "331030005", nome: "(-) PIS" },
  { portalClientId: null, codigo: "254", codigoCompleto: "211050005", nome: "PIS A RECOLHER" },
  { portalClientId: null, codigo: "240", codigoCompleto: "211040009", nome: "INSS A PAGAR" },
  { portalClientId: null, codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
];

/** Um `tx` de mentira que devolve as memórias na ORDEM em que o `orderBy` real as devolveria. */
function txCom({ empresa = [], globais = [], plano = PLANO } = {}) {
  return {
    accountingHistorico: {
      findMany: jest.fn(async ({ where }) =>
        (where.companyPortalClientId === null ? globais : empresa)),
    },
    chartOfAccount: {
      findMany: jest.fn(async ({ where }) =>
        plano.filter((c) => where.codigo.in.includes(c.codigo))),
    },
  };
}
const args = { portalClientId: "emp-1", eventType: "DARF_CSLL" };

describe("⚠⚠ o lookup PREFERE o par que não viola a natureza", () => {
  it("com a memória ERRADA na frente, devolve a CERTA", async () => {
    // A ordem aqui é a que o banco devolveria: a errada foi escrita por último.
    const tx = txCom({
      empresa: [
        { contaDebito: "595", contaCredito: "137" }, // ← a errada, mais recente
        { contaDebito: "499", contaCredito: "256" }, // ← a certa
      ],
    });
    const r = await lookupAccountsFromHistorico(tx, args);
    expect(r).toEqual({ debitAccountCode: "499", creditAccountCode: "256" });
  });

  it("com só a CERTA, devolve ela (nada muda no caminho feliz)", async () => {
    const tx = txCom({ empresa: [{ contaDebito: "499", contaCredito: "256" }] });
    expect(await lookupAccountsFromHistorico(tx, args))
      .toEqual({ debitAccountCode: "499", creditAccountCode: "256" });
  });

  it("⚠⚠ com NENHUMA válida, devolve a PRIMEIRA — falha para o comportamento antigo, nunca para vazio", async () => {
    // É o estado REAL de IRPJ/CSLL hoje: as duas memórias apontam para o ramo 5, que o balancete
    // do sistema de destino traz zerado. Conta em branco pararia a geração da provisão inteira.
    const tx = txCom({
      empresa: [
        { contaDebito: "595", contaCredito: "256" }, // débito no ramo 5
        { contaDebito: "595", contaCredito: "137" }, // ramo 5 + crédito em ativo
      ],
    });
    expect(await lookupAccountsFromHistorico(tx, args))
      .toEqual({ debitAccountCode: "595", creditAccountCode: "256" });
  });

  it("⚠ candidato ÚNICO nem consulta o plano — não se paga query para não ter escolha", async () => {
    const tx = txCom({ empresa: [{ contaDebito: "595", contaCredito: "137" }] });
    await lookupAccountsFromHistorico(tx, args);
    expect(tx.chartOfAccount.findMany).not.toHaveBeenCalled();
  });

  it("⚠ a conta da EMPRESA vence a GLOBAL na resolução do plano", async () => {
    // O reduzido "137" da empresa aponta para uma conta VÁLIDA de obrigação; a global aponta para
    // o ativo. Vencendo a da empresa, o par passa a ser válido.
    const plano = [
      ...PLANO,
      { portalClientId: "emp-1", codigo: "137", codigoCompleto: "211050007", nome: "CSLL A RECOLHER (propria)" },
      { portalClientId: "emp-1", codigo: "595", codigoCompleto: "411030005", nome: "CONTRIBUICAO SOCIAL (propria)" },
    ];
    const tx = txCom({ empresa: [{ contaDebito: "595", contaCredito: "137" }, { contaDebito: "499", contaCredito: "256" }], plano });
    expect(await lookupAccountsFromHistorico(tx, args))
      .toEqual({ debitAccountCode: "595", creditAccountCode: "137" });
  });
});

describe("⚠ o fallback GLOBAL recebe o MESMO tratamento", () => {
  it("é por ele que o DARF_OUTROS 240→5 (um pagamento memorizado como provisão) hoje ganha", async () => {
    const tx = txCom({
      empresa: [],
      globais: [
        { contaDebito: "240", contaCredito: "5" }, // forma de PAGAMENTO, usageCount 12 na base real
        { contaDebito: "419", contaCredito: "254" }, // uma provisão de verdade
      ],
    });
    const r = await lookupAccountsFromHistorico(tx, { portalClientId: "emp-1", eventType: "DARF_OUTROS" });
    expect(r).toEqual({ debitAccountCode: "419", creditAccountCode: "254" });
  });

  it("sem memória nenhuma, devolve vazio como sempre", async () => {
    expect(await lookupAccountsFromHistorico(txCom({}), args)).toEqual({});
  });
});

describe("⚠ o tipo sai do PREFIXO do evento — BAIXA_* é baixa", () => {
  it("numa BAIXA, `D obrigação / C caixa` é o par VÁLIDO", async () => {
    const tx = txCom({
      empresa: [
        { contaDebito: "419", contaCredito: "254" }, // forma de provisão — inválida numa baixa
        { contaDebito: "254", contaCredito: "5" },   // a forma certa da baixa
      ],
    });
    const r = await lookupAccountsFromHistorico(tx, { portalClientId: "emp-1", eventType: "BAIXA_DARF_PIS" });
    expect(r).toEqual({ debitAccountCode: "254", creditAccountCode: "5" });
  });
});

describe("⚠ best-effort: falha na conferência não zera a memória", () => {
  it("plano indisponível devolve o primeiro candidato", async () => {
    const tx = txCom({ empresa: [{ contaDebito: "595", contaCredito: "137" }, { contaDebito: "499", contaCredito: "256" }] });
    tx.chartOfAccount.findMany = jest.fn(async () => { throw new Error("banco fora"); });
    expect(await lookupAccountsFromHistorico(tx, args))
      .toEqual({ debitAccountCode: "595", creditAccountCode: "137" });
  });
});
