// O SELO DO TIPO DA CONTA — e o AMARRE com o backend.
//
// ⚠⚠ O teste principal é o amarre de `pontuarCodigoCompleto`: ele importa a função do backend e
// exige o mesmo resultado. Sem ele, "espelho" é intenção e não fato — e o contador leria
// `2.1.1.05.0001` numa tela e outra grafia na mensagem do motor, sobre a MESMA conta.
//
// Mesmo caminho do precedente `portal-cliente-web/.../codigoServicoDaNota.test.js`, que importa a
// autoridade do backend em vez de copiá-la.
import { pontuarCodigoCompleto as pontuarNoBackend } from "../../../../../../../api/src/application/accounting/regras/familiaDaConta.js";
import { TIPO_DE_CONTA, pontuarCodigoCompleto, rotuloDoTipo, selosDaConta } from "../tipoDaConta";

describe("rotuloDoTipo", () => {
  it("traduz os cinco tipos do schema", () => {
    expect(rotuloDoTipo("ATIVO")).toBe("Ativo");
    expect(rotuloDoTipo("PASSIVO")).toBe("Passivo");
    expect(rotuloDoTipo("RECEITA")).toBe("Receita");
    expect(rotuloDoTipo("DESPESA")).toBe("Despesa");
    expect(rotuloDoTipo("PATRIMONIO")).toBe("Patrimônio");
  });

  it("aceita minúscula e espaço — o dado vem do banco, não de um enum tipado", () => {
    expect(rotuloDoTipo(" ativo ")).toBe("Ativo");
  });

  it("⚠⚠ tipo AUSENTE devolve null — e null quer dizer 'não mostre selo', nunca 'desconhecido'", () => {
    // Selo que aparece sempre vira ruído e ninguém lê. Mesma disciplina do INDETERMINADO do motor.
    expect(rotuloDoTipo(null)).toBeNull();
    expect(rotuloDoTipo("")).toBeNull();
    expect(rotuloDoTipo(undefined)).toBeNull();
  });

  it("⚠ tipo que a lista não conhece também não vira selo", () => {
    expect(rotuloDoTipo("COMPENSACAO")).toBeNull();
  });

  it("a lista de tipos é a do schema", () => {
    expect(Object.keys(TIPO_DE_CONTA).sort())
      .toEqual(["ATIVO", "DESPESA", "PASSIVO", "PATRIMONIO", "RECEITA"]);
  });
});

describe("⚠⚠ O AMARRE — a pontuação é a MESMA do backend", () => {
  // As contas REAIS do caso relatado pelo dono, mais as do balancete do sistema de destino.
  const CASOS = [
    "211050001", // IRPJ A RECOLHER
    "211050007", // CSLL A RECOLHER  ← a certa
    "121060003", // CSLL (ATIVO, INCENTIVOS FISCAIS) ← a errada
    "121060002", // IRPJ (ATIVO)
    "331030005", // (-) PIS
    "411030006", // IRPJ (despesa tributária)
    "511010002", // (-) CSLL (o ramo 5, que o balancete traz zerado)
    "111010001", // CAIXA - MATRIZ
    "21105",     // sintética, fora da máscara de 9
    "5",
    "",
  ];

  it.each(CASOS)("%s pontua igual nos dois lados", (cc) => {
    expect(pontuarCodigoCompleto(cc)).toBe(pontuarNoBackend(cc));
  });

  it("a máscara é 1-1-1-2-4", () => {
    expect(pontuarCodigoCompleto("211050007")).toBe("2.1.1.05.0007");
    expect(pontuarCodigoCompleto("121060003")).toBe("1.2.1.06.0003");
  });

  it("⚠ código fora da máscara volta como veio — não se inventa pontuação", () => {
    expect(pontuarCodigoCompleto("21105")).toBe("21105");
    expect(pontuarCodigoCompleto(null)).toBe("");
  });
});

describe("selosDaConta — o que a linha mostra", () => {
  it("o caso que o dono relatou: as duas contas se chamam CSLL e o selo as separa", () => {
    const errada = selosDaConta({ codigo: "137", nome: "CSLL", codigoCompleto: "121060003", tipo: "ATIVO" });
    const certa = selosDaConta({ codigo: "256", nome: "CSLL A RECOLHER", codigoCompleto: "211050007", tipo: "PASSIVO" });
    expect(errada).toEqual({ tipo: "Ativo", completo: "1.2.1.06.0003" });
    expect(certa).toEqual({ tipo: "Passivo", completo: "2.1.1.05.0007" });
  });

  it("⚠ conta sem código completo mostra só o tipo — 13 contas da base estão assim", () => {
    expect(selosDaConta({ tipo: "ATIVO" })).toEqual({ tipo: "Ativo", completo: null });
  });

  it("⚠ conta sem nada devolve os dois nulos, e a tela não desenha selo", () => {
    expect(selosDaConta({})).toEqual({ tipo: null, completo: null });
    expect(selosDaConta(null)).toEqual({ tipo: null, completo: null });
  });
});
