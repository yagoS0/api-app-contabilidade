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

  it("⚠⚠ faixa ilegível não vira 'passa' — inclusive com valor ZERO", () => {
    // ⚠ ESTE TESTE PASSAVA POR SORTE DA FIXTURE, achado por auditoria em 25/08/2026: com
    // `valorMin: null` a guarda `Number.isFinite(Number(null))` era TRUE (`Number(null)` é 0), e o
    // teste só passava porque 1500 ∉ [0,0]. Com valor 0, o motor SUGERIA.
    for (const valor of [1500, 0]) {
      const r = sugerirConta(declarado({ valor }), {
        regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: null, valorMax: null })],
        plano: PLANO,
      });
      expect(r.conta).toBeNull();
    }
  });

  it("⚠⚠ PISO ausente não vira R$ 0,00 — a metade inferior da faixa não some", () => {
    const r = sugerirConta(declarado({ valor: 1 }), {
      regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: null, valorMax: 5000 })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
  });

  it("⚠ string vazia no valor também não vira zero", () => {
    const r = sugerirConta(declarado({ valor: "", valorAjustado: null }), {
      regras: [regra({ cnpjFornecedor: "12345678000190", valorMin: 0, valorMax: 5000 })],
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

describe("⚠⚠ OS BUGS DO MOTOR ACHADOS POR AUDITORIA (25/08/2026)", () => {
  it("⚠⚠ FAIXAS DISJUNTAS SEPARAM, não viram conflito", () => {
    // O cenário que JUSTIFICA a faixa existir: mensalidade × compra grande do mesmo fornecedor.
    // A ambiguidade era julgada sobre a lista INTEIRA, antes do filtro — e o motor calava.
    const contexto = {
      regras: [
        regra({ id: "mensal", cnpjFornecedor: "12345678000190", valorMin: 100, valorMax: 500, contaDestino: "411030012" }),
        regra({ id: "compra", cnpjFornecedor: "12345678000190", valorMin: 20000, valorMax: 40000, contaDestino: "411010004" }),
      ],
      plano: PLANO,
    };
    expect(sugerirConta(declarado({ valor: 300 }), contexto)).toMatchObject({ conta: "411030012", regraId: "mensal" });
    expect(sugerirConta(declarado({ valor: 30000 }), contexto)).toMatchObject({ conta: "411010004", regraId: "compra" });
  });

  it("⚠ faixas SOBREPOSTAS com contas diferentes continuam sendo conflito", () => {
    const r = sugerirConta(declarado({ valor: 300 }), {
      regras: [
        regra({ id: "a", cnpjFornecedor: "12345678000190", valorMin: 100, valorMax: 500, contaDestino: "411030012" }),
        regra({ id: "b", cnpjFornecedor: "12345678000190", valorMin: 200, valorMax: 900, contaDestino: "411010004" }),
      ],
      plano: PLANO,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.DIVIDIDO);
  });

  it("⚠⚠ conta da REGRA que não existe no plano NÃO é sugerida", () => {
    // O caminho do histórico já recusava; o da regra não conferia nada. Uma conta apagada do plano
    // depois de a regra nascer virava sugestão que a tela mostra e o servidor recusa no clique.
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "999999999" })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_FORA_DO_PLANO);
  });

  it("⚠⚠ `contaDestino` nulo NUNCA vira a string \"null\"", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: null })],
      plano: PLANO,
    });
    expect(r.conta).toBeNull();
    expect(r.conta).not.toBe("null");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O MOTOR NÃO PODE SUGERIR CONTA SINTÉTICA.
//
// Isto passou a ser obrigatório no instante em que `formaDoLancamento.js` ganhou a trava: sem o
// filtro, a tela ofereceria a conta e o servidor a recusaria no clique — o mesmo defeito que
// `CONTA_FORA_DO_PLANO` existe para fechar, e que uma auditoria já achou uma vez neste arquivo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ conta sintética não é sugerida", () => {
  // ⚠ `analitica: false` é o ÚNICO valor que afirma sintética. O resto do PLANO não declara a
  // coluna — é o estado real de produção, e ele tem de continuar passando.
  const PLANO_COM_SINTETICA = [
    ...PLANO,
    { codigo: "410", codigoCompleto: "411030000", nome: "DESPESAS OPERACIONAIS", analitica: false },
    { codigo: "411", codigoCompleto: "411030099", nome: "ANALITICA DE VERDADE", analitica: true },
    { codigo: "412", codigoCompleto: "411030088", nome: "NAO REIMPORTADA", analitica: null },
  ];

  it("REGRA apontando para sintética não sugere — e diz que a conta é o problema", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411030000" })],
      plano: PLANO_COM_SINTETICA,
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_SINTETICA);
    // ⚠ é SINAL, não silêncio: o `regraId` viaja para o contador poder consertar a regra.
    expect(r.regraId).toBe("r-1");
    expect(r.frase).toMatch(/analític/i);
  });

  it("HISTÓRICO apontando para sintética não sugere", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      regras: [],
      plano: PLANO_COM_SINTETICA,
      historico: [{ text: "GOOGLE CLOUD BRASIL", contaDebito: "410" }],
      portalClientId: "emp-1",
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_SINTETICA);
  });

  // ⚠⚠ A ORDEM: fora-do-plano vem ANTES. Chamar de "sintética" uma conta que nem está no plano
  // mandaria o contador procurar filha analítica de uma conta que não existe.
  it("FORA DO PLANO vence sintética", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "999999999" })],
      plano: PLANO_COM_SINTETICA,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_FORA_DO_PLANO);
  });

  // ⚠⚠ A PROVA DO TRI-ESTADO — com `!analitica` no lugar de `=== false`, as duas caem, e em
  // produção o motor pararia de sugerir para TODO plano ainda não reimportado.
  it("analitica NULA continua sendo sugerida", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411030088" })],
      plano: PLANO_COM_SINTETICA,
    });
    expect(r.conta).toBe("411030088");
  });

  it("analitica AUSENTE continua sendo sugerida — é o plano de hoje", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190" })],
      plano: PLANO_COM_SINTETICA,
    });
    expect(r.conta).toBe("411030012");
  });

  it("analitica TRUE é sugerida", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411030099" })],
      plano: PLANO_COM_SINTETICA,
    });
    expect(r.conta).toBe("411030099");
  });

  // ⚠⚠ TRÊS LEITURAS DE "ESTA CONTA RECEBE LANÇAMENTO?" DIVERGIRIAM. O predicado é importado.
  it("REUSA o gate, não escreve um segundo predicado", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "motorDeSugestao.js"), "utf8");
    expect(fonte).toMatch(/from\s+["']\.\.\/\.\.\/accounting\/lib\/gateContaSintetica\.js["']/);
    const semComentario = fonte.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentario).not.toMatch(/analitica\s*===/);
    expect(semComentario).not.toMatch(/!\s*analitica/);
  });

  // ⚠ O motor continua sem contabilizar nada — a trava não mudou o que ele É.
  it("⚠ a recusa é SUGESTÃO NENHUMA, nunca uma conta alternativa escolhida pelo sistema", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411030000" })],
      plano: PLANO_COM_SINTETICA,
    });
    // ⚠⚠ "nunca o primeiro da lista": ter uma analítica no plano NÃO autoriza elegê-la.
    expect(r.conta).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AMBIGUIDADE NÃO ESCOLHE — nem aqui, nem em `montarLancamento`.
