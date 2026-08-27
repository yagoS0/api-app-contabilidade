// O RELATÓRIO DO EXTRATO — o que vira tela, e as três conclusões falsas que ele existe para impedir.

import {
  TOM,
  avisosDoExtrato,
  contagemDeDescartadas,
  fraseDaAmostraDeDescartes,
  fraseQuandoNadaEntrou,
  frasePorArquivoRepetido,
  leituraDaConta,
  linhasDoRelatorio,
  motivoLegivel,
} from "../relatorioDoExtrato.js";

const relatorio = (extra = {}) => ({
  importId: "imp-1",
  conta: { acctId: "12345-6", bankId: "001" },
  transacoesLidas: 23,
  criados: 20,
  jaImportadas: 3,
  descartadas: [],
  descartadasTotal: 0,
  descartadasTruncadas: false,
  foraDoEscopo: 7,
  recusadas: [],
  anomalias: [],
  arquivoJaImportado: null,
  ...extra,
});

describe("⚠⚠ as três linhas obrigatórias", () => {
  it("as três aparecem, com contagem ZERO inclusive", () => {
    const l = linhasDoRelatorio(relatorio({ criados: 0, jaImportadas: 0, foraDoEscopo: 0 }));
    expect(l.map((x) => x.chave)).toEqual(["criados", "jaImportadas", "foraDoEscopo"]);
    // ⚠ sumir no zero faria "não havia" e "não contei" ficarem iguais
    expect(l.every((x) => x.valor === 0)).toBe(true);
  });

  it("⚠⚠ `jaImportadas` diz que sobreposição é NORMAL — sem isso, reenviar se lê como falha", () => {
    const linha = linhasDoRelatorio(relatorio()).find((x) => x.chave === "jaImportadas");
    expect(linha.nota).toMatch(/sobrep/i);
    expect(linha.tom).toBe(TOM.NEUTRO);
  });

  it("⚠⚠ `foraDoEscopo` é NOMEADO — contar crédito sem dizer é sumir com ele", () => {
    const linha = linhasDoRelatorio(relatorio()).find((x) => x.chave === "foraDoEscopo");
    expect(linha.rotulo).toMatch(/crédito/i);
    expect(linha.nota).toMatch(/[Ss]ó as saídas/);
  });

  it("⚠ nenhuma das três é ATENÇÃO — nada nelas é problema", () => {
    for (const l of linhasDoRelatorio(relatorio())) {
      expect(l.tom).not.toBe(TOM.ATENCAO);
    }
  });
});

describe("⚠⚠ `descartadasTotal` ausente ⇒ PELO MENOS N, nunca N", () => {
  it("com o total, o número é EXATO", () => {
    const r = relatorio({ descartadas: [{ motivo: "sem_data" }], descartadasTotal: 145634 });
    expect(contagemDeDescartadas(r)).toEqual({ total: 145634, exato: true });
    const linha = linhasDoRelatorio(r).find((x) => x.chave === "descartadas");
    expect(linha.valor).toBe(145634);
    expect(linha.aproximado).toBe(false);
  });

  it("⚠⚠ SEM o total, o número é a AMOSTRA e sai marcado como aproximado", () => {
    // servidor antigo, ou mock de outra sessão: o campo não vem
    const r = relatorio({ descartadas: Array.from({ length: 50 }, () => ({ motivo: "sem_data" })) });
    delete r.descartadasTotal;
    expect(contagemDeDescartadas(r)).toEqual({ total: 50, exato: false });
    const linha = linhasDoRelatorio(r).find((x) => x.chave === "descartadas");
    // ⚠ é ESTE campo que impede a tela de escrever "50" com cara de número final
    expect(linha.aproximado).toBe(true);
  });

  it("⚠⚠ `descartadasTotal: 0` é resposta, não ausência — `||` a trataria como ausente", () => {
    const r = relatorio({ descartadas: [], descartadasTotal: 0 });
    expect(contagemDeDescartadas(r)).toEqual({ total: 0, exato: true });
  });

  it("⚠ sem descarte nenhum, a linha nem aparece", () => {
    expect(linhasDoRelatorio(relatorio()).find((x) => x.chave === "descartadas")).toBeUndefined();
  });

  it("descarte é ATENÇÃO, e diz onde ver o motivo", () => {
    const linha = linhasDoRelatorio(relatorio({ descartadas: [{ motivo: "x" }], descartadasTotal: 1 }))
      .find((x) => x.chave === "descartadas");
    expect(linha.tom).toBe(TOM.ATENCAO);
    expect(linha.nota).toMatch(/motivo/i);
  });
});

