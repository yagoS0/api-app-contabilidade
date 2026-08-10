// AS TABELAS DO SITFIS — o que quebrava e o que não pode voltar a quebrar.
//
// ⚠ TODOS OS TEXTOS ABAIXO SÃO EXCERTOS DO `CompanyFiscalStatus.texto` GRAVADO EM PRODUÇÃO,
// lidos em 2026-08-10 (só leitura). Não há fixture escrita à mão: o defeito que este arquivo cobre
// nasceu justamente de supor a forma do texto em vez de olhá-la.
//
//   • 61.324.247/0001-58, relatório de 10/08/2026 — PA trimestral PARTIDO em duas linhas
//   • 46.848.383/0001-53, relatório de 24/07/2026 — o MESMO campo INTEIRO numa linha só,
//     no bloco "Débito com Exigibilidade Suspensa (SIEF)"
//
// São esses dois textos, juntos, que provam que a remontagem não inventa valor: o resultado da
// fusão (`2º TRIM/2026`) é literalmente o que o outro relatório imprime quando a linha não quebra.

import { parseSitfisRelatorio, fundirCelulasPartidas } from "../parseSitfisRelatorio.js";

// ── 61.324.247/0001-58 · 10/08/2026 ──────────────────────────────────────────────────────────────
// Seis pendências: quatro mensais (9 células) e duas trimestrais (10 células, porque o PA quebrou).
// 56 linhas de dado para 9 colunas → resto 2 → o bloco INTEIRO caía em "não interpretado".
const TRIMESTRAL_PARTIDO = `_____________________________________ Diagnóstico Fiscal na Receita Federal _____________________________________Pendência - Débito (SIEF) _______________________________________________________________________________________CNPJ: 61.324.247/0001-58Receita
PA/Exerc.
Dt. Vcto
Vl. Original
Sdo. Devedor
Multa
Juros
Sdo. Dev. Cons.
Situação
8109-02 - PIS
05/2026
25/06/2026
117,00
117,00
17,76
2,59
137,35
DEVEDOR
8109-02 - PIS
06/2026
24/07/2026
117,00
117,00
5,79
1,17
123,96
DEVEDOR
2172-01 - COFINS
05/2026
25/06/2026
540,00
540,00
81,97
11,98
633,95
DEVEDOR
2172-01 - COFINS
06/2026
24/07/2026
540,00
540,00
26,73
5,40
572,13
DEVEDOR
2089-01 - IRPJ
2º
TRIM/2026
31/07/2026
1.728,00
1.728,00
45,61
17,28
1.790,89
DEVEDOR
2372-01 - CSLL
2º
TRIM/2026
31/07/2026
1.036,80
1.036,80
27,37
10,36
1.074,53
DEVEDOR
`;

// ── 46.848.383/0001-53 · 24/07/2026 ──────────────────────────────────────────────────────────────
// Mesmo campo, MESMA empresa-tipo (Presumido), texto INTEIRO: `2º TRIM/2026` numa linha só.
// Este bloco também é a prova da segunda grafia do cabeçalho: `Vl.Original` / `Sdo.Devedor`, colados.
// (O prefixo "Notificação de lançamento: …" do bloco ANTERIOR foi removido para isolar este.)
const TRIMESTRAL_INTEIRO = `_____________________________________ Diagnóstico Fiscal na Receita Federal _____________________________________Débito com Exigibilidade Suspensa (SIEF) ________________________________________________________________________CNPJ: 46.848.383/0001-53Receita
PA/Exerc.
Dt. Vcto
Vl.Original
Sdo.Devedor
Situação
8109-02 - PIS
06/2026
24/07/2026
30,65
30,65
A ANALISAR-A VENCER
2172-01 - COFINS
06/2026
24/07/2026
141,46
141,46
A ANALISAR-A VENCER
2089-01 - IRPJ
2º TRIM/2026
31/07/2026
1.233,45
1.233,45
A ANALISAR-A VENCER
2372-01 - CSLL
2º TRIM/2026
31/07/2026
740,07
740,07
A ANALISAR-A VENCER
`;

