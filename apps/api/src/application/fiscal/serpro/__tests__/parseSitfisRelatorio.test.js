// AS TABELAS DO SITFIS — o que quebrava e o que não pode voltar a quebrar.
//
// ⚠ TODOS OS TEXTOS ABAIXO SÃO EXCERTOS DO `CompanyFiscalStatus.texto` GRAVADO EM PRODUÇÃO,
// lidos em 2026-08-10 (só leitura). Não há fixture escrita à mão: o defeito que este arquivo cobre
// nasceu justamente de supor a forma do texto em vez de olhá-la.
//
//   • 61.324.247/0001-58, relatório de 10/08/2026 — PA trimestral PARTIDO em duas linhas,
//     e o bloco "Pendência – Parcelamento (SIEFPAR)" com UM parcelamento numerado
//   • 46.848.383/0001-53, relatório de 24/07/2026 — o MESMO campo INTEIRO numa linha só,
//     no bloco "Débito com Exigibilidade Suspensa (SIEF)"
//   • 55.387.580/0001-03, relatório de 06/08/2026 — TRÊS parcelamentos numerados no SIEFPAR
//   • 53.742.042/0001-64, relatório de 24/07/2026 — o cabeçalho da página 2 (CNPJ + razão social)
//     caindo DENTRO de um bloco, e a inscrição em dívida ativa na seção da PGFN
//
// São esses dois primeiros textos, juntos, que provam que a remontagem não inventa valor: o
// resultado da fusão (`2º TRIM/2026`) é literalmente o que o outro relatório imprime quando a
// linha não quebra.

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
Pendência – Parcelamento (SIEFPAR) ______________________________________________________________________________CNPJ: 61.324.247/0001-58Parcelamento:
0211.00012.0042365911.26-69
Parcelas em Atraso:
3
Valor em Atraso:
1.585,74
Parcelamento Simplificado`;

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

// ── 55.387.580/0001-03 · 06/08/2026 ──────────────────────────────────────────────────────────────
// TRÊS parcelamentos, os três numerados. Note que o relatório NÃO separa um do outro: o rótulo do
// seguinte vem colado no fim do anterior ("Parcelamento SimplificadoParcelamento:").
const SIEFPAR_TRES = `_____________________________________ Diagnóstico Fiscal na Receita Federal _____________________________________Parcelamento com Exigibilidade Suspensa (SIEFPAR) _______________________________________________________________CNPJ: 55.387.580/0001-03Parcelamento:
0211.00012.0056912479.26-88
Valor Suspenso:
37.067,11
Parcelamento SimplificadoParcelamento:
0211.00012.0117250325.25-54
Valor Suspenso:
19.840,14
Parcelamento SimplificadoParcelamento:
0211.00012.0134178936.25-20
Valor Suspenso:
76.377,88
Parcelamento Simplificado`;

// ── 53.742.042/0001-64 · 24/07/2026 ──────────────────────────────────────────────────────────────
// A seção da RFB INTEIRA, incluindo o cabeçalho da página 2 — que cai DENTRO do bloco de débito,
// não entre blocos. É esse texto que prova que "53.742.042 - ARAUJO BARRETO BUSINESS LTDA"
// continua sendo ruído: com essa linha entrando como célula, 45 linhas de dado viram 46 e a
// divisão por 9 colunas deixa de fechar.
const CABECALHO_NO_MEIO = `_____________________________________ Diagnóstico Fiscal na Receita Federal _____________________________________Pendência - Parcelamento (PARCSN/PARCMEI) _______________________________________________________________________CNPJ: 53.742.042/0001-64SIMPLES NACIONAL - EM PARCELAMENTO
Parcelas em atraso

6
Pendência - Débito (SIEF) _______________________________________________________________________________________CNPJ: 53.742.042/0001-64Receita
PA/Exerc.
Dt. Vcto
Vl. Original
Sdo. Devedor
Multa
Juros
Sdo. Dev. Cons.
Situação
          SIMPLES NAC.
12/2025
21/01/2026
1.831,50
1.831,50
366,30
118,86
2.316,66
DEVEDOR
          SIMPLES NAC.
01/2026
20/02/2026
486,81
486,81
97,36
26,72
610,89
DEVEDOR
          SIMPLES NAC.
03/2026
20/04/2026
2.734,75
2.734,75
546,95
87,23
3.368,93
DEVEDOR
          SIMPLES NAC.
04/2026
20/05/2026
1.740,09
1.740,09
348,01
36,88
2.124,98
DEVEDOR
          SIMPLES NAC.
