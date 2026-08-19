// A CLASSIFICAÇÃO DE CADA LINHA — a lista fechada, e o que NUNCA vira "pronta".
//
// ⚠ NADA AQUI EMITE, CONSULTA OU ESCREVE. A função é pura; o teste também.

import {
  classificarLinhaLote,
  classificarPlanilhaLote,
  ESTADO,
  ORIGEM_ENDERECO,
  PENDENCIA,
  CONFERENCIA,
} from "../classificarLinhaLote.js";

const CNPJ = "39254243000191";
const CPF = "12219079724";

const ENDERECO_COMPLETO = {
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Avenida Rio Branco",
  nro: "100",
  xBairro: "Centro",
};

/** A lista oficial do IBGE, injetada. Só as linhas que o teste usa — a forma é `[codigo, nome, uf]`. */
const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
];

function linha(valores, numero = 2) {
  return {
    numero,
    valores: {
      documento: CNPJ,
      nome: "TOMADOR LTDA",
      descricao: "Consultoria contábil",
      valor: "1500,00",
      competencia: "31/07/2026",
      email: "",
      cMun: "",
      cep: "",
      xLgr: "",
      nro: "",
      xBairro: "",
      xCpl: "",
      ...valores,
    },
  };
}

const codigos = (r) => [...r.pendencias, ...r.conferencias].map((p) => p.codigo);

describe("PRONTA — o caminho feliz, e ele exige endereço resolvido", () => {
  it("planilha com endereço completo e município conferido", () => {
    const r = classificarLinhaLote(linha(ENDERECO_COMPLETO), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.origemEndereco).toBe(ORIGEM_ENDERECO.PLANILHA);
    expect(r.pendencias).toEqual([]);
    expect(r.dados.tomador.doc).toBe(CNPJ);
    expect(r.dados.tomador.endereco.CEP).toBe("20031005");
    expect(r.dados.servico.valorServicos).toBe(1500);
    expect(r.dados.competencia.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("⚠ tomador já conhecido: só preencher — sem consulta, sem conferência", () => {
    const r = classificarLinhaLote(linha({}), {
      tomadorConhecido: { ...ENDERECO_COMPLETO, xCpl: "Sala 2" },
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.origemEndereco).toBe(ORIGEM_ENDERECO.MEMORIA);
    expect(r.dados.tomador.endereco.xCpl).toBe("Sala 2");
  });

  it("⚠ o que a planilha traz VENCE a memória — o cliente está afirmando o endereço de hoje", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, xLgr: "Rua Nova" }), {
      tomadorConhecido: { ...ENDERECO_COMPLETO, xLgr: "Rua Antiga" },
      municipios: MUNICIPIOS,
    });
    expect(r.origemEndereco).toBe(ORIGEM_ENDERECO.PLANILHA);
    expect(r.dados.tomador.endereco.xLgr).toBe("Rua Nova");
  });

  it("e-mail em branco NÃO é pendência — o validador não o exige", () => {
    const r = classificarLinhaLote(linha(ENDERECO_COMPLETO), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.dados.tomador.email).toBeNull();
  });
});