/** O primeiro bloco do diagnóstico da Receita Federal. */
const blocoRfb = (texto) => parseSitfisRelatorio(texto).diagnosticos.find((d) => d.chave === "RFB").blocos[0];

describe("fundirCelulasPartidas — armadilha 4 (célula quebrada em duas linhas)", () => {
  it("junta o PA trimestral partido e devolve exatamente a forma que o relatório usa quando não quebra", () => {
    expect(fundirCelulasPartidas(["2089-01 - IRPJ", "2º", "TRIM/2026", "31/07/2026"]))
      .toEqual(["2089-01 - IRPJ", "2º TRIM/2026", "31/07/2026"]);
  });

  it("não mexe no PA trimestral que já vem inteiro", () => {
    const linhas = ["2089-01 - IRPJ", "2º TRIM/2026", "31/07/2026"];
    expect(fundirCelulasPartidas(linhas)).toEqual(linhas);
  });

  it("vale para os quatro trimestres", () => {
    for (const t of ["1", "2", "3", "4"]) {
      expect(fundirCelulasPartidas([`${t}º`, "TRIM/2026"])).toEqual([`${t}º TRIM/2026`]);
    }
  });

  // ⚠ A REGRA É O PAR, NÃO O CARACTERE. Meia regra não funde nada — é o que impede a fusão de
  // engolir uma célula de dado que por acaso pareça um ordinal.
  it("não funde metade do par", () => {
    expect(fundirCelulasPartidas(["2º", "31/07/2026"])).toEqual(["2º", "31/07/2026"]);
    expect(fundirCelulasPartidas(["05/2026", "TRIM/2026"])).toEqual(["05/2026", "TRIM/2026"]);
    expect(fundirCelulasPartidas(["2º"])).toEqual(["2º"]);
  });

  // O par tem que estar COLADO. Com qualquer coisa no meio, o que existe é outro desalinhamento —
  // e aí a contagem tem que continuar não fechando.
  it("não funde par separado por outra linha", () => {
    expect(fundirCelulasPartidas(["2º", "DEVEDOR", "TRIM/2026"])).toEqual(["2º", "DEVEDOR", "TRIM/2026"]);
  });

  it("não descarta nada quando nenhuma regra se aplica", () => {
    const linhas = ["8109-02 - PIS", "05/2026", "117,00", "DEVEDOR"];
    expect(fundirCelulasPartidas(linhas)).toEqual(linhas);
  });
});

describe("Pendência - Débito (SIEF) com tributo trimestral (texto real de 61.324.247/0001-58)", () => {
  const bloco = blocoRfb(TRIMESTRAL_PARTIDO);

  it("vira tabela — nada sobra em não interpretado", () => {
    expect(bloco.naoInterpretado).toEqual([]);
    expect(bloco.colunas).toEqual([
      "Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Sdo. Devedor",
      "Multa", "Juros", "Sdo. Dev. Cons.", "Situação",
    ]);
    expect(bloco.registros).toHaveLength(6);
  });

  // ⚠ O QUE IMPORTA NÃO É A CONTAGEM, É O VALOR ESTAR NA COLUNA CERTA. Uma tabela que "fecha" com
  // as colunas deslocadas é pior que a mensagem honesta: vira dívida com valor trocado na tela.
  it("põe cada valor do registro trimestral na sua coluna", () => {
    expect(bloco.registros[4]).toEqual({
      "Receita": "2089-01 - IRPJ",
      "PA/Exerc.": "2º TRIM/2026",
      "Dt. Vcto": "31/07/2026",
      "Vl. Original": "1.728,00",
      "Sdo. Devedor": "1.728,00",
      "Multa": "45,61",
      "Juros": "17,28",
      "Sdo. Dev. Cons.": "1.790,89",
      "Situação": "DEVEDOR",
    });
    expect(bloco.registros[5]["PA/Exerc."]).toBe("2º TRIM/2026");
    expect(bloco.registros[5]["Sdo. Dev. Cons."]).toBe("1.074,53");
  });

  it("não estraga os registros mensais, que já funcionavam", () => {
    expect(bloco.registros[0]["PA/Exerc."]).toBe("05/2026");
    expect(bloco.registros[0]["Sdo. Dev. Cons."]).toBe("137,35");
    expect(bloco.registros[3]["PA/Exerc."]).toBe("06/2026");
    expect(bloco.registros[3]["Sdo. Dev. Cons."]).toBe("572,13");
  });
});

