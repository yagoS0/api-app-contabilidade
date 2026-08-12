// A TRAVA DA CONTA SINTÉTICA — a regra, sem banco.
//
// Duas invariantes valem mais que todo o resto deste arquivo, e as duas já têm teste nomeado:
//   1) `analitica: null` NUNCA recusa — ausência não é resposta, e recusar no desconhecido travaria
//      o sistema inteiro até o import do plano rodar;
//   2) a trava recusa o que a edição ACRESCENTA, nunca o que ela apenas preserva — senão os 6
//      lançamentos que hoje existem em conta de agregação ficariam presos no próprio caminho que
//      existe para corrigi-los.

import {
  ERRO_CONTA_SINTETICA,
  ehContaSintetica,
  resolverPlanoPorCodigo,
  codigosDasLinhas,
  sinteticasNasLinhas,
  sinteticasIntroduzidas,
  filhasDiretas,
  mensagemRecusa,
} from "../gateContaSintetica.js";

const CAIXA = { codigo: "5", nome: "CAIXA - MATRIZ", codigoCompleto: "111010001", analitica: true };
const RECEITAS = { codigo: "357", nome: "RECEITAS", codigoCompleto: "3", analitica: false };
const EQUIP = { codigo: "169", nome: "EQUIPAMENTOS DE INFORMATICA", codigoCompleto: "12308", analitica: false };
const ANTIGA = { codigo: "464", nome: "CONTA SEM CONTA MÃE", codigoCompleto: null, analitica: null };

const plano = resolverPlanoPorCodigo([CAIXA, RECEITAS, EQUIP, ANTIGA]);

describe("ehContaSintetica — só `false` afirma sintética", () => {
  it("`false` é sintética; `true` não é", () => {
    expect(ehContaSintetica(RECEITAS)).toBe(true);
    expect(ehContaSintetica(CAIXA)).toBe(false);
  });

  it("⚠ `null` NÃO é sintética — conta ainda não reimportada não tem resposta", () => {
    expect(ehContaSintetica(ANTIGA)).toBe(false);
    expect(ehContaSintetica({ codigo: "1" })).toBe(false);
    expect(ehContaSintetica(undefined)).toBe(false);
  });
});

describe("resolverPlanoPorCodigo — empresa vence global, igual ao GET /chart-of-accounts", () => {
  it("a conta da EMPRESA sobrepõe a global de mesmo código", () => {
    const p = resolverPlanoPorCodigo([
      { codigo: "169", nome: "global", analitica: false, portalClientId: null },
      { codigo: "169", nome: "própria", analitica: true, portalClientId: "emp1" },
    ]);
    expect(p.get("169").nome).toBe("própria");
    expect(ehContaSintetica(p.get("169"))).toBe(false);
  });

  it("a ordem de chegada não muda o desempate", () => {
    const p = resolverPlanoPorCodigo([
      { codigo: "169", nome: "própria", analitica: true, portalClientId: "emp1" },
      { codigo: "169", nome: "global", analitica: false, portalClientId: null },
    ]);
    expect(p.get("169").nome).toBe("própria");
  });

  it("código vazio não entra no plano", () => {
    expect(resolverPlanoPorCodigo([{ codigo: "  ", nome: "x" }]).size).toBe(0);
  });
});

describe("codigosDasLinhas — dedup, trim, sem vazio", () => {
  it("mantém a ordem e não repete", () => {
    expect(codigosDasLinhas([{ conta: " 5 " }, { conta: "357" }, { conta: "5" }, { conta: "" }]))
      .toEqual(["5", "357"]);
  });

  it("entrada inválida vira lista vazia", () => {
    expect(codigosDasLinhas(null)).toEqual([]);
  });
});

describe("sinteticasNasLinhas — o que a recusa nomeia", () => {
  it("acha a sintética digitada e traz o nome", () => {
    expect(sinteticasNasLinhas([{ conta: "5" }, { conta: "357" }], plano))
      .toEqual([{ codigo: "357", nome: "RECEITAS" }]);
  });

  it("⚠ conta com `analitica: null` NÃO entra — nem a que não existe no plano", () => {
    expect(sinteticasNasLinhas([{ conta: "464" }, { conta: "9999" }], plano)).toEqual([]);
  });
});

