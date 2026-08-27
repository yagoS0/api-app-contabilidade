// A PONTE ENTRE O QUE O CONTADOR DIGITA E O QUE O SERVIDOR EXIGE.
//
// ⚠⚠ O plano de teste é o do MOCK, de propósito — ele já tem os três estados que importam:
// `400` SINTÉTICA (tem filhas), `401`/`402` analíticas, e `464` com `codigoCompleto` NULO.

import {
  CAIXA_CODIGO_COMPLETO,
  ESTADO_DO_PLANO,
  FRASE_DO_MOTIVO_DA_CONTA,
  MOTIVO_DA_CONTA,
  completoDoReduzido,
  contasOferecidas,
  motivoDoSeletorVazio,
  problemaDoCaixa,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE DOIS AGENTES ADVERSARIAIS ACHARAM EM 26/08/2026, e que o pré-voo não pegava.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ codigoCompleto DUPLICADO — a tela oferecia e o servidor recusava", () => {
  // ⚠ Alcançável sem esforço: `codigoCompleto` NÃO tem índice único, e o caso mais provável é
  // ENTRE ESCOPOS (uma global e uma conta própria da empresa com o mesmo completo).
  const GEMEAS = [
    { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
    { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
    { codigo: "912", codigoCompleto: "411020001", nome: "Aluguel (global)", analitica: true },
  ];

  it("o SUBMIT recusa — era o ramo que faltava", () => {
    const r = completoDoReduzido("401", GEMEAS);
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO_DA_CONTA.COMPLETO_AMBIGUO);
  });

  it("⚠ e recusa pelos DOIS reduzidos — não é o segundo que perde", () => {
    expect(completoDoReduzido("912", GEMEAS).motivo).toBe(MOTIVO_DA_CONTA.COMPLETO_AMBIGUO);
  });

  it("⚠⚠ e a lista nem OFERECE as duas — oferecer e recusar no clique é o pior dos dois mundos", () => {
    const oferecidos = contasOferecidas(GEMEAS).map((c) => c.codigo);
    expect(oferecidos).not.toContain("401");
    expect(oferecidos).not.toContain("912");
    expect(oferecidos).toContain("5");
  });

  it("⚠ conta SEM reduzido não é oferecida — o <option> viraria linha em branco", () => {
    const plano = [{ codigo: "", codigoCompleto: "411020009", nome: "SEM REDUZIDO", analitica: true }];
    expect(contasOferecidas(plano)).toHaveLength(0);
  });
});

describe("⚠⚠ O CAIXA — a contrapartida CRAVADA que a tela nunca conferia", () => {
  const comCaixa = (extra = {}) => [
    { codigo: "5", codigoCompleto: CAIXA_CODIGO_COMPLETO, nome: "Caixa", analitica: true, ...extra },
    { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  ];

  it("caixa são não gera problema", () => {
    expect(problemaDoCaixa(comCaixa())).toBeNull();
  });

  it("⚠⚠ SEM o caixa no plano, TODA linha da empresa seria recusada — e a tela dizia nada", () => {
    const semCaixa = comCaixa().filter((c) => c.codigo !== "5");
    expect(problemaDoCaixa(semCaixa)).toMatch(/1\.1\.1\.01\.0001/);
    expect(problemaDoCaixa(semCaixa)).toMatch(/crédito de toda despesa/i);
  });

  it("⚠ caixa AMBÍGUO recusa — nunca 'o primeiro que achar'", () => {
    const dois = [...comCaixa(), { codigo: "7", codigoCompleto: CAIXA_CODIGO_COMPLETO, nome: "Caixa 2", analitica: true }];
    expect(problemaDoCaixa(dois)).toMatch(/não escolhe entre elas/i);
  });

  it("⚠ caixa SINTÉTICO recusa, e manda corrigir o PLANO — não é escolha do contador", () => {
    expect(problemaDoCaixa(comCaixa({ analitica: false }))).toMatch(/plano de contas/i);
  });

  // ⚠ O gatilho medido: conta PRÓPRIA `5` sem codigoCompleto vence a global na dedup, e o caixa
  // some do índice do servidor.
  it("⚠⚠ caixa com codigoCompleto NULO conta como AUSENTE — é o gatilho silencioso", () => {
    const plano = [
      { codigo: "5", codigoCompleto: null, nome: "Caixa", analitica: null },
      { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
    ];
    expect(problemaDoCaixa(plano)).toMatch(/não tem a conta de caixa/i);
  });

  it("⚠ o código é CÓPIA DECLARADA do backend — mudou lá, muda aqui", () => {
    expect(CAIXA_CODIGO_COMPLETO).toBe("111010001");
  });
});

describe("⚠⚠ 'NÃO SEI' NÃO PODE SE PARECER COM 'NÃO TEM'", () => {
  const PLANO_BOM = [{ codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true }];

  it("⚠⚠ consulta que FALHOU não afirma nada sobre o cadastro da empresa", () => {
    const f = motivoDoSeletorVazio([], ESTADO_DO_PLANO.FALHOU);
    expect(f).toMatch(/[Nn]ão foi possível carregar/);
    // ⚠ a frase antiga era uma AFIRMAÇÃO, e ela não pode voltar por este caminho
    expect(f).not.toMatch(/ainda não tem plano/i);
  });

  it("⚠ e ela diz que o problema NÃO é do cadastro — senão o contador vai cadastrar de novo", () => {
    expect(motivoDoSeletorVazio([], ESTADO_DO_PLANO.FALHOU)).toMatch(/não do cadastro/i);
  });

  it("CARREGANDO é um terceiro estado, não 'vazio'", () => {
    expect(motivoDoSeletorVazio([], ESTADO_DO_PLANO.CARREGANDO)).toMatch(/[Cc]arregando/);
  });

  it("⚠ só com o plano OK a tela afirma que a empresa não tem plano", () => {
    expect(motivoDoSeletorVazio([], ESTADO_DO_PLANO.OK)).toMatch(/ainda não tem plano/i);
  });

  it("⚠ o estado FALHOU vence até com contas na mão — a lista seria da empresa anterior", () => {
    expect(motivoDoSeletorVazio(PLANO_BOM, ESTADO_DO_PLANO.FALHOU)).toMatch(/não foi possível/i);
  });

  it("plano OK e com conta oferecível continua em silêncio", () => {
    expect(motivoDoSeletorVazio(PLANO_BOM, ESTADO_DO_PLANO.OK)).toBeNull();
  });

  it("⚠ o padrão é OK — chamador antigo não muda de comportamento", () => {
    expect(motivoDoSeletorVazio(PLANO_BOM)).toBeNull();
  });
});

describe("⚠⚠ o predicado de sintética é IMPORTADO, não reescrito", () => {
  it("⚠ três leituras de 'esta conta recebe lançamento?' divergiriam na primeira correção", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "contaDaConferencia.js"), "utf8");
    expect(fonte).toMatch(/from\s+["']\.\.\/\.\.\/accounting\/entries\/lib\/contaSintetica\.js["']/);
    const semComentario = fonte.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentario).not.toMatch(/function ehSintetica/);
    expect(semComentario).not.toMatch(/analitica\s*===/);
    expect(semComentario).not.toMatch(/!\s*analitica/);
  });
});