describe("Débito com Exigibilidade Suspensa (SIEF) (texto real de 46.848.383/0001-53)", () => {
  const bloco = blocoRfb(TRIMESTRAL_INTEIRO);

  // O PA já vem inteiro aqui: a fusão tem que ser inerte, e o resultado tem que ser IDÊNTICO ao do
  // outro relatório. É essa igualdade que mostra que a remontagem não fabrica conteúdo.
  it("lê o PA trimestral inteiro com o mesmo valor que a fusão produz", () => {
    expect(bloco.registros[2]["PA/Exerc."]).toBe("2º TRIM/2026");
    expect(bloco.registros[3]["PA/Exerc."]).toBe("2º TRIM/2026");
  });

  // ⚠ `Vl.Original`/`Sdo.Devedor` sem espaço é como ESTE bloco imprime. Sem as duas grafias, a
  // varredura do cabeçalho parava em "Dt. Vcto", o bloco virava tabela de TRÊS colunas, e como 24
  // divide por 3 sem sobra a rede NÃO pegava: "30,65" aparecia debaixo de "Receita".
  it("reconhece as seis colunas deste bloco e mantém o dinheiro na coluna de dinheiro", () => {
    expect(bloco.colunas).toEqual(["Receita", "PA/Exerc.", "Dt. Vcto", "Vl.Original", "Sdo.Devedor", "Situação"]);
    expect(bloco.registros).toHaveLength(4);
    expect(bloco.naoInterpretado).toEqual([]);
    expect(bloco.registros[0]).toEqual({
      "Receita": "8109-02 - PIS",
      "PA/Exerc.": "06/2026",
      "Dt. Vcto": "24/07/2026",
      "Vl.Original": "30,65",
      "Sdo.Devedor": "30,65",
      "Situação": "A ANALISAR-A VENCER",
    });
  });
});

// ⚠ A REDE CONTINUA SENDO A CONTAGEM.
// A fusão conserta UM desalinhamento conhecido; ela não pode virar desculpa para aceitar "quase
// alinhou". Qualquer outra sobra tem que derrubar o bloco inteiro para as linhas cruas.
describe("a validação não foi afrouxada", () => {
  it("uma célula a mais derruba o bloco para não interpretado, mesmo com o trimestral remontado", () => {
    const bloco = blocoRfb(TRIMESTRAL_PARTIDO.replace("DEVEDOR\n2372-01 - CSLL", "DEVEDOR\n0,00\n2372-01 - CSLL"));
    expect(bloco.registros).toEqual([]);
    expect(bloco.naoInterpretado.length).toBeGreaterThan(0);
    // Ausência nunca é resposta: as linhas cruas continuam todas visíveis.
    expect(bloco.naoInterpretado).toContain("1.790,89");
    expect(bloco.naoInterpretado).toContain("1.074,53");
  });
});

// ⚠ LIMITE CONHECIDO DA REDE, escrito aqui porque é fácil confiar demais nela: a contagem é
// ARITMÉTICA. Um desalinhamento cujo tamanho por acaso seja múltiplo do número de colunas fecha a
// divisão e passa. Foi assim que "Débito com Exigibilidade Suspensa (SIEF)" ficou tanto tempo
// exibindo valor em coluna errada — duas colunas de cabeçalho não reconhecidas viravam dado, e
// 24 linhas dividiam por 3 sem sobra. Quem acrescentar bloco novo confere a COLUNA do valor no
// texto real, não só o `naoInterpretado` vazio.