describe("⚠⚠ '0 novas' NUNCA fica sozinho — os motivos de zero são diferentes", () => {
  it("tudo já importado: a frase diz que é o ESPERADO", () => {
    const f = fraseQuandoNadaEntrou(relatorio({ criados: 0, jaImportadas: 23 }));
    expect(f).toMatch(/já tinham sido importadas/i);
    expect(f).toMatch(/esperado/i);
  });

  // ⚠⚠ A FIXTURE ANTERIOR ERA IMPOSSÍVEL: `transacoesLidas: 0` com `foraDoEscopo: 12`. Medido na
  // fonte, `transacoesLidas` INCLUI os créditos, então `foraDoEscopo > 0 ⇒ transacoesLidas > 0`.
  // O teste passava, a regra estava errada, e o ramo era inalcançável em produção — o mock e o
  // teste sustentavam um ao outro sobre uma forma que o servidor não produz.
  it("arquivo só de créditos tem frase PRÓPRIA — TODAS as lidas são crédito", () => {
    const f = fraseQuandoNadaEntrou(relatorio({ criados: 0, jaImportadas: 0, transacoesLidas: 12, foraDoEscopo: 12 }));
    expect(f).toMatch(/só tem entradas/i);
  });

  it("⚠ com débitos NO MEIO, a frase NÃO é a dos créditos — nem tudo era entrada", () => {
    // 12 lidas, 5 créditos ⇒ havia 7 saídas, e nenhuma virou despesa por outro motivo
    const f = fraseQuandoNadaEntrou(relatorio({ criados: 0, jaImportadas: 0, transacoesLidas: 12, foraDoEscopo: 5 }));
    expect(f).not.toMatch(/só tem entradas/i);
    expect(f).toMatch(/Nenhuma saída/i);
  });

  it("tudo descartado manda ver os motivos", () => {
    const f = fraseQuandoNadaEntrou(
      relatorio({ criados: 0, jaImportadas: 0, foraDoEscopo: 0, descartadas: [{ motivo: "x" }], descartadasTotal: 1 }),
    );
    expect(f).toMatch(/motivos estão listados/i);
  });

  it("⚠ com despesa criada NÃO há frase — silêncio é a resposta certa", () => {
    expect(fraseQuandoNadaEntrou(relatorio())).toBeNull();
  });
});

describe("⚠⚠ o arquivo repetido — a frase que só o hash permite", () => {
  it("diz QUANDO foi enviado antes", () => {
    // ⚠ HORA LOCAL, e é o certo: `arquivoJaImportado.em` é `OfxImport.criadoEm`, um INSTANTE
    // (quando alguém enviou), não uma data civil. Mostrá-lo em UTC diria a hora de Londres ao
    // cliente. ⚠⚠ A fixture usa meio-dia de propósito: `00:00Z` renderizado em UTC−3 cai no dia
    // ANTERIOR, e um teste ancorado nisso quebraria conforme o fuso da máquina que roda a suíte.
    const f = frasePorArquivoRepetido(relatorio({ arquivoJaImportado: { em: "2026-07-10T15:00:00.000Z" } }));
    expect(f).toMatch(/10\/07\/2026/);
  });

  it("⚠ data ilegível não vira 'hoje' nem some — a frase continua valendo sem ela", () => {
    const f = frasePorArquivoRepetido(relatorio({ arquivoJaImportado: { em: "banana" } }));
    expect(f).toMatch(/já tinha sido enviado antes/i);
    expect(f).not.toMatch(/Invalid|NaN/);
  });

  it("arquivo novo não gera frase", () => {
    expect(frasePorArquivoRepetido(relatorio())).toBeNull();
  });
});

