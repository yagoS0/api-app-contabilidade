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

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ O ESTADO — o motivo que existia BATIZADO E NUNCA ERA EMITIDO.
  //
  // Achado por dois agentes independentes em 27/08/2026, e alcançável pela própria aba: os selos de
  // estado filtram a fila, então "Contabilizado: 12" + "Contabilizar em lote" punha 12 linhas já
  // contabilizadas dentro do modal, com o botão dizendo "Contabilizar 12". Os 12 POSTs voltavam
  // `TRANSICAO_INVALIDA_NESTE_ESTADO`.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it.each([
    ["CONTABILIZADO", "CONTABILIZADO"],
    ["RECUSADO", "RECUSADO"],
    ["FUNDIDO", "FUNDIDO"],
    ["um estado que esta tela não conhece", "INVENTADO"],
    ["estado ausente", undefined],
  ])("⚠⚠ %s NÃO entra no lote", (_nome, estado) => {
    const r = separarParaOLote([linha({ estado })], opcoes);
    expect(r.dentro).toHaveLength(0);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.ESTADO_NAO_CONFIRMA);
  });

  it("⚠ os dois estados que confirmam continuam entrando", () => {
    expect(separarParaOLote([linha({ estado: "A_CONFERIR" })], opcoes).dentro).toHaveLength(1);
    // ⚠ AGUARDANDO_PAGAMENTO oferece `confirmar`, mas cai no motivo da DATA — que é mais específico.
    const r = separarParaOLote([linha({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null })], opcoes);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.PRECISA_DE_DATA);
  });

  it("⚠⚠ 'não confirma' VENCE 'casa com nota' — para uma linha já lançada, mandar casar é o conselho errado", () => {
    const r = separarParaOLote([linha({ id: "ofx-1", estado: "CONTABILIZADO" })], opcoes);
    expect(r.fora[0].motivo).toBe(FORA_DO_LOTE.ESTADO_NAO_CONFIRMA);
  });

  it("⚠ a leitura do estado é a MESMA da fila (`acoesDaLinha`), não uma segunda", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "contabilizacaoEmLote.js"), "utf8");
    expect(fonte).toMatch(/acoesDaLinha\(item\)\.includes\("confirmar"\)/);
  });

  // ⚠⚠ SEM A LISTA DE QUEM CASA, NÃO HÁ LOTE — guarda de segurança não tem default permissivo.
  it("⚠⚠ `idsQueCasam` ausente RECUSA, em vez de liberar tudo", () => {
    expect(() => separarParaOLote([linha()], { podeEscrever: true, podeEscolherConta: true }))
      .toThrow(/idsQueCasam/);
    expect(() => separarParaOLote([linha()], { idsQueCasam: [], podeEscrever: true })).toThrow(/idsQueCasam/);
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

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ ELA PERCORRE OS ITENS, NÃO AS CHAVES DO MAPA — achado por agente adversarial em 27/08/2026.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ linha SEM chave no mapa é alcançada — antes o botão prometia e não fazia nada", () => {
    const itens = [linha({ id: "d-1" }), linha({ id: "d-2" }), linha({ id: "nova" })];
    // o mapa nasceu antes de `nova` existir
    const r = aplicarEmMassa({ "d-1": "", "d-2": "401" }, "402", itens);
    expect(r.contas.nova).toBe("402");
    expect(r.contas["d-1"]).toBe("402");
    expect(r.contas["d-2"]).toBe("401");
    expect(r.tocadas).toBe(2);
  });

  it("⚠⚠ e `pendentes` concorda com ela — as duas perguntam sobre os MESMOS itens", () => {
    const itens = [linha({ id: "d-1" }), linha({ id: "nova" })];
    const mapa = { "d-1": "" };
    const antes = pendentes(itens, mapa);
    const r = aplicarEmMassa(mapa, "402", itens);
    expect(antes).toBe(2);
    expect(r.tocadas).toBe(antes);
    expect(pendentes(itens, r.contas)).toBe(0);
  });

  it("⚠ chave órfã no mapa (linha que saiu) não é tocada nem inventada", () => {
    const r = aplicarEmMassa({ fantasma: "" }, "402", [linha({ id: "d-1" })]);
    expect(r.contas.fantasma).toBe("");
    expect(r.contas["d-1"]).toBe("402");
  });

  it("⚠ sem a lista de itens ela cai nas chaves do mapa — compatível, e é o único caminho", () => {
    expect(aplicarEmMassa({ "d-1": "" }, "402").contas["d-1"]).toBe("402");
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
    expect(fonte).toMatch(/from\s+["']\.\/conferenciaTela["']/);
    // ⚠⚠ BLOCO ANTES DE LINHA, e a ordem inversa era um FALSO NEGATIVO — achado por agente
    // adversarial em 27/08/2026. Tirando `//` primeiro, um `//` DENTRO de um bloco `/* */` (uma URL
    // de fonte oficial, que é a convenção desta casa) apaga o `*/`, e o regex não-guloso do bloco
    // passa a engolir o CÓDIGO REAL até o `*/` seguinte. Medido: a leitura proibida desaparecia da
    // varredura e o teste ficava verde sobre um arquivo que a continha.
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // nenhuma segunda leitura de "esta linha pode ser confirmada?"
    expect(codigo).not.toMatch(/mesFechado/);
    expect(codigo).not.toMatch(/analitica/);
    // ⚠ CONTRAPROVA DA ORDEM, e ela precisa de DOIS blocos para exercitar o defeito: com `//`
    // tirado primeiro, o `*/` do primeiro bloco desaparece, e o regex não-guloso do bloco passa a
    // casar dali até o `*/` do bloco SEGUINTE — engolindo o código do meio.
    const armadilha = [
      "/* veja https://x.com/y */",
      "const usa = item.mesFechado;",
      "/* outro bloco */",
    ].join("\n");
    const blocoPrimeiro = armadilha.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const linhaPrimeiro = armadilha.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(blocoPrimeiro).toMatch(/mesFechado/);      // a ordem certa PRESERVA o código
    expect(linhaPrimeiro).not.toMatch(/mesFechado/);  // a ordem antiga o ENGOLIA — falso negativo
  });

  it("⚠⚠ ela é varredura de NOME, não prova de comportamento — e isto está escrito", () => {
    // Concatenação (`"mes" + "Fechado"`) passa por ela, e não há como impedir isso com regex. O que
    // ela trava é o renomeio acidental; quem prova o comportamento são os testes acima.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "contabilizacaoEmLote.js"), "utf8");
    expect(fonte).toMatch(/varredura de NOME|não prova de comportamento/i);
  });
});
