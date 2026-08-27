// CONTABILIZAR VÁRIAS LINHAS DE UMA VEZ — e a regra que impede contar a despesa duas vezes.

import {
  FORA_DO_LOTE,
  FRASE_DO_FORA_DO_LOTE,
  aplicarEmMassa,
  contasIniciais,
  debitosQueCasamComNota,
  pendentes,
  planoDoEnvio,
  separarParaOLote,
} from "../contabilizacaoEmLote.js";

const PLANO = [
  { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
  { codigo: "400", codigoCompleto: "41102", nome: "Despesas Gerais", analitica: false },
  { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  { codigo: "402", codigoCompleto: "411020002", nome: "Energia", analitica: true },
  { codigo: "464", codigoCompleto: null, nome: "Serviços PJ", analitica: null },
];

const linha = (extra = {}) => ({
  id: "d-1",
  estado: "A_CONFERIR",
  competencia: "2026-07",
  dataPagamento: "2026-07-15",
  origemPagamento: "OFX",
  mesFechado: false,
  contaSugerida: null,
  sugestao: null,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O DÉBITO QUE JÁ CASA COM UMA NOTA — a regra que impede a DESPESA EM DOBRO.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o débito que casa com nota NÃO entra no lote", () => {
  const casamentos = (linhas) => ({ ok: true, linhas });

  it("débito com SUGESTÃO fica de fora", () => {
    const ids = debitosQueCasamComNota(casamentos([
      { debito: { id: "ofx-1" }, sugestao: { nota: { id: "dec-2" } }, candidatos: [] },
    ]));
    expect(ids.has("ofx-1")).toBe(true);
  });

  it("⚠⚠ débito AMBÍGUO também fica — ambiguidade não autoriza lançar à parte", () => {
    // dois candidatos e nenhuma sugestão: existe nota para casar, e o sistema não sabe qual.
    const ids = debitosQueCasamComNota(casamentos([
      { debito: { id: "ofx-2" }, sugestao: null, candidatos: [{ nota: { id: "a" } }, { nota: { id: "b" } }] },
    ]));
    expect(ids.has("ofx-2")).toBe(true);
  });

  it("⚠ débito SEM candidato nenhum ENTRA — é despesa sem nota, e o lugar dele é aqui", () => {
    const ids = debitosQueCasamComNota(casamentos([
      { debito: { id: "ofx-3" }, sugestao: null, candidatos: [] },
    ]));
    expect(ids.has("ofx-3")).toBe(false);
  });

  it("⚠⚠ a chave é `linhas`, não `casamentos` — o mock já divergiu nisso", () => {
    expect(debitosQueCasamComNota({ casamentos: [{ debito: { id: "x" }, sugestao: { nota: { id: "y" } } }] }).size)
      .toBe(0);
  });

  it("resposta ausente não quebra", () => {
    expect(debitosQueCasamComNota(null).size).toBe(0);
    expect(debitosQueCasamComNota({}).size).toBe(0);
  });

  it("⚠⚠ e a FRASE diz o que fazer — casar no painel, não contabilizar aqui", () => {
    expect(FRASE_DO_FORA_DO_LOTE[FORA_DO_LOTE.CASA_COM_NOTA]).toMatch(/duas vezes/i);
    expect(FRASE_DO_FORA_DO_LOTE[FORA_DO_LOTE.CASA_COM_NOTA]).toMatch(/painel/i);
  });
});

describe("⚠ separar o que entra do que fica de fora", () => {
  const opcoes = { idsQueCasam: new Set(["ofx-1"]), podeEscrever: true, podeEscolherConta: true };

  it("a linha normal entra", () => {
    const r = separarParaOLote([linha()], opcoes);
    expect(r.dentro).toHaveLength(1);
    expect(r.fora).toHaveLength(0);
  });

  it("⚠⚠ o débito que casa fica de fora, COM o motivo — nada some em silêncio", () => {
    const r = separarParaOLote([linha({ id: "ofx-1" })], opcoes);
    expect(r.dentro).toHaveLength(0);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.CASA_COM_NOTA);
  });

  it("⚠⚠ 'casa com nota' VENCE 'mês fechado' — é o motivo mais específico", () => {
    // um débito que casa E está em mês fechado é, antes de tudo, um débito que casa: procurar o
    // conserto na reabertura do mês seria o lugar errado.
    const r = separarParaOLote([linha({ id: "ofx-1", mesFechado: true })], opcoes);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.CASA_COM_NOTA);
  });

  it("mês fechado fica de fora com a frase do PRÉ-VOO, não uma segunda", () => {
    const r = separarParaOLote([linha({ mesFechado: true })], opcoes);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.BLOQUEADA);
    expect(r.fora[0].frase).toMatch(/fechada/i);
  });

  it("⚠ quem não pode escrever não tem lote nenhum", () => {
    const r = separarParaOLote([linha(), linha({ id: "d-2" })], { ...opcoes, podeEscrever: false });
    expect(r.dentro).toHaveLength(0);
    expect(r.fora).toHaveLength(2);
  });

  it("⚠ sem conta oferecível, a linha sem conta conhecida fica de fora", () => {
    const r = separarParaOLote([linha()], { ...opcoes, podeEscolherConta: false });
    expect(r.dentro).toHaveLength(0);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.BLOQUEADA);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ A LINHA SEM DATA DE PAGAMENTO — `confirmar` exigiria a data no MESMO ato.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ nota AGUARDANDO_PAGAMENTO fica de fora — o POST voltaria `sem_data_de_pagamento`", () => {
    const r = separarParaOLote(
      [linha({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null })],
      opcoes,
    );
    expect(r.dentro).toHaveLength(0);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.PRECISA_DE_DATA);
  });

  it("⚠⚠ e a frase manda usar a fila, porque a data digitada é DECLARAÇÃO", () => {
    expect(FRASE_DO_FORA_DO_LOTE[FORA_DO_LOTE.PRECISA_DE_DATA]).toMatch(/declaração/i);
    expect(FRASE_DO_FORA_DO_LOTE[FORA_DO_LOTE.PRECISA_DE_DATA]).toMatch(/uma linha de cada vez/i);
  });

  it("⚠ 'mês fechado' VENCE 'precisa de data' — o impedimento mais geral primeiro", () => {
    const r = separarParaOLote([linha({ dataPagamento: null, mesFechado: true })], opcoes);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.BLOQUEADA);
  });
});