describe("⚠ a conta bancária, e o que a ausência dela significa", () => {
  it("com a conta, sem aviso", () => {
    expect(leituraDaConta(relatorio())).toEqual({ rotulo: "Conta 12345-6", aviso: null });
  });

  it("⚠⚠ SEM a conta, o aviso diz a CONSEQUÊNCIA e o que fazer", () => {
    const r = leituraDaConta(relatorio({ conta: { acctId: "", bankId: "001" } }));
    expect(r.rotulo).toMatch(/não identificada/i);
    expect(r.aviso).toMatch(/mesmo valor no mesmo dia/i);
    expect(r.aviso).toMatch(/baixe o extrato de novo/i);
  });

  it("⚠ conta ausente por completo cai no mesmo ramo", () => {
    expect(leituraDaConta(relatorio({ conta: null })).aviso).toBeTruthy();
  });
});

describe("⚠ o vazio", () => {
  it("relatório ausente não quebra e não inventa linha", () => {
    expect(linhasDoRelatorio(null)).toEqual([]);
    expect(fraseQuandoNadaEntrou(null)).toBeNull();
    expect(frasePorArquivoRepetido(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ OS AVISOS DE QUALIDADE DO DEDUPE — que somiam da tela até 26/08/2026.
//
// O servidor devolve TRÊS (`declarados/lib/dedupeOfx.js`), com frase pronta. A tela cobria UM, e
// por conta própria. `sem_fitid` é a mais cara: ela é a EXCEÇÃO à promessa de que reenviar é
// seguro, e estava muda.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ os avisos do dedupe", () => {
  const comAnomalias = (lista) => relatorio({ anomalias: lista });

  it("os três chegam, com a frase DO SERVIDOR", () => {
    const avisos = avisosDoExtrato(comAnomalias([
      { codigo: "sem_conta_bancaria", n: 23, frase: "A conta não veio no arquivo." },
      { codigo: "sem_fitid", n: 4, frase: "Duas iguais no mesmo dia continuam entrando as duas." },
      { codigo: "fitid_repetido", n: 2, frase: "O banco repetiu o identificador." },
    ]));
    expect(avisos.map((a) => a.codigo)).toEqual(["sem_conta_bancaria", "sem_fitid", "fitid_repetido"]);
    expect(avisos[1].frase).toMatch(/mesmo dia/i);
  });

  it("⚠ a tela NÃO reescreve a frase — ela mostra a que veio", () => {
    const avisos = avisosDoExtrato(comAnomalias([{ codigo: "sem_fitid", n: 4, frase: "TEXTO DO SERVIDOR" }]));
    expect(avisos[0].frase).toBe("TEXTO DO SERVIDOR");
  });

  it("⚠⚠ aviso SEM frase é descartado — código cru não chega ao olho do cliente", () => {
    expect(avisosDoExtrato(comAnomalias([{ codigo: "sem_fitid", n: 4 }]))).toEqual([]);
  });

  it("sem anomalias, silêncio", () => {
    expect(avisosDoExtrato(relatorio())).toEqual([]);
    expect(avisosDoExtrato(null)).toEqual([]);
  });
});

describe("⚠⚠ o MOTIVO na língua do cliente", () => {
  it("usa a frase do servidor quando ela vem", () => {
    expect(motivoLegivel({ motivo: "sem_data", frase: "A transação não traz data de lançamento." }))
      .toBe("A transação não traz data de lançamento.");
  });

  it("⚠ sem a frase, o CÓDIGO é a reserva — melhor que um traço, mas não é o padrão", () => {
    expect(motivoLegivel({ motivo: "sem_data" })).toBe("sem_data");
  });

  it("⚠ sem nada, traço — nunca 'undefined' na tela", () => {
    expect(motivoLegivel({})).toBe("—");
    expect(motivoLegivel(null)).toBe("—");
  });
});

describe("⚠ a frase da amostra saiu do JSX", () => {
  it("só existe quando há truncamento", () => {
    expect(fraseDaAmostraDeDescartes(relatorio())).toBeNull();
    const r = relatorio({
      descartadas: Array.from({ length: 50 }, () => ({ motivo: "sem_data" })),
      descartadasTotal: 145634,
      descartadasTruncadas: true,
    });
    expect(fraseDaAmostraDeDescartes(r)).toBe("Mostrando as 50 primeiras de 145634.");
  });

  it("⚠ marcada como truncada mas com total igual à amostra NÃO gera frase — ela seria falsa", () => {
    const r = relatorio({
      descartadas: [{ motivo: "x" }],
      descartadasTotal: 1,
      descartadasTruncadas: true,
    });
    expect(fraseDaAmostraDeDescartes(r)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE O AGENTE ADVERSARIAL REFUTOU EM 26/08/2026.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as recusadas derrubam as frases de TOTALIDADE", () => {
  it("⚠⚠ com recusadas, NÃO diz 'todas já tinham sido importadas' — dez foram RECUSADAS", () => {
    const f = fraseQuandoNadaEntrou(relatorio({
      criados: 0, jaImportadas: 5, recusadas: Array.from({ length: 10 }, () => ({ motivo: "x" })),
    }));
    expect(f).not.toMatch(/todas as saídas/i);
    expect(f).not.toMatch(/é o esperado/i);
    expect(f).toMatch(/10 saídas foram recusadas/i);
  });

  it("⚠⚠ com recusadas, NÃO diz 'nenhuma saída foi encontrada' — quarenta foram", () => {
    const f = fraseQuandoNadaEntrou(relatorio({
      criados: 0, jaImportadas: 0, foraDoEscopo: 0,
      recusadas: Array.from({ length: 40 }, () => ({ motivo: "x" })),
    }));
    expect(f).not.toMatch(/Nenhuma saída foi encontrada/i);
    expect(f).toMatch(/40 saídas foram recusadas/i);
  });

  it("⚠ uma só recusada fala no singular", () => {
    const f = fraseQuandoNadaEntrou(relatorio({ criados: 0, jaImportadas: 0, recusadas: [{ motivo: "x" }] }));
    expect(f).toMatch(/uma saída foi recusada/i);
  });

  it("⚠ e a frase diz ONDE ver o motivo", () => {
    const f = fraseQuandoNadaEntrou(relatorio({ criados: 0, jaImportadas: 0, recusadas: [{ motivo: "x" }] }));
    expect(f).toMatch(/motivos estão listados abaixo/i);
  });

  it("⚠ sem recusadas, as frases antigas continuam valendo", () => {
    expect(fraseQuandoNadaEntrou(relatorio({ criados: 0, jaImportadas: 23 }))).toMatch(/esperado/i);
  });
});

describe("⚠⚠ o total NUNCA é menor que a amostra que a tela desenha", () => {
  const comAmostra = (total) => relatorio({
    descartadas: Array.from({ length: 50 }, () => ({ motivo: "sem_data" })),
    descartadasTotal: total,
  });

  it.each([-1, -145634, 0])("⚠⚠ total %p não apaga os 50 descartes nomeados", (total) => {
    const r = contagemDeDescartadas(comAmostra(total));
    expect(r.total).toBe(50);
    // a linha CONTINUA existindo — era ela que sumia junto com a tabela
    expect(linhasDoRelatorio(comAmostra(total)).find((x) => x.chave === "descartadas")).toBeDefined();
  });

  it("⚠ `[]` vira 0 no `Number` e caía no mesmo buraco", () => {
    expect(contagemDeDescartadas(comAmostra([])).total).toBe(50);
  });

  it("⚠ total MAIOR que a amostra continua vencendo — é o caso normal", () => {
    expect(contagemDeDescartadas(comAmostra(145634)).total).toBe(145634);
  });
});
