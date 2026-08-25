// O MOTOR DE SUGESTÃO DE CONTA.
//
// ⚠ O que se prende aqui é a ORDEM das âncoras, a recusa de escolher quando há dúvida, e a
// tradução reduzido → codigoCompleto. Nada aqui contabiliza; o módulo é puro.

import {
  PROCEDENCIA,
  SEM_SUGESTAO,
  chaveDaDescricao,
  sugerirConta,
} from "../motorDeSugestao.js";

/** O plano REAL, na forma que importa: reduzido mutável × completo imutável. */
const PLANO = [
  { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
  { codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PRESTADOS POR PJ" },
  { codigo: "557", codigoCompleto: "411030012", nome: "DESPESAS COM SOFTWARE" },
  { codigo: "418", codigoCompleto: "411010004", nome: "ALUGUEL" },
];

const declarado = (extra = {}) => ({
  cnpjFornecedor: "12345678000190",
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  valor: 1500,
  valorAjustado: null,
  ...extra,
});

const regra = (extra = {}) => ({
  id: "r-1",
  ativa: true,
  suspensaEm: null,
  valorMin: 100,
  valorMax: 5000,
  contaDestino: "411030012",
  ...extra,
});

describe("⚠⚠ A ORDEM DAS ÂNCORAS — CNPJ vence descrição", () => {
  it("regra por CNPJ sugere, com a procedência nomeada", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190" })],
      plano: PLANO,
    });
    expect(r).toMatchObject({ conta: "411030012", procedencia: PROCEDENCIA.REGRA_CNPJ, regraId: "r-1" });
  });

  it("⚠⚠ com as DUAS casando, o CNPJ vence — ele IDENTIFICA, a descrição só se PARECE", () => {
    const r = sugerirConta(declarado(), {
      regras: [
        regra({ id: "por-descricao", padraoDescricao: "GOOGLE CLOUD BRASIL", contaDestino: "411010004" }),
        regra({ id: "por-cnpj", cnpjFornecedor: "12345678000190", contaDestino: "411030012" }),
      ],
      plano: PLANO,
    });
    expect(r.conta).toBe("411030012");
    expect(r.procedencia).toBe(PROCEDENCIA.REGRA_CNPJ);
  });

  it("sem regra de CNPJ, a de descrição vale", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      regras: [regra({ padraoDescricao: "GOOGLE CLOUD BRASIL" })],
      plano: PLANO,
    });
    expect(r.procedencia).toBe(PROCEDENCIA.REGRA_DESCRICAO);
  });

  it("⚠ o CNPJ casa por DÍGITOS — máscara não impede", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: "12.345.678/0001-90" }), {
      regras: [regra({ cnpjFornecedor: "12345678000190" })],
      plano: PLANO,
    });
    expect(r.procedencia).toBe(PROCEDENCIA.REGRA_CNPJ);
  });

  it("⚠⚠ CNPJ ausente NÃO casa com regra de CNPJ — ausência não é igualdade", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      regras: [regra({ cnpjFornecedor: null, contaDestino: "411030012" })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
  });

  it("regra sem âncora nenhuma não casa com nada", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: null, padraoDescricao: null })],
      plano: PLANO,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.NADA_CONHECIDO);
  });
});

describe("⚠⚠ REGRA SUSPENSA NÃO DECIDE — freio que ainda dirige não é freio", () => {
  it("regra suspensa é ignorada", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", suspensaEm: new Date("2026-08-01") })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
  });

  it("regra inativa é ignorada", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", ativa: false })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
  });

  it("regra revogada é ignorada", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", revogadaEm: new Date("2026-08-01") })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
  });
});

describe("⚠⚠ A FAIXA DE VALOR — casou a âncora e fugiu da faixa é SINAL, não silêncio", () => {
  it("valor dentro da faixa sugere", () => {
    expect(sugerirConta(declarado({ valor: 1500 }), {
      regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: 1000, valorMax: 2000 })],
      plano: PLANO,
    }).conta).toBe("411030012");
  });

  it("⚠⚠ 10× fora da faixa NÃO sugere — e diz que havia uma regra", () => {
    // É exatamente o caso que a faixa existe para pegar: fornecedor conhecido, valor absurdo.
    const r = sugerirConta(declarado({ valor: 15000 }), {
      regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: 1000, valorMax: 2000 })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.FORA_DA_FAIXA);
    expect(r.regraId).toBe("r-1");
    expect(r.frase).toMatch(/fora da faixa/i);
  });

  it("⚠ o valor AJUSTADO vence o original na avaliação da faixa", () => {
    // É o ajustado que vira lançamento.
    const r = sugerirConta(declarado({ valor: 1500, valorAjustado: 15000 }), {
      regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: 1000, valorMax: 2000 })],
      plano: PLANO,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.FORA_DA_FAIXA);
  });

  it("⚠ faixa ilegível não vira 'passa' — ela recusa", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: null, valorMax: null })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
  });

  it("os limites são INCLUSIVOS", () => {
    for (const v of [1000, 2000]) {
      expect(sugerirConta(declarado({ valor: v }), {
        regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: 1000, valorMax: 2000 })],
        plano: PLANO,
      }).conta).toBe("411030012");
    }
  });
});