//
// Achado por agente ADVERSARIAL em 26/08/2026: o filtro de sintética foi escrito e este ramo
// vizinho ficou aberto. Com dois `codigoCompleto` iguais, o `.find` elegia UM — sobre um array
// cuja ordem vem do `findMany`, sem `orderBy`, ou seja NÃO DETERMINÍSTICA. A tela sugeriria e o
// servidor recusaria `CONTA_AMBIGUA`: exatamente o defeito que este arquivo diz ter fechado.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ conta ambígua não é sugerida", () => {
  const GEMEAS = [
    ...PLANO,
    { codigo: "701", codigoCompleto: "411099999", nome: "UMA", analitica: true },
    { codigo: "702", codigoCompleto: "411099999", nome: "OUTRA", analitica: true },
  ];

  it("REGRA apontando para código completo duplicado não sugere", () => {
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411099999" })],
      plano: GEMEAS,
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_AMBIGUA);
  });

  it("HISTÓRICO caindo em código completo duplicado não sugere", () => {
    const r = sugerirConta(declarado({ cnpjFornecedor: null }), {
      regras: [],
      plano: GEMEAS,
      historico: [{ text: "GOOGLE CLOUD BRASIL", contaDebito: "701" }],
      portalClientId: "emp-1",
    });
    expect(r.conta).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_AMBIGUA);
  });

  // ⚠ A ORDEM: fora-do-plano → ambígua → sintética. Com duas contas disputando o mesmo completo,
  // não se sabe QUAL é a conta, logo não há o que afirmar sobre ela — nem "é sintética".
  it("AMBÍGUA vence SINTÉTICA", () => {
    const plano = [
      ...PLANO,
      { codigo: "703", codigoCompleto: "411088888", nome: "SINTETICA", analitica: false },
      { codigo: "704", codigoCompleto: "411088888", nome: "ANALITICA", analitica: true },
    ];
    const r = sugerirConta(declarado(), {
      regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411088888" })],
      plano,
    });
    expect(r.motivo).toBe(SEM_SUGESTAO.CONTA_AMBIGUA);
  });

  it("⚠ o resultado NÃO depende da ordem do array — o plano vem de um findMany sem orderBy", () => {
    const pedido = (contas) =>
      sugerirConta(declarado(), {
        regras: [regra({ cnpjFornecedor: "12345678000190", contaDestino: "411099999" })],
        plano: contas,
      }).motivo;
    expect(pedido(GEMEAS)).toBe(pedido([...GEMEAS].reverse()));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A SENTINELA DO `select` — o filtro está a UMA LINHA de ficar cego, e nada segurava.
//
// Provado por sonda de um agente adversarial: com o plano SEM a chave `analitica`, o predicado
// recebe `undefined`, responde `false` para toda conta, e a conta sintética passa **calada**. Os
// testes de varredura acima protegem COMO se compara; este protege DE ONDE VEM O DADO.
//
// É a classe do `legacyCompanySelect`, que este projeto já pagou TRÊS vezes: coluna fora de um
// `select` explícito volta `undefined` SEM ERRO, e a guarda continua existindo sem guardar nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o `select` que alimenta o filtro", () => {
  it("`RegraService.planoDaEmpresa` traz `analitica`", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "..", "RegraService.js"), "utf8");
    // o `select` do plano, e a coluna dentro dele
    const selects = fonte.match(/select:\s*\{[^}]*codigoCompleto[^}]*\}/g) || [];
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect(s).toMatch(/analitica:\s*true/);
  });

  it("⚠ contraprova: o padrão da varredura reconhece a ausência", () => {
    const semColuna = "select: { portalClientId: true, codigo: true, codigoCompleto: true, nome: true },";
    expect(semColuna).not.toMatch(/analitica:\s*true/);
  });
});
