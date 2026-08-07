// A CÉLULA DE VALOR ACEITA FÓRMULA — e o que estes testes protegem NÃO é a aritmética.
//
// Somar 10+10 qualquer coisa acerta. O que custa caro aqui são duas classes de erro:
//
//  1. LER O SEPARADOR ERRADO. "1.234" pode ser mil duzentos e trinta e quatro ou um vírgula
//     duzentos e trinta e quatro. Errar não produz um valor um pouco diferente — produz um valor
//     mil vezes maior, num lançamento contábil.
//  2. DEVOLVER 0 POR DESISTÊNCIA. Fórmula quebrada que vira zero grava um lançamento de zero reais
//     sem uma palavra. É por isso que quase todo teste abaixo checa `ok: false`, não um número.

import { avaliarValor, valorUtilizavel } from "../valorFormula";
import { fmtValor } from "../accountingEntriesShared";

const valorDe = (t) => avaliarValor(t).valor;

describe("número digitado direto (sem '=')", () => {
  it("inteiro simples", () => {
    expect(valorDe("100")).toBe(100);
  });

  it("campo vazio NÃO é erro — é o estado inicial da linha", () => {
    // Juntar "vazio" com "inválido" faria a linha recém-aberta nascer acusando erro.
    const r = avaliarValor("");
    expect(r).toMatchObject({ ok: true, valor: null, vazio: true });
    expect(avaliarValor("   ")).toMatchObject({ vazio: true });
    expect(avaliarValor(null)).toMatchObject({ vazio: true });
  });
});

// ── A regra que decide ordem de grandeza ────────────────────────────────────
describe("⚠ separador decimal pt-BR", () => {
  it("'1.234,56' → 1234.56 (vírgula manda: pontos viram milhar)", () => {
    expect(valorDe("1.234,56")).toBe(1234.56);
  });

  it("'10,5' → 10.5", () => {
    expect(valorDe("10,5")).toBe(10.5);
  });

  it("'10.5' e '10.50' → 10.5 (ponto com 1-2 dígitos é decimal: teclado numérico)", () => {
    // Este é o caso que mais aparece na prática, e o que uma regra "ponto é sempre milhar"
    // transformaria em 105 e 1050.
    expect(valorDe("10.5")).toBe(10.5);
    expect(valorDe("10.50")).toBe(10.5);
  });

  it("'1.234' → 1234 (ponto com exatamente 3 dígitos é milhar)", () => {
    expect(valorDe("1.234")).toBe(1234);
  });

  it("'1.234.567' → 1234567 (vários pontos só fazem sentido como milhar)", () => {
    expect(valorDe("1.234.567")).toBe(1234567);
  });

  it("⚠ '1,234.56' (formato en-US colado de planilha) é RECUSADO", () => {
    // O caso mais caro do arquivo. Lido como brasileiro, "1,234.56" viraria 1,23 — erro de 1000×
    // PARA BAIXO, vindo de um copiar-e-colar corriqueiro. A posição relativa denuncia: em pt-BR a
    // vírgula é sempre a ÚLTIMA pontuação do número.
    const r = avaliarValor("1,234.56");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("numero_ambiguo");
  });

  it("'10,5.3' é RECUSADO — mistura os dois e o parser não adivinha", () => {
    const r = avaliarValor("10,5.3");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("numero_ambiguo");
  });

  it("⚠ malformados são RECUSADOS, não 'consertados'", () => {
    // Uma versão anterior era permissiva e transformava cada um destes num número plausível:
    // 1.23.4 → 1234, 1.2345,67 → 12345.67, 1234.500 → 1234500. Nenhum é um número que alguém quis
    // escrever, e todos saíam com cara de valor válido.
    for (const lixo of ["1,2,3", "1.23.4", "1.2345,67", "1234.500", "1.2.3.4"]) {
      const r = avaliarValor(lixo);
      expect(r.ok).toBe(false);
      expect(r.valor).toBeUndefined();
    }
  });

  it("⚠ PONTO CEGO ASSUMIDO: '2.500' lê 2500, não 2,50", () => {
    // Não há como distinguir pelo texto. Fica registrado como comportamento ESPERADO para ninguém
    // "consertar" isso depois sem entender: quem cobre esse buraco é a PRÉVIA na tela, que mostra
    // "= 2.500,00" antes de salvar. Removeu a prévia, esta linha vira um risco.
    expect(valorDe("2.500")).toBe(2500);
  });
});

describe("fórmula com '='", () => {
  it("o caso do pedido: '=10+10' → 20", () => {
    expect(valorDe("=10+10")).toBe(20);
  });

  it("respeita precedência", () => {
    expect(valorDe("=10+2*3")).toBe(16);
  });

  it("parênteses vencem a precedência", () => {
    expect(valorDe("=(100-40)/2")).toBe(30);
  });

  it("fórmula com número no formato brasileiro", () => {
    expect(valorDe("=1.234,56+10")).toBe(1244.56);
    expect(valorDe("=10,50*3")).toBe(31.5);
  });

  it("menos unário no começo e depois de parêntese", () => {
    expect(valorDe("=-10+30")).toBe(20);
    expect(valorDe("=(-5+8)*2")).toBe(6);
  });

  it("espaços não atrapalham", () => {
    expect(valorDe("= 10 + 10 ")).toBe(20);
  });

  it("marca que veio de fórmula", () => {
    expect(avaliarValor("=10+10").ehFormula).toBe(true);
    expect(avaliarValor("20").ehFormula).toBe(false);
  });
});

