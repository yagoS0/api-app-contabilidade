// A MEMÓRIA DO TOMADOR — o que ela guarda, o que ela NÃO inventa, e a promessa de nunca derrubar
// uma emissão.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA. Não há Prisma de verdade, não há rede: o cliente é um dublê e o
// que se observa são as chamadas que ele recebeu.

import {
  dadosDoTomadorEmitido,
  dadosMudaram,
  registrarTomadorEmitido,
  ACAO,
  CAMPOS_DO_REGISTRO,
} from "../tomadorEmitido.js";

const TOMADOR_COMPLETO = {
  doc: "12219079724",
  nome: "Yago Silva",
  email: "y@example.com",
  endereco: {
    cMun: "3304557",
    CEP: "20000000",
    xLgr: "RUA X",
    nro: "1",
    xCpl: "SALA 2",
    xBairro: "CENTRO",
  },
};

function prismaDuble({ existente = null, aoCriar = null, aoAtualizar = null } = {}) {
  return {
    tomadorEmitido: {
      findUnique: jest.fn(async () => existente),
      create: jest.fn(async (args) => {
        if (aoCriar) throw aoCriar;
        return args.data;
      }),
      update: jest.fn(async (args) => {
        if (aoAtualizar) throw aoAtualizar;
        return args.data;
      }),
    },
  };
}

describe("dadosDoTomadorEmitido — grava SÓ o que a emissão teve", () => {
  it("traduz o tomador validado para a forma da tabela, incluindo o `CEP` → `cep`", () => {
    expect(dadosDoTomadorEmitido(TOMADOR_COMPLETO)).toEqual({
      documento: "12219079724",
      nome: "Yago Silva",
      email: "y@example.com",
      cMun: "3304557",
      cep: "20000000",
      xLgr: "RUA X",
      nro: "1",
      xCpl: "SALA 2",
      xBairro: "CENTRO",
    });
  });

  it("⚠ nota sem e-mail vira registro SEM e-mail — nada é completado por consulta", () => {
    const { email } = dadosDoTomadorEmitido({ ...TOMADOR_COMPLETO, email: null });
    expect(email).toBeNull();
  });

  it("⚠ nota sem endereço vira registro SEM endereço — os seis campos ficam nulos", () => {
    const d = dadosDoTomadorEmitido({ doc: "12219079724", nome: "Yago" });
    expect(d.cMun).toBeNull();
    expect(d.cep).toBeNull();
    expect(d.xLgr).toBeNull();
    expect(d.nro).toBeNull();
    expect(d.xCpl).toBeNull();
    expect(d.xBairro).toBeNull();
  });

  it("⚠ string vazia NÃO vira valor — `\"\"` afirmaria 'tem e é vazio'", () => {
    const d = dadosDoTomadorEmitido({ ...TOMADOR_COMPLETO, email: "   " });
    expect(d.email).toBeNull();
  });

  it("o documento é guardado só com dígitos, como o validador entrega", () => {
    expect(dadosDoTomadorEmitido({ doc: "122.190.797-24", nome: "Yago" }).documento).toBe("12219079724");
  });

  it("⚠ sem documento ou sem nome não há o que lembrar — devolve null", () => {
    expect(dadosDoTomadorEmitido({ nome: "Yago" })).toBeNull();
    expect(dadosDoTomadorEmitido({ doc: "12219079724" })).toBeNull();
    expect(dadosDoTomadorEmitido(null)).toBeNull();
  });
});

describe("dadosMudaram — a comparação que decide se `dadosAtualizadosEm` sobe", () => {
  const novo = dadosDoTomadorEmitido(TOMADOR_COMPLETO);

  it("registro inexistente conta como mudança", () => {
    expect(dadosMudaram(null, novo)).toBe(true);
  });

  it("reemissão idêntica NÃO é mudança", () => {
    expect(dadosMudaram({ ...novo }, novo)).toBe(false);
  });

  it("⚠ cada campo do registro é de fato comparado — nenhum passa despercebido", () => {
    for (const campo of CAMPOS_DO_REGISTRO) {
      expect(dadosMudaram({ ...novo, [campo]: "OUTRA COISA" }, novo)).toBe(true);
    }
  });

  it("`null` e `undefined` são a MESMA ausência — leitura parcial não vira 'mudou'", () => {
    const semEmail = dadosDoTomadorEmitido({ ...TOMADOR_COMPLETO, email: null });
    expect(dadosMudaram({ ...semEmail, email: undefined }, semEmail)).toBe(false);
  });
});