describe("CONSULTAR — e só para CNPJ", () => {
  it("CNPJ sem endereço e sem memória pede consulta", () => {
    const r = classificarLinhaLote(linha({}));
    expect(r.estado).toBe(ESTADO.CONSULTAR);
    expect(r.documento).toBe(CNPJ);
  });

  it("⚠⚠ CPF NÃO SE CONSULTA — vira pendência na hora, sem sugerir chamada nenhuma", () => {
    const r = classificarLinhaLote(linha({ documento: CPF }));
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CPF_SEM_ENDERECO);
  });

  it("CPF com endereço na planilha fica PRONTA — nada é consultado", () => {
    const r = classificarLinhaLote(linha({ documento: CPF, ...ENDERECO_COMPLETO }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.tipoDocumento).toBe("CPF");
  });

  it("consulta bem-sucedida com cMun PROVADO preenche o endereço", () => {
    const r = classificarLinhaLote(linha({}), {
      municipios: MUNICIPIOS,
      consulta: {
        ok: true,
        cMunVerificado: true,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av. Rio Branco", nro: "1", xBairro: "Centro" },
      },
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.origemEndereco).toBe(ORIGEM_ENDERECO.CONSULTA);
  });

  it("⚠⚠ consulta cujo cMun NÃO foi provado é RECUSADA — a prova tripla não se pula", () => {
    const r = classificarLinhaLote(linha({}), {
      consulta: {
        ok: true,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av.", nro: "1", xBairro: "Centro" },
      },
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO);
  });

  it("⚠ falha da consulta é pendência DA LINHA, com o motivo — não é erro do cliente", () => {
    const r = classificarLinhaLote(linha({}), { consulta: { ok: false, motivo: "a BrasilAPI não respondeu" } });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_FALHOU);
    expect(r.pendencias[0].texto).toContain("a BrasilAPI não respondeu");
  });

  it("consulta que respondeu sem endereço completo é pendência, com o que faltou", () => {
    const r = classificarLinhaLote(linha({}), {
      consulta: { ok: true, cMunVerificado: true, endereco: null, faltantes: ["o número"] },
    });
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_SEM_ENDERECO);
    expect(r.pendencias[0].texto).toContain("o número");
  });
});

describe("CONFERIR — completa, mas com algo que esta camada não provou", () => {
  it("⚠⚠ sem a lista do IBGE, o cMun da planilha sai `municipio_nao_conferido` e a linha NÃO é PRONTA", () => {
    const r = classificarLinhaLote(linha(ENDERECO_COMPLETO), { municipios: null });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.MUNICIPIO_NAO_CONFERIDO);
    // Os dados continuam montados — a conferência é adiante, não uma recusa.
    expect(r.dados.tomador.endereco.cMun).toBe("3304557");
  });

  it("⚠ zero à esquerda recuperado vai para CONFERÊNCIA — nós mudamos o número que veio", () => {
    const r = classificarLinhaLote(linha({ documento: 1234567890, ...ENDERECO_COMPLETO }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.ZERO_A_ESQUERDA_RECUPERADO);
    expect(r.documento).toBe("01234567890");
  });

  it("⚠ e-mail malformado NÃO derruba a linha: ela sai sem e-mail, marcada", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, email: "financeiro" }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.EMAIL_FORA_DE_FORMA);
    expect(r.dados.tomador.email).toBeNull();
  });
});

describe("PENDENTE — o que só uma pessoa resolve", () => {
  const casos = [
    ["documento em branco", { documento: "" }, PENDENCIA.DOCUMENTO_AUSENTE],
    ["documento fora de forma", { documento: "123" }, PENDENCIA.DOCUMENTO_FORA_DE_FORMA],
    ["CPF com DV errado", { documento: "12219079725" }, PENDENCIA.CPF_DV_INVALIDO],
    ["zero comido sem DV que feche", { documento: 1221907972 }, PENDENCIA.DOCUMENTO_ZERO_A_ESQUERDA],
    ["nome em branco", { nome: "" }, PENDENCIA.NOME_AUSENTE],
    ["descrição em branco", { descricao: "  " }, PENDENCIA.DESCRICAO_AUSENTE],
    ["valor em branco", { valor: "" }, PENDENCIA.VALOR_AUSENTE],
    ["valor ambíguo", { valor: "1.500" }, PENDENCIA.VALOR_AMBIGUO],
    ["valor zero", { valor: "0,00" }, PENDENCIA.VALOR_NAO_POSITIVO],
    ["competência em branco", { competencia: "" }, PENDENCIA.COMPETENCIA_AUSENTE],
    ["competência ilegível", { competencia: "julho" }, PENDENCIA.COMPETENCIA_ILEGIVEL],
  ];

  it.each(casos)("%s", (_nome, valores, codigo) => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, ...valores }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(codigo);
    expect(r.dados).toBeNull();
  });

  it("⚠⚠ ENDEREÇO É TUDO-OU-NADA: meio endereço é pendência, nunca “quase pronta”", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, nro: "" }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.ENDERECO_INCOMPLETO);
    expect(r.pendencias[0].texto).toContain("o número");
  });

  it("⚠ só o complemento preenchido também é meio endereço", () => {
    const r = classificarLinhaLote(linha({ xCpl: "Sala 2" }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.ENDERECO_INCOMPLETO);
  });

  it("código de município fora de forma — e a mensagem diz que NOME não serve", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, cMun: "Rio de Janeiro" }), {
      municipios: MUNICIPIOS,
    });
    expect(codigos(r)).toContain(PENDENCIA.MUNICIPIO_FORA_DE_FORMA);
    expect(r.pendencias[0].texto).toContain("Bom Jesus");
  });

  it("⚠ com a lista injetada, código que não existe nela é RECUSADO", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, cMun: "9999999" }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.MUNICIPIO_INEXISTENTE);
  });

  it("uma linha pode acumular pendências, e todas voltam nomeadas", () => {
    const r = classificarLinhaLote(linha({ nome: "", valor: "", competencia: "" }));
    expect(r.pendencias.length).toBeGreaterThanOrEqual(3);
  });
});