// ── Os maldosos: nenhum pode virar 0 ────────────────────────────────────────
describe("⚠ recusas — nenhuma pode devolver 0 nem um número plausível", () => {
  const casos = [
    ["'=' sozinho", "=", "formula_incompleta"],
    ["operador sem operando", "=10+", "formula_incompleta"],
    ["parêntese aberto", "=(10+2", "parenteses_abertos"],
    ["parêntese sobrando", "=10+2)", "parenteses_sobrando"],
    ["dois números soltos", "=10 20", "formula_incompleta"],
    ["operador no começo sem sentido", "=*10", "formula_incompleta"],
    ["parêntese vazio fechando após operador", "=(10+)", "formula_incompleta"],
    ["multiplicação implícita não existe", "=10(2)", "formula_incompleta"],
    ["divisão por zero", "=10/0", "divisao_por_zero"],
    ["letra no meio", "=10+abc", "caractere_invalido"],
    ["símbolo fora da gramática", "=10%2", "caractere_invalido"],
    ["notação científica não existe aqui", "=1e3", "caractere_invalido"],
    ["função de planilha não existe aqui", "=SOMA(1;2)", "caractere_invalido"],
    ["espaço DENTRO do número", "=1 000+1", "formula_incompleta"],
  ];

  it.each(casos)("%s é recusado (%s)", (_nome, texto, erro) => {
    const r = avaliarValor(texto);
    expect(r.ok).toBe(false);
    expect(r.erro).toBe(erro);
    expect(r.valor).toBeUndefined(); // não existe "valor" numa recusa
    expect(r.mensagem).toBeTruthy(); // toda recusa diz o porquê
  });
});

describe("arredondamento — a coluna é Decimal(18,2)", () => {
  it("'=100/3' → 33.33", () => {
    expect(valorDe("=100/3")).toBe(33.33);
  });

  it("arredonda para cima na metade", () => {
    expect(valorDe("=0,125*2")).toBe(0.25);
  });

  it("não perde centavo por ponto flutuante", () => {
    // 1.005 arredondado ingenuamente dá 1.00 em float. Um centavo a menos é diferença que alguém
    // procura durante meia hora.
    expect(valorDe("1,005")).toBe(1.01);
    expect(valorDe("=0,1+0,2")).toBe(0.3);
  });
});

describe("valorUtilizavel — junta a leitura com a regra de negócio", () => {
  it("valor positivo passa", () => {
    expect(valorUtilizavel("=10+10")).toMatchObject({ ok: true, valor: 20 });
  });

  it("resultado ZERO é recusado com motivo", () => {
    const r = valorUtilizavel("=10-10");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("valor_nao_positivo");
  });

  it("resultado NEGATIVO é recusado com motivo", () => {
    const r = valorUtilizavel("=10-30");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("valor_nao_positivo");
  });

  it("vazio continua não sendo erro", () => {
    // O botão Salvar já está desabilitado por outros motivos numa linha em branco; acusar aqui
    // encheria a linha nova de vermelho antes de a pessoa digitar qualquer coisa.
    expect(valorUtilizavel("")).toMatchObject({ ok: true, vazio: true });
  });

  it("a recusa da leitura atravessa (não vira 'não positivo')", () => {
    expect(valorUtilizavel("=10+").erro).toBe("formula_incompleta");
  });
});

describe("'x' de calculadora ganha mensagem própria", () => {
  it("'=10 x 3' diz o que fazer, em vez do erro genérico", () => {
    // Aceitar 'x' abriria a porta para 'X' e '×', e um x solto viraria multiplicação fantasma.
    const r = avaliarValor("=10 x 3");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("use_asterisco");
    expect(r.mensagem).toMatch(/\*/);
  });
});

describe("faixa — a coluna é Decimal(18,2)", () => {
  it("valor alto legítimo continua exato", () => {
    expect(valorDe("=1.000.000,00+0,50")).toBe(1000000.5);
  });

  it("estouro é recusado AQUI, não no Postgres", () => {
    // Sem esta guarda o número chega ao backend em notação científica ("1e+16"), o parseFloat de lá
    // aceita, e o banco devolve 500. Uma frase no campo é melhor que um erro de servidor.
    const r = avaliarValor("=999999999999*9999");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("resultado_fora_da_faixa");
  });
});

describe("⚠ ida e volta com o valor que vem da API", () => {
  // O modo edição e o auto-preenchimento por histórico jogam um valor da API DENTRO do campo, sem
  // ninguém digitar. Se o formato que entra não for um que a gramática aceite, o lançamento abre
  // com o campo travado e a pessoa nem tocou nele. Prisma Decimal chega como string.
  it.each([
    [1234.5, 1234.5],
    ["1234.500", 1234.5],
    ["1234.50", 1234.5],
    [0.5, 0.5],
    [1000000, 1000000],
  ])("%s volta como %s", (daApi, esperado) => {
    const noCampo = fmtValor(daApi); // é o que a tela escreve no input
    expect(avaliarValor(noCampo).valor).toBe(esperado);
  });
});