describe("⚠ sinteticasIntroduzidas — a trava recusa a ENTRADA, nunca a permanência", () => {
  it("lançamento NOVO (nada preexistente): a sintética recusa", () => {
    expect(sinteticasIntroduzidas([{ conta: "357" }, { conta: "5" }], [], plano))
      .toEqual([{ codigo: "357", nome: "RECEITAS" }]);
  });

  it("A CORREÇÃO PASSA: trocar a sintética por outra conta esvazia a recusa", () => {
    expect(sinteticasIntroduzidas([{ conta: "5" }, { conta: "464" }], ["357", "5"], plano)).toEqual([]);
  });

  it("editar o lançamento SEM mexer na conta errada passa — a sintética não é nova ali", () => {
    // É o caso dos 6 lançamentos existentes: enquanto o contador não decide a analítica de destino,
    // corrigir valor/data/histórico não pode ficar bloqueado.
    expect(sinteticasIntroduzidas([{ conta: "357" }, { conta: "5" }], ["357", "5"], plano)).toEqual([]);
  });

  it("ACRESCENTAR uma segunda sintética continua sendo recusado", () => {
    expect(sinteticasIntroduzidas([{ conta: "357" }, { conta: "169" }], ["357", "5"], plano))
      .toEqual([{ codigo: "169", nome: "EQUIPAMENTOS DE INFORMATICA" }]);
  });

  it("espaço em branco nos códigos atuais não desliga a comparação", () => {
    expect(sinteticasIntroduzidas([{ conta: "357" }], [" 357 ", null], plano)).toEqual([]);
  });
});

describe("filhasDiretas — a saída que a recusa oferece", () => {
  const escopo = [
    { codigo: "169", nome: "EQUIPAMENTOS DE INFORMATICA", codigoCompleto: "12308" },
    { codigo: "170", nome: "EQUIP. INFORMATICA DIVERSOS", codigoCompleto: "123080001" },
    { codigo: "5", nome: "CAIXA - MATRIZ", codigoCompleto: "111010001" },
  ];

  it("traz a filha, não a própria mãe", () => {
    expect(filhasDiretas({ codigoCompleto: "12308" }, escopo).map((f) => f.codigo)).toEqual(["170"]);
  });

  it("⚠ NETA não é filha DIRETA — havendo intermediária, só a intermediária sai", () => {
    const comNeta = [
      { codigo: "a", codigoCompleto: "3" },
      { codigo: "b", codigoCompleto: "31" },
      { codigo: "c", codigoCompleto: "31102" },
      { codigo: "d", codigoCompleto: "32" },
    ];
    expect(filhasDiretas({ codigoCompleto: "3" }, comNeta).map((f) => f.codigo)).toEqual(["b", "d"]);
  });

  it("sem código completo não se afirma parentesco nenhum", () => {
    expect(filhasDiretas({ codigoCompleto: null }, escopo)).toEqual([]);
  });
});

describe("mensagemRecusa — diz o motivo E a saída", () => {
  it("nomeia a conta, cita a regra da ECD e manda escolher a analítica", () => {
    const msg = mensagemRecusa([{ codigo: "357", nome: "RECEITAS" }]);
    expect(msg).toContain("357 RECEITAS");
    expect(msg).toContain("SINTÉTICA");
    expect(msg).toContain("I250");
    expect(msg.toLowerCase()).toContain("escolha");
  });

  it("no plural fala de cada uma", () => {
    const msg = mensagemRecusa([{ codigo: "357", nome: "RECEITAS" }, { codigo: "169", nome: "EQUIP" }]);
    expect(msg).toContain("357 RECEITAS, 169 EQUIP");
    expect(msg).toContain("para cada uma");
  });

  it("o código do erro é nomeado, no padrão do módulo", () => {
    expect(ERRO_CONTA_SINTETICA).toBe("CONTA_SINTETICA");
  });
});
