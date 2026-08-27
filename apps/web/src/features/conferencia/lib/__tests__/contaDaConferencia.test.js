// A PONTE ENTRE O QUE O CONTADOR DIGITA E O QUE O SERVIDOR EXIGE.
//
// ⚠⚠ O plano de teste é o do MOCK, de propósito — ele já tem os três estados que importam:
// `400` SINTÉTICA (tem filhas), `401`/`402` analíticas, e `464` com `codigoCompleto` NULO.

import {
  FRASE_DO_MOTIVO_DA_CONTA,
  MOTIVO_DA_CONTA,
  completoDoReduzido,
  contasOferecidas,
  motivoDoSeletorVazio,
  reduzidoDoCompleto,
} from "../contaDaConferencia.js";

const PLANO = [
  { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
  { codigo: "400", codigoCompleto: "41102", nome: "Despesas Gerais", analitica: false },
  { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  { codigo: "402", codigoCompleto: "411020002", nome: "Energia Elétrica", analitica: true },
  // ⚠ o terceiro estado: conta que ainda não foi reimportada
  { codigo: "464", codigoCompleto: null, nome: "Serviços PJ", analitica: null },
];

describe("reduzido → codigoCompleto (o que vai no POST)", () => {
  it("traduz o caso normal", () => {
    expect(completoDoReduzido("401", PLANO)).toMatchObject({ valor: "411020001", motivo: null });
  });

  it("⚠ aceita espaço em volta — o contador digita, não cola", () => {
    expect(completoDoReduzido("  401  ", PLANO).valor).toBe("411020001");
  });

  it("código que não existe RECUSA nomeando", () => {
    const r = completoDoReduzido("999", PLANO);
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO_DA_CONTA.NAO_EXISTE);
  });

  it("⚠⚠ conta SEM codigoCompleto tem motivo PRÓPRIO — o conserto é do PLANO, não da linha", () => {
    const r = completoDoReduzido("464", PLANO);
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO_DA_CONTA.SEM_CODIGO_COMPLETO);
    // ⚠ e ela NÃO se confunde com "não existe": os consertos são opostos
    expect(r.motivo).not.toBe(MOTIVO_DA_CONTA.NAO_EXISTE);
    expect(FRASE_DO_MOTIVO_DA_CONTA[r.motivo]).toMatch(/reimport/i);
  });

  it("⚠⚠ conta SINTÉTICA recusa — a tela antecipa o que o servidor nega", () => {
    const r = completoDoReduzido("400", PLANO);
    expect(r.motivo).toBe(MOTIVO_DA_CONTA.SINTETICA);
    expect(FRASE_DO_MOTIVO_DA_CONTA[r.motivo]).toMatch(/analític/i);
  });

  it("⚠⚠ reduzido AMBÍGUO não escolhe", () => {
    const plano = [...PLANO, { codigo: "401", codigoCompleto: "411029999", nome: "OUTRA", analitica: true }];
    expect(completoDoReduzido("401", plano).motivo).toBe(MOTIVO_DA_CONTA.REDUZIDO_AMBIGUO);
  });

  it("⚠⚠ campo VAZIO não é recusa — é campo vazio, e NUNCA devolve string vazia", () => {
    for (const v of ["", "   ", null, undefined]) {
      const r = completoDoReduzido(v, PLANO);
      expect(r.valor).toBeNull();
      expect(r.motivo).toBeNull();
      // mandar `contaAplicada: ""` faria o servidor recusar com `sem_conta`
      expect(r.valor).not.toBe("");
    }
  });

  it("⚠ a ORDEM: 'não existe' vem antes de 'sintética'", () => {
    // sem a conta no plano, não há o que afirmar sobre ela
    expect(completoDoReduzido("777", PLANO).motivo).toBe(MOTIVO_DA_CONTA.NAO_EXISTE);
  });
});

describe("codigoCompleto → reduzido (o que a tela mostra)", () => {
  it("traduz a sugestão para o número que o contador reconhece", () => {
    expect(reduzidoDoCompleto("411020001", PLANO)).toMatchObject({ valor: "401", motivo: null });
  });

  it("completo fora do plano recusa nomeando", () => {
    expect(reduzidoDoCompleto("999999999", PLANO).motivo).toBe(MOTIVO_DA_CONTA.FORA_DO_PLANO);
  });

  it("⚠⚠ completo AMBÍGUO não escolhe — mesma recusa do servidor", () => {
    const plano = [...PLANO, { codigo: "999", codigoCompleto: "411020001", nome: "GÊMEA", analitica: true }];
    expect(reduzidoDoCompleto("411020001", plano).motivo).toBe(MOTIVO_DA_CONTA.COMPLETO_AMBIGUO);
  });

  it("vazio não é recusa", () => {
    expect(reduzidoDoCompleto("", PLANO)).toMatchObject({ valor: null, motivo: null });
  });

  // ⚠ A IDA E VOLTA é o contrato: o que a tela mostra tem de traduzir de volta no que ela envia.
  it("⚠⚠ ida e volta fecha para toda conta oferecida", () => {
    for (const c of contasOferecidas(PLANO)) {
      const reduzido = reduzidoDoCompleto(c.codigoCompleto, PLANO).valor;
      expect(reduzido).toBe(c.codigo);
      expect(completoDoReduzido(reduzido, PLANO).valor).toBe(c.codigoCompleto);
    }
  });
});

describe("⚠⚠ o que o seletor OFERECE", () => {
  it("não oferece SINTÉTICA — o servidor a recusaria", () => {
    expect(contasOferecidas(PLANO).map((c) => c.codigo)).not.toContain("400");
  });

  it("não oferece conta SEM codigoCompleto — ela viraria CONTA_FORA_DO_PLANO no clique", () => {
    expect(contasOferecidas(PLANO).map((c) => c.codigo)).not.toContain("464");
  });

  it("⚠⚠ OFERECE `analitica: null` que tenha codigoCompleto — ausência não é recusa", () => {
    const plano = [{ codigo: "900", codigoCompleto: "411029000", nome: "NÃO REIMPORTADA", analitica: null }];
    expect(contasOferecidas(plano)).toHaveLength(1);
  });

  it("oferece as analíticas", () => {
    expect(contasOferecidas(PLANO).map((c) => c.codigo).sort()).toEqual(["401", "402", "5"]);
  });
});

describe("⚠ por que o seletor está vazio — três respostas, não uma", () => {
  it("plano inexistente", () => {
    expect(motivoDoSeletorVazio([])).toMatch(/ainda não tem plano/i);
  });

  it("⚠⚠ plano inteiro sem codigoCompleto — medido: 1186 de 1186 num banco real", () => {
    const plano = [{ codigo: "1", codigoCompleto: null, nome: "A", analitica: null }];
    expect(motivoDoSeletorVazio(plano)).toMatch(/código completo/i);
    expect(motivoDoSeletorVazio(plano)).toMatch(/[Rr]eimporte/);
  });

  it("plano só de sintéticas", () => {
    const plano = [{ codigo: "1", codigoCompleto: "4", nome: "A", analitica: false }];
    expect(motivoDoSeletorVazio(plano)).toMatch(/sintéticas/i);
  });

  it("⚠ com conta oferecível, NÃO há motivo — silêncio é a resposta certa", () => {
    expect(motivoDoSeletorVazio(PLANO)).toBeNull();
  });
});