05/2026
22/06/2026
1.517,60
1.517,60
160,25
15,17
1.693,02
DEVEDOR
Página: 1 /
2

MINISTÉRIO DA ECONOMIA
Por meio do Integra Contador
SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL
Autor pedido: 39.254.243/0001-91. Contratante: 39.254.243/0001-91
PROCURADORIA-GERAL DA FAZENDA NACIONAL
24/07/2026 19:07:53
INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO
CNPJ:
53.742.042 - ARAUJO BARRETO BUSINESS LTDA
__________________________ Diagnóstico Fiscal na Procuradoria-Geral da Fazenda Nacional _________________________Pendência - Inscrição (SIDA) ____________________________________________________________________________________CNPJ: 53.742.042/0001-64Inscrição
Receita
Inscrito em
Ajuizado em
Processo
Tipo de Devedor
70.4.24.435196-96
1507-SIMPLESNACIONAL
09/12/2024

11777.691.032/2024-21
DEVEDOR PRINCIPAL
Situação:
ATIVA A SER AJUIZADA
_________________________________________________________________________________________________________________
Final do Relatório
Página: 2 /
2`;

/** Os blocos de um diagnóstico, pela chave do órgão. */
const blocosDe = (texto, chave) => parseSitfisRelatorio(texto).diagnosticos.find((d) => d.chave === chave).blocos;
/** O primeiro bloco do diagnóstico da Receita Federal. */
const blocoRfb = (texto) => blocosDe(texto, "RFB")[0];

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

// ── O NÚMERO DO PARCELAMENTO ─────────────────────────────────────────────────────────────────────
//
// A regra de ruído `/^[\d.]{10,}\s*-\s*.+$/` existe para descartar o cabeçalho de página
// ("52.682.158 - ATIM ENGENHARIA LTDA") e engolia o número do parcelamento junto: os dois têm a
// forma "muitos dígitos e pontos, traço, mais alguma coisa". O bloco do SIEFPAR aparecia com
// "Parcelamento:" SEM VALOR, e o contador precisava abrir o PDF para saber de qual parcelamento
// eram as parcelas em atraso. O que separa os dois casos é a CAUDA: nome (tem letra) vs dígito
// verificador (só número).
//
// ⚠ NÃO É TABELA, e não vira. O SIEFPAR tem formato rótulo/valor intercalado, não
// cabeçalho-e-dados; nenhum dos seus rótulos está em `COLUNAS_CONHECIDAS`, então o bloco inteiro
// sai em `descricao`, na ordem em que o relatório imprime. O número volta visualmente solto —
// é o formato do bloco, e a alternativa (inventar layout) é decisão de produto.
describe("SIEFPAR — o número do parcelamento sobrevive (textos reais)", () => {
  it("um parcelamento: o número aparece logo depois do rótulo (61.324.247/0001-58)", () => {
    const bloco = blocosDe(TRIMESTRAL_PARTIDO, "RFB")[1];
    expect(bloco.titulo).toBe("Pendência – Parcelamento (SIEFPAR)");
    expect(bloco.descricao).toEqual([
      "Parcelamento:",
      "0211.00012.0042365911.26-69",
      "Parcelas em Atraso:",
      "3",
      "Valor em Atraso:",
      "1.585,74",
      "Parcelamento Simplificado",
    ]);
  });

  it("três parcelamentos: os três números sobrevivem, cada um junto do seu valor (55.387.580/0001-03)", () => {
    const bloco = blocoRfb(SIEFPAR_TRES);
    expect(bloco.descricao).toEqual([
      "Parcelamento:", "0211.00012.0056912479.26-88", "Valor Suspenso:", "37.067,11",
      "Parcelamento SimplificadoParcelamento:", "0211.00012.0117250325.25-54", "Valor Suspenso:", "19.840,14",
      "Parcelamento SimplificadoParcelamento:", "0211.00012.0134178936.25-20", "Valor Suspenso:", "76.377,88",
      "Parcelamento Simplificado",
    ]);
  });

  // O bloco de parcelamento do PARCSN/PARCMEI não traz número — traz a contagem de parcelas em
  // atraso, e "Parcelas em atraso" É uma coluna conhecida. Ele continua virando tabela de 1 coluna.
  it("não mexe no bloco de parcelamento que já era tabela (53.742.042/0001-64)", () => {
    const bloco = blocosDe(CABECALHO_NO_MEIO, "RFB")[0];
    expect(bloco.colunas).toEqual(["Parcelas em atraso"]);
    expect(bloco.registros).toEqual([{ "Parcelas em atraso": "6" }]);
    expect(bloco.descricao).toEqual(["SIMPLES NACIONAL - EM PARCELAMENTO"]);
  });
});

// ⚠ O DESCARTE NÃO FOI AFROUXADO ALÉM DA CAUDA NUMÉRICA. Errar aqui para o lado permissivo faz o
// cabeçalho de página virar célula e desalinhar a tabela inteira — que é o motivo de a regra
// existir. O texto de 53.742.042/0001-64 é a prova executável: o cabeçalho da página 2 cai NO MEIO
// do bloco de débito, e se ele entrasse como dado a divisão (45 ÷ 9) deixaria de fechar.
describe("a linha de CNPJ + razão social continua sendo descartada", () => {
  it("o cabeçalho da página 2 não vira célula: o bloco de débito continua fechando em 5 registros", () => {
    const bloco = blocosDe(CABECALHO_NO_MEIO, "RFB")[1];
    expect(bloco.naoInterpretado).toEqual([]);
    expect(bloco.registros).toHaveLength(5);
    expect(bloco.registros[0]).toEqual({
      "Receita": "SIMPLES NAC.",
      "PA/Exerc.": "12/2025",
      "Dt. Vcto": "21/01/2026",
      "Vl. Original": "1.831,50",
      "Sdo. Devedor": "1.831,50",
      "Multa": "366,30",
      "Juros": "118,86",
      "Sdo. Dev. Cons.": "2.316,66",
      "Situação": "DEVEDOR",
    });
    // A razão social não pode ter sobrado em lugar nenhum do bloco.
    const tudo = JSON.stringify(bloco);
    expect(tudo).not.toContain("ARAUJO BARRETO BUSINESS LTDA");
    expect(tudo).not.toContain("MINISTÉRIO DA ECONOMIA");
  });
});

// ── EFEITO COLATERAL MEDIDO, e por que ele é o resultado certo ───────────────────────────────────
//
// A mesma regra apagava a INSCRIÇÃO em dívida ativa (`70.4.24.435196-96`) — cauda numérica, igual
// ao parcelamento. Com ela de volta, o bloco "Pendência - Inscrição (SIDA)" passa de 10 para 11
// linhas de dado e DEIXA de fechar em 2 colunas.
//
// ⚠ Isso é ganho, não perda: a tabela que ele produzia era o defeito antigo em pessoa — colunas
// deslocadas, com "Inscrito em" impresso debaixo do cabeçalho "Inscrição" e a data debaixo de
// "Receita". A contagem fechava por aritmética (10 ÷ 2), que é o limite conhecido da rede. Não dá
// para consertá-la reconhecendo mais colunas: o registro real tem "Ajuizado em" VAZIO (a linha em
// branco some) e um par "Situação:"/valor no fim, então nem 6 colunas fechariam. As linhas cruas,
// com o número visível e o aviso de conferir no PDF, são a resposta honesta.
describe("Pendência - Inscrição (SIDA) — a inscrição volta a aparecer (53.742.042/0001-64)", () => {
  const bloco = blocosDe(CABECALHO_NO_MEIO, "PGFN")[0];

  it("mostra o número da inscrição, que a regra de ruído apagava", () => {
    expect(bloco.naoInterpretado).toContain("70.4.24.435196-96");
  });

  it("não afirma colunas que não fecham — o bloco sai cru, com tudo visível", () => {
    expect(bloco.registros).toEqual([]);
    for (const celula of ["1507-SIMPLESNACIONAL", "09/12/2024", "11777.691.032/2024-21", "DEVEDOR PRINCIPAL", "ATIVA A SER AJUIZADA"]) {
      expect(bloco.naoInterpretado).toContain(celula);
    }
  });
});

// ⚠ LIMITE CONHECIDO DA REDE, escrito aqui porque é fácil confiar demais nela: a contagem é
// ARITMÉTICA. Um desalinhamento cujo tamanho por acaso seja múltiplo do número de colunas fecha a
// divisão e passa. Foi assim que "Débito com Exigibilidade Suspensa (SIEF)" ficou tanto tempo
// exibindo valor em coluna errada — duas colunas de cabeçalho não reconhecidas viravam dado, e
// 24 linhas dividiam por 3 sem sobra. Quem acrescentar bloco novo confere a COLUNA do valor no
// texto real, não só o `naoInterpretado` vazio.
