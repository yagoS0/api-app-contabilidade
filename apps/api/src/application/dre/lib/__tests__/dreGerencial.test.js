// O DRE GERENCIAL — a regra pura.
//
// > Dono: *"a nossa DRE para o cliente deve ser montada baseada no nosso plano de contas."*
//
// ⚠⚠ O que este arquivo protege é a diferença entre RECEITA e DESPESA. Os dois erros que ele existe
// para impedir são caros e SILENCIOSOS: usar o código reduzido no lugar do completo (41 contas
// apontam para grupos diferentes nos dois), e deixar o DAS cair em despesa quando ele é DEDUÇÃO de
// receita — o que mudaria a receita líquida da empresa sem nenhum erro na tela.

import {
  CAUSA_NAO_CLASSIFICADO,
  LINHAS_DO_DRE,
  linhaDoCodigo,
  montarDreGerencial,
} from "../dreGerencial.js";

/** Uma conta do plano, na forma que `resolverPlanoPorCodigo` devolve (chave = REDUZIDO). */
const plano = (pares) => new Map(pares.map(([reduzido, codigoCompleto, nome]) =>
  [reduzido, { codigo: reduzido, codigoCompleto, nome: nome || codigoCompleto }]));

const lanc = (...lines) => ({ lines });
const D = (conta, valor) => ({ tipo: "D", conta, valor: String(valor) });
const C = (conta, valor) => ({ tipo: "C", conta, valor: String(valor) });

const montar = (lancamentos, planoPorCodigo, competencia = "2026-08") =>
  montarDreGerencial({ lancamentos, planoPorCodigo, competencia });