describe("⚠ o campo nasce com a sugestão, no REDUZIDO", () => {
  it("traduz a sugestão", () => {
    const m = contasIniciais([linha({ sugestao: { conta: "411020001" } })], PLANO);
    expect(m["d-1"]).toBe("401");
  });

  it("⚠ sugestão fora do plano deixa VAZIO — nunca a primeira conta", () => {
    expect(contasIniciais([linha({ sugestao: { conta: "999999999" } })], PLANO)["d-1"]).toBe("");
  });

  it("⚠ sem sugestão nenhuma, vazio", () => {
    expect(contasIniciais([linha()], PLANO)["d-1"]).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A APLICAÇÃO EM MASSA SÓ TOCA AS PENDENTES — o estrago silencioso deste modal.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ aplicação em massa", () => {
  const estado = { "d-1": "", "d-2": "401", "d-3": "" };

  it("preenche só as vazias", () => {
    const r = aplicarEmMassa(estado, "402");
    expect(r.contas).toEqual({ "d-1": "402", "d-2": "401", "d-3": "402" });
    expect(r.tocadas).toBe(2);
  });

  it("⚠⚠ NÃO sobrescreve a conta escolhida à mão", () => {
    expect(aplicarEmMassa(estado, "402").contas["d-2"]).toBe("401");
  });

  it("⚠ com tudo preenchido, ela não toca nada — e diz zero", () => {
    const r = aplicarEmMassa({ "d-1": "401", "d-2": "402" }, "5");
    expect(r.tocadas).toBe(0);
  });

  it("⚠ não muta o estado recebido", () => {
    const original = { ...estado };
    aplicarEmMassa(estado, "402");
    expect(estado).toEqual(original);
  });

  it("conta as pendentes", () => {
    expect(pendentes([linha(), linha({ id: "d-2" }), linha({ id: "d-3" })], estado)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O ENVIO — e a linha que não traduz NÃO VAI.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o plano do envio", () => {
  it("traduz o reduzido para o codigoCompleto que o POST leva", () => {
    const r = planoDoEnvio([linha()], { "d-1": "401" }, PLANO);
    expect(r.enviar).toHaveLength(1);
    expect(r.enviar[0].contaCompleta).toBe("411020001");
  });

  it("⚠⚠ linha SEM conta não é enviada — `contaAplicada: \"\"` cairia em `sem_conta`", () => {
    const r = planoDoEnvio([linha()], { "d-1": "" }, PLANO);
    expect(r.enviar).toHaveLength(0);
    expect(r.recusadas[0].motivo).toBe("sem_conta");
  });

  it("⚠⚠ conta SINTÉTICA não é enviada — o servidor a recusaria", () => {
    const r = planoDoEnvio([linha()], { "d-1": "400" }, PLANO);
    expect(r.enviar).toHaveLength(0);
    expect(r.recusadas[0].motivo).toBe("sintetica");
  });

  it("⚠ conta sem codigoCompleto tem recusa própria", () => {
    const r = planoDoEnvio([linha()], { "d-1": "464" }, PLANO);
    expect(r.recusadas[0].motivo).toBe("sem_codigo_completo");
  });

  it("⚠ conta inexistente idem", () => {
    const r = planoDoEnvio([linha()], { "d-1": "99999" }, PLANO);
    expect(r.recusadas[0].motivo).toBe("nao_existe");
  });

  it("⚠⚠ SUCESSO PARCIAL é o desfecho normal — as boas vão, as ruins ficam nomeadas", () => {
    const itens = [linha(), linha({ id: "d-2" }), linha({ id: "d-3" })];
    const r = planoDoEnvio(itens, { "d-1": "401", "d-2": "400", "d-3": "402" }, PLANO);
    expect(r.enviar.map((e) => e.item.id)).toEqual(["d-1", "d-3"]);
    expect(r.recusadas.map((e) => e.item.id)).toEqual(["d-2"]);
  });
});

describe("⚠ a regra é reusada, não reescrita", () => {
  it("⚠⚠ o módulo importa o pré-voo e a tradução — não escreve os seus", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "contabilizacaoEmLote.js"), "utf8");
    expect(fonte).toMatch(/from\s+["']\.\/conferenciaTela["']/);
    expect(fonte).toMatch(/from\s+["']\.\/contaDaConferencia["']/);
    const codigo = fonte.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // nenhuma segunda leitura de "esta linha pode ser confirmada?"
    expect(codigo).not.toMatch(/mesFechado/);
    expect(codigo).not.toMatch(/analitica/);
  });
});