describe("registrarTomadorEmitido — cria, atualiza e sabe quando NÃO mudou", () => {
  const AGORA = new Date("2026-08-19T12:00:00Z");

  it("primeira emissão CRIA, com `ultimaEmissaoEm` e sem `dadosAtualizadosEm`", async () => {
    const prisma = prismaDuble();
    const r = await registrarTomadorEmitido({
      prisma,
      companyId: "c1",
      tomador: TOMADOR_COMPLETO,
      agora: AGORA,
    });

    expect(r.acao).toBe(ACAO.CRIADO);
    const { data } = prisma.tomadorEmitido.create.mock.calls[0][0];
    expect(data.companyId).toBe("c1");
    expect(data.documento).toBe("12219079724");
    expect(data.ultimaEmissaoEm).toBe(AGORA);
    expect(data.dadosAtualizadosEm).toBeUndefined();
  });

  it("⚠ a chave é o documento DENTRO da empresa — nunca o documento sozinho", async () => {
    const prisma = prismaDuble();
    await registrarTomadorEmitido({ prisma, companyId: "c1", tomador: TOMADOR_COMPLETO });
    expect(prisma.tomadorEmitido.findUnique).toHaveBeenCalledWith({
      where: { companyId_documento: { companyId: "c1", documento: "12219079724" } },
    });
  });

  it("⚠ endereço diferente ATUALIZA e carimba `dadosAtualizadosEm`", async () => {
    const existente = { ...dadosDoTomadorEmitido(TOMADOR_COMPLETO), xLgr: "RUA ANTIGA" };
    const prisma = prismaDuble({ existente });

    const r = await registrarTomadorEmitido({
      prisma,
      companyId: "c1",
      tomador: TOMADOR_COMPLETO,
      agora: AGORA,
    });

    expect(r.acao).toBe(ACAO.ATUALIZADO);
    const { data } = prisma.tomadorEmitido.update.mock.calls[0][0];
    expect(data.xLgr).toBe("RUA X");
    expect(data.dadosAtualizadosEm).toBe(AGORA);
    expect(data.ultimaEmissaoEm).toBe(AGORA);
  });

  it("⚠⚠ reemissão IDÊNTICA sobe `ultimaEmissaoEm` e NÃO toca `dadosAtualizadosEm`", async () => {
    const prisma = prismaDuble({ existente: dadosDoTomadorEmitido(TOMADOR_COMPLETO) });

    const r = await registrarTomadorEmitido({
      prisma,
      companyId: "c1",
      tomador: TOMADOR_COMPLETO,
      agora: AGORA,
    });

    expect(r.acao).toBe(ACAO.INALTERADO);
    const { data } = prisma.tomadorEmitido.update.mock.calls[0][0];
    expect(data.ultimaEmissaoEm).toBe(AGORA);
    expect("dadosAtualizadosEm" in data).toBe(false);
  });
});

describe("⚠⚠ NUNCA DERRUBA A EMISSÃO — a invariante que justifica o módulo", () => {
  it("erro do banco na criação vira desfecho, não exceção", async () => {
    const prisma = prismaDuble({ aoCriar: Object.assign(new Error("P2002"), { code: "P2002" }) });
    const log = { warn: jest.fn() };

    await expect(
      registrarTomadorEmitido({ prisma, companyId: "c1", tomador: TOMADOR_COMPLETO, log })
    ).resolves.toEqual({ acao: ACAO.FALHOU, motivo: "P2002" });
    expect(log.warn).toHaveBeenCalled();
  });

  it("erro na leitura também", async () => {
    const prisma = prismaDuble();
    prisma.tomadorEmitido.findUnique.mockRejectedValue(new Error("conexão caiu"));
    const r = await registrarTomadorEmitido({ prisma, companyId: "c1", tomador: TOMADOR_COMPLETO });
    expect(r.acao).toBe(ACAO.FALHOU);
  });

  it("⚠ TABELA AINDA NÃO CRIADA (migration não aplicada) é IGNORADO, não falha", async () => {
    const r = await registrarTomadorEmitido({ prisma: {}, companyId: "c1", tomador: TOMADOR_COMPLETO });
    expect(r.acao).toBe(ACAO.IGNORADO);
  });

  it("sem companyId não escreve nada", async () => {
    const prisma = prismaDuble();
    const r = await registrarTomadorEmitido({ prisma, companyId: null, tomador: TOMADOR_COMPLETO });
    expect(r.acao).toBe(ACAO.IGNORADO);
    expect(prisma.tomadorEmitido.findUnique).not.toHaveBeenCalled();
  });

  it("sem log configurado continua sem lançar", async () => {
    const prisma = prismaDuble({ aoCriar: new Error("qualquer") });
    await expect(
      registrarTomadorEmitido({ prisma, companyId: "c1", tomador: TOMADOR_COMPLETO })
    ).resolves.toMatchObject({ acao: ACAO.FALHOU });
  });
});