describe("⚠⚠ DUAS REGRAS DISCORDANDO ⇒ NENHUMA VALE", () => {
  it("mesma âncora, contas diferentes, não sugere", () => {
    // Escolher "a mais recente" poria a despesa numa conta que ninguém escolheu, EM SÉRIE.
    const r = sugerirConta(declarado(), {
      regras: [
        regra({ id: "a", cnpjFornecedor: "12345678000190", contaDestino: "411030012" }),
        regra({ id: "b", cnpjFornecedor: "12345678000190", contaDestino: "411010004" }),
      ],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.DIVIDIDO);
  });

  it("⚠ duas regras CONCORDANDO continuam valendo — não é conflito", () => {
    const r = sugerirConta(declarado(), {
      regras: [
        regra({ id: "a", cnpjFornecedor: "12345678000190", contaDestino: "411030012" }),
        regra({ id: "b", cnpjFornecedor: "12345678000190", contaDestino: "411030012" }),
      ],
      plano: PLANO,
    });
    expect(r.conta).toBe("411030012");
  });
});

describe("⚠⚠ O HISTÓRICO GUARDA O REDUZIDO — e a tradução acontece no motor", () => {
  const historico = [{ text: "GOOGLE CLOUD BRASIL", contaDebito: "557" }];

  it("traduz o reduzido para `codigoCompleto` pelo plano DESTA empresa", () => {
    // Medido: 209 de 209 registros da memória guardam o REDUZIDO, zero o codigoCompleto.
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), { historico, plano: PLANO });
    expect(r.conta).toBe("411030012");
    expect(r.procedencia).toBe(PROCEDENCIA.HISTORICO);
  });

  it("⚠⚠ NUNCA devolve o reduzido cru — ele é mutável, e a âncora desta casa é o completo", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), { historico, plano: PLANO });
    expect(r.conta).not.toBe("557");
    expect(r.conta).toMatch(/^\d{9}$/);
  });

  it("⚠ conta que não existe no plano DESTA empresa vira recusa NOMEADA, não silêncio", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      historico: [{ text: "GOOGLE CLOUD BRASIL", contaDebito: "999" }],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_FORA_DO_PLANO);
  });

  it("⚠⚠ reduzido AMBÍGUO dentro do mesmo plano não é escolhido", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      historico,
      plano: [...PLANO, { codigo: "557", codigoCompleto: "411030099", nome: "OUTRA" }],
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_FORA_DO_PLANO);
  });

  it("⚠⚠ HISTÓRICO DIVIDIDO não sugere", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      historico: [
        { text: "GOOGLE CLOUD BRASIL", contaDebito: "557" },
        { text: "GOOGLE CLOUD BRASIL", contaDebito: "418" },
      ],
      plano: PLANO,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.DIVIDIDO);
  });

  it("⚠ a REGRA vence o histórico — ela foi decidida, ele foi observado", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411010004" })],
      historico,
      plano: PLANO,
    });
    expect(r.conta).toBe("411010004");
    expect(r.procedencia).toBe(PROCEDENCIA.REGRA_CNPJ);
  });

  it("⚠ histórico sem conta a débito é ignorado", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      historico: [{ text: "GOOGLE CLOUD BRASIL", contaDebito: null }],
      plano: PLANO,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.NADA_CONHECIDO);
  });
});

describe("⚠ a chave da descrição", () => {
  it("casa grafias diferentes do mesmo fornecedor", () => {
    expect(chaveDaDescricao("Google  Cloud, Brasil")).toBe(chaveDaDescricao("GOOGLE CLOUD BRASIL"));
  });

  it("tira acento", () => {
    expect(chaveDaDescricao("SERVIÇOS MÉDICOS")).toBe("SERVICOS MEDICOS");
  });

  it("⚠ NÃO remove números — ela não é a normalização do dedupe do OFX", () => {
    // Lá remover números faria duas tarifas iguais colapsarem numa só, e uma despesa sumiria.
    expect(chaveDaDescricao("ANTHROPIC 08/26")).toBe("ANTHROPIC 08 26");
  });

  it("ausência vira string vazia, não `undefined`", () => {
    expect(chaveDaDescricao(null)).toBe("");
  });

  it("⚠ descrição vazia não casa com histórico de texto vazio", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null, descricaoOriginal: "" }), {
      historico: [{ text: "", contaDebito: "557" }],
      plano: PLANO,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.NADA_CONHECIDO);
  });
});

describe("⚠ nada conhecido é uma resposta, com frase", () => {
  it("sem regra e sem histórico, diz que não sabe — e que vai aprender", () => {
    const r = sugerirConta(declarado(), { plano: PLANO });
    expect(r).toMatchObject({ conta: null, procedencia: null, motivo: SEM_SUGESTAO.NADA_CONHECIDO });
    expect(r.frase).toMatch(/aprende/i);
  });

  it("toda recusa tem frase", () => {
    for (const motivo of Object.values(SEM_SUGESTAO)) {
      const { FRASE_DO_SEM_SUGESTAO } = require("../motorDeSugestao.js");
      expect(FRASE_DO_SEM_SUGESTAO[motivo]).toBeTruthy();
    }
  });

  it("toda procedência tem frase", () => {
    const { FRASE_DA_PROCEDENCIA } = require("../motorDeSugestao.js");
    for (const p of Object.values(PROCEDENCIA)) expect(FRASE_DA_PROCEDENCIA[p]).toBeTruthy();
  });
});

describe("⚠⚠ ESTE MÓDULO NÃO CONTABILIZA NADA", () => {
  it("a resposta NUNCA carrega um lançamento nem autoriza um", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190" })],
      plano: PLANO,
    });
    // ⚠ Ele sugere uma CONTA e diz de onde veio. Quem leva ao razão é o contador, na fila.
    expect(Object.keys(r).sort()).toEqual(["conta", "frase", "motivo", "procedencia", "regraId"]);
    expect(r).not.toHaveProperty("lancar");
    expect(r).not.toHaveProperty("contabilizar");
  });

  it("⚠ a fonte não importa prisma nem tem relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "motorDeSugestao.js"), "utf8");
    expect(fonte).not.toMatch(/from "@prisma|infrastructure\/db|new Date\(\)/);
  });
});