describe("⚠⚠ A LISTA É FECHADA — e o padrão nunca é “pronta”", () => {
  const cenarios = [
    [{}, {}],
    [{}, { municipios: MUNICIPIOS }],
    [ENDERECO_COMPLETO, {}],
    [ENDERECO_COMPLETO, { municipios: MUNICIPIOS }],
    [{ documento: CPF }, { municipios: MUNICIPIOS }],
    [{ documento: "" }, {}],
    [{ documento: 1234567890 }, { municipios: MUNICIPIOS }],
    [{ valor: "1,500" }, { municipios: MUNICIPIOS }],
    [{ email: "x" }, { municipios: MUNICIPIOS, tomadorConhecido: ENDERECO_COMPLETO }],
    [{}, { consulta: { ok: false, motivo: "timeout" } }],
    [{}, { consulta: { ok: true, endereco: null } }],
    [{}, { consulta: { ok: true, cMunVerificado: true, endereco: ENDERECO_COMPLETO } }],
    [{ nro: "10" }, { municipios: MUNICIPIOS }],
  ];

  it("todo código produzido está na lista fechada", () => {
    const conhecidos = new Set([...Object.values(PENDENCIA), ...Object.values(CONFERENCIA)]);
    for (const [valores, opcoes] of cenarios) {
      for (const codigo of codigos(classificarLinhaLote(linha(valores), opcoes))) {
        expect([...conhecidos]).toContain(codigo);
      }
    }
  });

  it("todo estado produzido está na lista fechada", () => {
    for (const [valores, opcoes] of cenarios) {
      expect(Object.values(ESTADO)).toContain(classificarLinhaLote(linha(valores), opcoes).estado);
    }
  });

  it("⚠⚠ PRONTA exige as duas listas vazias E o endereço resolvido — sempre", () => {
    for (const [valores, opcoes] of cenarios) {
      const r = classificarLinhaLote(linha(valores), opcoes);
      if (r.estado !== ESTADO.PRONTA) continue;
      expect(r.pendencias).toEqual([]);
      expect(r.conferencias).toEqual([]);
      expect(r.origemEndereco).not.toBeNull();
      expect(Object.values(ORIGEM_ENDERECO)).toContain(r.origemEndereco);
    }
  });

  it("⚠ linha completamente desconhecida (objeto vazio) NÃO vira pronta", () => {
    const r = classificarLinhaLote({});
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(r.dados).toBeNull();
  });

  it("⚠ toda pendência e toda conferência têm TEXTO — nenhuma é um código mudo", () => {
    for (const [valores, opcoes] of cenarios) {
      const r = classificarLinhaLote(linha(valores), opcoes);
      for (const item of [...r.pendencias, ...r.conferencias]) {
        expect(typeof item.texto).toBe("string");
        expect(item.texto.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("a planilha inteira — e os resultados PARCIAIS de consulta", () => {
  const planilha = [
    linha(ENDERECO_COMPLETO, 2),
    linha({ documento: CNPJ }, 3),
    linha({ documento: "39254243000282" }, 4),
    linha({ documento: CPF }, 5),
    linha({ valor: "1.500", ...ENDERECO_COMPLETO }, 6),
  ];

  it("classifica linha a linha e resume", () => {
    const r = classificarPlanilhaLote(planilha, { municipios: MUNICIPIOS });
    expect(r.resumo).toEqual({ total: 5, prontas: 1, conferir: 0, consultar: 2, pendentes: 2 });
  });

  it("⚠⚠ UMA LINHA RUIM NÃO INVALIDA A PLANILHA — as boas seguem", () => {
    const r = classificarPlanilhaLote(planilha, { municipios: MUNICIPIOS });
    expect(r.linhas[0].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[4].estado).toBe(ESTADO.PENDENTE);
  });

  it("⚠ `aConsultar` traz os CNPJs sem repetição, e nunca um CPF", () => {
    const r = classificarPlanilhaLote(planilha, { municipios: MUNICIPIOS });
    expect(r.aConsultar).toEqual([CNPJ, "39254243000282"]);
    expect(r.aConsultar).not.toContain(CPF);
  });

  it("⚠⚠ RESULTADO PARCIAL: reclassifica o que já foi consultado e deixa o resto em CONSULTAR", () => {
    const r = classificarPlanilhaLote(planilha, {
      municipios: MUNICIPIOS,
      consultas: {
        [CNPJ]: { ok: true, cMunVerificado: true, endereco: ENDERECO_COMPLETO },
        // 39254243000282 ainda não foi consultado — e isso não derruba nada.
      },
    });
    expect(r.linhas[1].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[2].estado).toBe(ESTADO.CONSULTAR);
    expect(r.aConsultar).toEqual(["39254243000282"]);
  });

  it("⚠ o mapa é POR DOCUMENTO: N linhas do mesmo CNPJ consomem UMA consulta", () => {
    const repetidas = [linha({}, 2), linha({}, 3), linha({}, 4)];
    expect(classificarPlanilhaLote(repetidas).aConsultar).toEqual([CNPJ]);
  });

  it("⚠ a memória é buscada pelo documento JÁ CORRIGIDO (zero recolocado)", () => {
    const r = classificarPlanilhaLote([linha({ documento: 1234567890 }, 2)], {
      municipios: MUNICIPIOS,
      tomadoresConhecidos: new Map([["01234567890", ENDERECO_COMPLETO]]),
    });
    expect(r.linhas[0].origemEndereco).toBe(ORIGEM_ENDERECO.MEMORIA);
    expect(r.linhas[0].estado).toBe(ESTADO.CONFERIR); // o zero recuperado continua marcado
  });

  it("aceita Map e objeto simples nos dois mapas", () => {
    const comMap = classificarPlanilhaLote([linha({}, 2)], {
      consultas: new Map([[CNPJ, { ok: true, cMunVerificado: true, endereco: ENDERECO_COMPLETO }]]),
    });
    // ⚠ Sem a lista do IBGE aqui, e mesmo assim PRONTA: o `municipio_nao_conferido` vale para o
    // `cMun` vindo da PLANILHA. O da consulta já veio com a prova tripla feita por quem consultou
    // (`cMunVerificado: true`) — é a prova mudando de camada, não sumindo.
    expect(comMap.linhas[0].estado).toBe(ESTADO.PRONTA);
    const comObjeto = classificarPlanilhaLote([linha({}, 2)], {
      municipios: MUNICIPIOS,
      consultas: { [CNPJ]: { ok: true, cMunVerificado: true, endereco: ENDERECO_COMPLETO } },
    });
    expect(comObjeto.linhas[0].estado).toBe(ESTADO.PRONTA);
  });
});
