import {
  ehSintetica,
  contasSugeriveis,
  sinteticasNasLinhas,
  sinteticasIntroduzidas,
  motivoContaSintetica,
  avisoContaSintetica,
} from "../contaSintetica.js";

const CAIXA = { codigo: "5", nome: "CAIXA - MATRIZ", analitica: true };
const RECEITAS = { codigo: "357", nome: "RECEITAS", analitica: false };
const ANTIGA = { codigo: "464", nome: "SERVICOS PJ", analitica: null };

describe("ehSintetica — `null` NÃO é sintética", () => {
  it("só `false` afirma sintética", () => {
    expect(ehSintetica(RECEITAS)).toBe(true);
    expect(ehSintetica(CAIXA)).toBe(false);
  });

  it("conta ainda não reimportada (analitica null/ausente) não é afirmada sintética", () => {
    expect(ehSintetica(ANTIGA)).toBe(false);
    expect(ehSintetica({ codigo: "1" })).toBe(false);
    expect(ehSintetica(undefined)).toBe(false);
  });

  it("⚠ `!analitica` daria a resposta errada — é por isso que a comparação é estrita", () => {
    // Se a regra fosse `!conta.analitica`, TODA conta de plano não reimportado sairia sintética
    // e o dropdown ficaria vazio.
    expect(!ANTIGA.analitica).toBe(true);
    expect(ehSintetica(ANTIGA)).toBe(false);
  });
});

describe("contasSugeriveis — a sintética sai da OFERTA", () => {
  it("tira a sintética e mantém analítica e sem-resposta", () => {
    expect(contasSugeriveis([CAIXA, RECEITAS, ANTIGA]).map((c) => c.codigo)).toEqual(["5", "464"]);
  });

  it("plano inteiro sem resposta continua inteiro na sugestão", () => {
    const plano = [ANTIGA, { codigo: "1", nome: "ATIVO" }];
    expect(contasSugeriveis(plano)).toHaveLength(2);
  });

  it("lista vazia/ausente não quebra", () => {
    expect(contasSugeriveis([])).toEqual([]);
    expect(contasSugeriveis(null)).toEqual([]);
  });
});

describe("sinteticasNasLinhas — nomeia o que foi digitado", () => {
  const plano = [CAIXA, RECEITAS, ANTIGA];

  it("acha a sintética digitada", () => {
    expect(sinteticasNasLinhas([{ conta: "357" }], plano)).toEqual([{ codigo: "357", nome: "RECEITAS" }]);
  });

  it("não acusa conta analítica nem conta sem resposta", () => {
    expect(sinteticasNasLinhas([{ conta: "5" }, { conta: "464" }], plano)).toEqual([]);
  });

  it("não repete a mesma conta em duas linhas", () => {
    expect(sinteticasNasLinhas([{ conta: "357" }, { conta: "357" }], plano)).toHaveLength(1);
  });

  it("linha vazia é ignorada", () => {
    expect(sinteticasNasLinhas([{ conta: "" }, { conta: "  " }, {}], plano)).toEqual([]);
  });

  it("sem plano carregado não acusa nada — ausência de dado não é prova", () => {
    expect(sinteticasNasLinhas([{ conta: "357" }], [])).toEqual([]);
    expect(sinteticasNasLinhas([{ conta: "357" }], null)).toEqual([]);
  });

  it("código que não existe no plano não vira sintética (quem cuida disso é contasDesconhecidas)", () => {
    expect(sinteticasNasLinhas([{ conta: "99999" }], plano)).toEqual([]);
  });
});

describe("⚠ sinteticasIntroduzidas — recusa a ENTRADA, nunca a permanência", () => {
  const plano = [CAIXA, RECEITAS, { codigo: "456", nome: "DESPESAS GERAIS", analitica: false }];

  it("num lançamento NOVO (sem códigos atuais) toda sintética conta como acrescentada", () => {
    expect(sinteticasIntroduzidas([{ conta: "357" }], plano, []).map((s) => s.codigo)).toEqual(["357"]);
    expect(sinteticasIntroduzidas([{ conta: "357" }], plano).map((s) => s.codigo)).toEqual(["357"]);
  });

  it("a que JÁ ESTAVA no lançamento não é acrescentada — é o que mantém a correção possível", () => {
    expect(sinteticasIntroduzidas([{ conta: "357" }, { conta: "5" }], plano, ["357", "5"])).toEqual([]);
  });

  it("mas acrescentar uma SEGUNDA continua sendo acrescentar", () => {
    expect(sinteticasIntroduzidas([{ conta: "357" }, { conta: "456" }], plano, ["357"]).map((s) => s.codigo))
      .toEqual(["456"]);
  });
});

describe("motivoContaSintetica — o gate do Salvar", () => {
  const plano = [CAIXA, RECEITAS, { codigo: "456", nome: "DESPESAS GERAIS", analitica: false }];

  it("bloqueia o lançamento novo, nomeando a conta e a saída", () => {
    const motivo = motivoContaSintetica([{ conta: "357" }], plano);
    expect(motivo).toContain("357 RECEITAS");
    expect(motivo).toContain("sintética");
    expect(motivo.toLowerCase()).toContain("escolha uma analítica");
  });

  it("⚠ NÃO bloqueia a edição de um lançamento que já estava na sintética", () => {
    expect(motivoContaSintetica([{ conta: "357" }], plano, ["357"])).toBeNull();
  });

  it("conta analítica e conta sem resposta não bloqueiam nada", () => {
    expect(motivoContaSintetica([{ conta: "5" }, { conta: "464" }], [...plano, ANTIGA])).toBeNull();
  });
});

describe("avisoContaSintetica — a frase da tela", () => {
  const plano = [CAIXA, RECEITAS, { codigo: "456", nome: "DESPESAS GERAIS", analitica: false }];

  it("no lançamento novo é o próprio motivo do bloqueio — a frase e o Salvar dizem a mesma coisa", () => {
    const aviso = avisoContaSintetica([{ conta: "357" }], plano);
    expect(aviso).toBe(motivoContaSintetica([{ conta: "357" }], plano));
    expect(aviso).toContain("357 RECEITAS");
  });

  it("plural com duas contas", () => {
    const aviso = avisoContaSintetica([{ conta: "357" }, { conta: "456" }], plano);
    expect(aviso).toContain("357 RECEITAS");
    expect(aviso).toContain("456 DESPESAS GERAIS");
    expect(aviso).toContain("são contas sintéticas");
  });

  it("⚠ na sintética PREEXISTENTE a frase diz que o lançamento continua editável", () => {
    const aviso = avisoContaSintetica([{ conta: "357" }], plano, ["357"]);
    expect(aviso).toContain("357 RECEITAS");
    expect(aviso).toContain("continua editável");
    // Não é o texto do bloqueio: aqui não há bloqueio nenhum.
    expect(motivoContaSintetica([{ conta: "357" }], plano, ["357"])).toBeNull();
  });

  it("nada a dizer devolve null — aviso permanente é aviso ignorado", () => {
    expect(avisoContaSintetica([{ conta: "5" }], plano)).toBeNull();
    expect(avisoContaSintetica([], plano)).toBeNull();
  });
});