const valorDe = (dre, chave) => dre.linhas.find((l) => l.chave === chave)?.valor;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A CHAVE É O `codigoCompleto`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o grupo sai do codigoCompleto, NUNCA do reduzido", () => {
  it("⚠⚠ o caso medido: reduzido `5` é CAIXA, completo `5` é IRPJ/CSLL", () => {
    // Usar o reduzido aqui poria o CAIXA na linha de IRPJ/CSLL — receita virando despesa, sem erro
    // nenhum na tela. São 41 contas assim na base.
    const p = plano([["5", "111010001", "CAIXA MATRIZ"]]);
    const dre = montar([lanc(D("5", 1000))], p);
    expect(valorDe(dre, "irpjCsll")).toBe(0);
    // ⚠ E ela também não vira "não classificada": ela EXISTE no plano, só não é do resultado.
    expect(dre.naoClassificado).toEqual([]);
  });

  it("o completo `51101` cai em IRPJ/CSLL", () => {
    const p = plano([["901", "51101", "(-) IRPJ"]]);
    const dre = montar([lanc(D("901", 1000))], p);
    expect(valorDe(dre, "irpjCsll")).toBe(-1000);
  });

  it("⚠ o prefixo MAIS LONGO vence — a linha específica ganha da genérica", () => {
    expect(linhaDoCodigo("41104")).toBe("despesasFinanceiras");
    expect(linhaDoCodigo("41102")).toBe("gerais");
    expect(linhaDoCodigo("311020002")).toBe("receitaBruta");
  });

  it("⚠ código fora de todos os prefixos não pertence a linha nenhuma", () => {
    expect(linhaDoCodigo("111010001")).toBeNull();
    expect(linhaDoCodigo("")).toBeNull();
    expect(linhaDoCodigo(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O DAS É DEDUÇÃO DE RECEITA, NUNCA DESPESA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o DAS cai em DEDUÇÕES, e o dado já decidiu isso", () => {
  it("`331030009 (-) DAS-SIMPLES NACIONAL` entra na dedução, negativa", () => {
    // Ele é débito numa árvore de CRÉDITO (grupo 3), então sai negativo — e é o que faz o total do
    // grupo 3 já ser a receita LÍQUIDA, que é o número que o dono quer ver.
    const p = plano([
      ["100", "31101", "VENDAS"],
      ["200", "331030009", "(-) DAS-SIMPLES NACIONAL"],
    ]);
    const dre = montar([lanc(C("100", 10000)), lanc(D("200", 800))], p);
    expect(valorDe(dre, "receitaBruta")).toBe(10000);
    expect(valorDe(dre, "deducoes")).toBe(-800);
    expect(valorDe(dre, "receitaLiquida")).toBe(9200);
  });

  it("⚠⚠ ele NÃO aparece em despesas tributárias — seriam dois lugares para o mesmo dinheiro", () => {
    const p = plano([["200", "331030009", "(-) DAS"]]);
    const dre = montar([lanc(D("200", 800))], p);
    expect(valorDe(dre, "tributarias")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O SINAL É DECLARADO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o sinal por grupo", () => {
  it("grupo 3 soma C − D; grupos 4 e 5 somam D − C", () => {
    const p = plano([
      ["100", "31101", "VENDAS"],
      ["300", "41101", "SALARIOS"],
    ]);
    const dre = montar([lanc(C("100", 5000), D("300", 2000))], p);
    expect(valorDe(dre, "receitaBruta")).toBe(5000);
    // ⚠ A despesa já sai NEGATIVA na linha, para o total ser uma soma simples. Sem isso, cada
    // consumidor teria de lembrar de subtrair — e um dia um deles não lembraria.
    expect(valorDe(dre, "pessoal")).toBe(-2000);
    expect(valorDe(dre, "resultadoDoPeriodo")).toBe(3000);
  });

  it("⚠⚠ RECEITA NEGATIVA aparece com o sinal que tem — o estorno não se esconde", () => {
    // Caso real da validação: `311020002 MANUTENCAO −3.213,00`, um débito em conta de receita.
    // Zerá-la esconderia o estorno.
    const p = plano([["100", "311020002", "MANUTENCAO"]]);
    const dre = montar([lanc(D("100", 3213))], p);
    expect(valorDe(dre, "receitaBruta")).toBe(-3213);
    const linha = dre.linhas.find((l) => l.chave === "receitaBruta");
    expect(linha.contas[0]).toMatchObject({ codigo: "311020002", valor: -3213 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O BLOCO FINANCEIRO — a única reordenação autorizada.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ `41104` sai de dentro de `411` — decisão do dono, 21/08/2026", () => {
  it("ela vai para o bloco financeiro, fora do operacional", () => {
    const p = plano([
      ["300", "41102", "DESPESAS GERAIS"],
      ["400", "41104", "DESPESAS FINANCEIRAS"],
    ]);
    const dre = montar([lanc(D("300", 100)), lanc(D("400", 50))], p);
    expect(valorDe(dre, "gerais")).toBe(-100);
    expect(valorDe(dre, "despesasFinanceiras")).toBe(-50);
    // ⚠⚠ E ela NÃO entra no resultado OPERACIONAL: é o que a reordenação significa.
    expect(valorDe(dre, "resultadoOperacional")).toBe(-100);
    expect(valorDe(dre, "resultadoDoPeriodo")).toBe(-150);
  });

  it("⚠ nenhuma outra conta é remanejada por analogia", () => {
    // Esta saiu por decisão NOMEADA; qualquer outra exige outra decisão.
    const chaves = LINHAS_DO_DRE.filter((l) => l.tipo === "linha").map((l) => l.chave);
    expect(chaves).toEqual([
      "receitaBruta", "deducoes", "custos", "pessoal", "gerais", "tributarias",
      "depreciacao", "receitasFinanceiras", "despesasFinanceiras", "outrasReceitas", "irpjCsll",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A LINHA "NÃO CLASSIFICADO" — obrigatória, com as três causas separadas.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada some — e cada causa tem conserto diferente", () => {
  it("conta EM BRANCO vira uma causa própria, e NÃO é erro", () => {
    // Medido: 76 linhas e R$ 687.355,94 na base, das quais R$ 321.822,26 de receita. Some com ela e
    // a empresa some do DRE. ⚠ A provisão de guia nasce assim — é estado legítimo.
    const dre = montar([lanc(D("", 500))], plano([]));
    const bloco = dre.naoClassificado.find((n) => n.causa === CAUSA_NAO_CLASSIFICADO.CONTA_EM_BRANCO);
    expect(bloco.valor).toBe(500);
    expect(bloco.frase).toMatch(/estado normal/i);
    expect(bloco.frase).not.toMatch(/erro/i);
  });

  it("conta FORA DO PLANO é outra causa, com outro conserto", () => {
    const dre = montar([lanc(D("999", 300))], plano([["100", "31101"]]));
    const bloco = dre.naoClassificado.find((n) => n.causa === CAUSA_NAO_CLASSIFICADO.FORA_DO_PLANO);
    expect(bloco.valor).toBe(300);
    expect(bloco.contas[0].codigo).toBe("999");
  });

  it("conta SEM `codigoCompleto` é a terceira — ela não foi reimportada", () => {
    const p = new Map([["100", { codigo: "100", codigoCompleto: "", nome: "X" }]]);
    const dre = montar([lanc(C("100", 700))], p);
    const bloco = dre.naoClassificado.find((n) => n.causa === CAUSA_NAO_CLASSIFICADO.SEM_CODIGO_COMPLETO);
    expect(bloco.valor).toBe(700);
    expect(bloco.contas[0].nome).toBe("X");
  });

  it("⚠⚠ as três NÃO se misturam num balde só", () => {
    const p = new Map([["100", { codigo: "100", codigoCompleto: "", nome: "X" }]]);
    const dre = montar([lanc(D("", 1), D("999", 2), C("100", 3))], p);
    expect(dre.naoClassificado.map((n) => n.causa).sort()).toEqual([
      CAUSA_NAO_CLASSIFICADO.CONTA_EM_BRANCO,
      CAUSA_NAO_CLASSIFICADO.FORA_DO_PLANO,
      CAUSA_NAO_CLASSIFICADO.SEM_CODIGO_COMPLETO,
    ].sort());
  });

  it("⚠ o valor é ABSOLUTO — aqui não se sabe o sinal, e chutá-lo seria pior", () => {
    // Sem grupo não há regra de sinal: somar com sinal daria um número que finge saber o que não sabe.
    const dre = montar([lanc(D("", 100), C("", 40))], plano([]));
    expect(dre.naoClassificado[0].valor).toBe(140);
  });

  it("⚠ sem nada não classificado, a lista é VAZIA — não uma linha de zero", () => {
    const dre = montar([lanc(C("100", 10))], plano([["100", "31101"]]));
    expect(dre.naoClassificado).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ VAZIO É RESPOSTA, E TEM NOME.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ empresa sem lançamento", () => {
  it("`semLancamento` é TRUE — e ela não pode virar `R$ 0,00` na tela", () => {
    // Medido: 12 das 34 empresas não têm lançamento nenhum. Zero em toda linha AFIRMA que a empresa
    // não faturou nem gastou nada no mês.
    const dre = montar([], plano([]));
    expect(dre.semLancamento).toBe(true);
    expect(dre.linhas.every((l) => l.valor === 0)).toBe(true);
  });

  it("⚠ com lançamento, `false` — e as duas coisas são distinguíveis", () => {
    const dre = montar([lanc(C("100", 1))], plano([["100", "31101"]]));
    expect(dre.semLancamento).toBe(false);
  });

  it("⚠⚠ lançamento com conta em branco JÁ conta como movimento", () => {
    // Ele existe; o que falta é a classificação. Chamá-lo de "sem lançamento" mandaria o cliente
    // cobrar do contador um lançamento que já foi feito.
    const dre = montar([lanc(D("", 100))], plano([]));
    expect(dre.semLancamento).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o contrato do payload", () => {
  it("`demonstracao: false` — é ele que apaga o selo no portal do cliente", () => {
    // A leitura de lá é `demonstracao !== false`, nunca `=== true`: sem o campo, dado REAL sairia
    // com selo de ficção.
    expect(montar([], plano([])).demonstracao).toBe(false);
  });

  it("⚠ os subtotais são derivados, na ordem — e cada um depende do anterior", () => {
    const p = plano([
      ["100", "31101"], ["200", "331030009"], ["300", "42101"],
      ["400", "41101"], ["500", "51101"],
    ]);
    const dre = montar([
      lanc(C("100", 10000)), lanc(D("200", 800)), lanc(D("300", 3000)),
      lanc(D("400", 2000)), lanc(D("500", 500)),
    ], p);
    expect(valorDe(dre, "receitaLiquida")).toBe(9200);
    expect(valorDe(dre, "lucroBruto")).toBe(6200);
    expect(valorDe(dre, "resultadoOperacional")).toBe(4200);
    expect(valorDe(dre, "resultadoDoPeriodo")).toBe(3700);
  });

  it("⚠ payload torto não quebra", () => {
    expect(montarDreGerencial()).toMatchObject({ semLancamento: true, demonstracao: false });
    expect(montar(null, null).linhas.length).toBe(LINHAS_DO_DRE.length);
    expect(montar([{ lines: null }], plano([])).semLancamento).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ zero é ZERO, nunca `-0`", () => {
  it("linha zerada de grupo NEGATIVO não sai `-0`", () => {
    // `0 * -1` em JS dá `-0`, e ele sobrevive: um formatador que respeite o sinal imprimiria
    // "-R$ 0,00" numa linha que simplesmente não teve movimento.
    const dre = montar([], plano([]));
    for (const l of dre.linhas) expect(Object.is(l.valor, -0)).toBe(false);
  });
});
