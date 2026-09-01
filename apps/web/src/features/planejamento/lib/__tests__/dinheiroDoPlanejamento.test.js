// ⚠⚠ A PORTA DO TECLADO DO PLANEJAMENTO — ela não tinha um único teste até 01/09/2026.
//
// O motor tem 356 testes na feature, 32 deles casos dourados calculados à mão (medido em
// 01/09/2026), e está certo. O que ninguém
// media era o que CHEGA nele. Medido contra a função de verdade, antes desta entrega:
//
//     "1234.56"   -> 123456   (×100)     — é o formato que o Excel exporta
//     "1,500.00"  -> 1.5      (÷1000)    — é o formato de uma planilha em inglês
//     "R$ 1.500"  -> null                — valor copiado da PRÓPRIA tela vira "não informada"
//     "-5"        -> -5                  — margem negativa produz imposto negativo
//
// ⚠ Os dois primeiros são o defeito caro: mudam a ordem de grandeza em silêncio, e o PDF que sai
// daqui vai ao cliente. Este arquivo trava as duas metades — a que impede de escrever e a que
// recusa de colar.

import {
  mascararDinheiro,
  lerDinheiro,
  dinheiroParaCampo,
  colarDinheiro,
  lerPercentual,
  deCampo,
  paraCampo,
} from "../campoNumerico";

describe("⚠⚠ dinheiro: a ambiguidade é IMPOSSÍVEL DE ESCREVER, não 'resolvida'", () => {
  it("o teclado é um fluxo de dígitos em centavos — `1234.56` não é escrevível", () => {
    // O ponto simplesmente não entra: o que sobra são os dígitos, e eles empurram as casas.
    expect(mascararDinheiro("1234.56")).toBe("1.234,56");
    expect(lerDinheiro(mascararDinheiro("1234.56"))).toBe(1234.56);
  });

  it("⚠ e é isto que mata o ×100: o mesmo texto que dava 123.456 agora dá 1.234,56", () => {
    // A prova pelo contraste — `deCampo` continua lendo "1234.56" à brasileira, e está CERTO nisso
    // (em pt-BR o ponto é milhar). O que mudou é que esse texto não consegue mais chegar nele.
    expect(deCampo("1234.56")).toBe(123456);
    expect(lerDinheiro(mascararDinheiro("1234.56"))).toBe(1234.56);
  });

  it("campo vazio continua vazio — apagar tudo nunca fabrica `0,00`", () => {
    expect(mascararDinheiro("")).toBe("");
    expect(lerDinheiro("")).toBeNull();
  });

  it("⚠⚠ ZERO DIGITADO é diferente de campo vazio — a regra da folha depende disso", () => {
    // `folhaAusenteNaoEZero`: `null` faz o Simples sair `indisponivel`; `0` continua calculando.
    // Colapsar os dois aqui reintroduziria, pela porta do teclado, o defeito que aquela regra
    // existe para impedir.
    expect(lerDinheiro(mascararDinheiro("0"))).toBe(0);
    expect(lerDinheiro("")).toBeNull();
  });

  it("⚠ o prefill NÃO escreve zero: valor ausente vira campo vazio, nunca `0,00`", () => {
    // Um campo pré-preenchido com 0,00 a partir de um dado ausente afirmaria folha zero — e é
    // exatamente essa afirmação que joga a empresa no Anexo V sem ninguém ter informado nada.
    expect(dinheiroParaCampo(0)).toBe("");
    expect(dinheiroParaCampo(null)).toBe("");
    expect(dinheiroParaCampo(889286.09)).toBe("889.286,09");
  });

  it("ida e volta do prefill fecha — é o contrato que o arquivo inteiro existe para garantir", () => {
    for (const n of [889286.09, 1234.56, 31500, 4800000, 0.01]) {
      expect(lerDinheiro(dinheiroParaCampo(n))).toBe(n);
    }
  });
});

describe("⚠⚠ colar: gramática FECHADA, e a dúvida é DITA em vez de chutada", () => {
  it.each([
    ["1500", 1500],
    ["1500,00", 1500],
    ["1.500,00", 1500],
    ["1,500.00", 1500],
    ["1500.00", 1500],
    ["R$ 889.286,09", 889286.09],
  ])("aceita %s — leitura única", (texto, esperado) => {
    const r = colarDinheiro(texto);
    expect(r.ok).toBe(true);
    expect(r.valor).toBe(esperado);
  });

  it("⚠ `R$ 889.286,09` deixou de virar `null` — era o valor copiado da PRÓPRIA tela", () => {
    expect(deCampo("R$ 889.286,09")).toBeNull();       // o defeito, ainda mensurável
    expect(colarDinheiro("R$ 889.286,09").valor).toBe(889286.09);
  });

  it("⚠⚠ `1,500.00` deixou de virar 1,5 — era erro de MIL VEZES, para menos", () => {
    expect(deCampo("1,500.00")).toBe(1.5);             // o defeito
    expect(colarDinheiro("1,500.00").valor).toBe(1500);
  });

  it.each(["1.500", "1,500"])("RECUSA %s — as duas leituras são legítimas e não dá para escolher", (t) => {
    const r = colarDinheiro(t);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("ambiguo");
  });

  it("negativo não cola — não existe receita, folha nem crédito negativo", () => {
    expect(colarDinheiro("-5").ok).toBe(false);
  });
});

describe("⚠⚠ percentual: continua vírgula E ponto, mas agora tem FAIXA", () => {
  it("a máscara de moeda NÃO se aplica aqui — ela transformaria `5` em `0,05`", () => {
    expect(lerPercentual("5").valor).toBe(5);
    expect(lerPercentual("3,5").valor).toBe(3.5);
    expect(paraCampo(3.5)).toBe("3,5"); // a volta continua escrevendo com vírgula
  });

  it("⚠⚠ PONTO É DECIMAL AQUI, e o leitor de dinheiro erra por DEZ vezes", () => {
    // Achado por medição em 01/09/2026, e NÃO estava no plano. `deCampo` remove todo ponto como
    // milhar — certo para dinheiro, errado para percentual. A regra escrita da casa sempre foi a
    // contrária ("vírgula E ponto são aceitos como decimal"); este campo é que não a seguia.
    expect(deCampo("3.5")).toBe(35);        // o defeito, ainda mensurável
    expect(deCampo("11.33")).toBe(1133);    // o exemplo que o CLAUDE.md já citava
    expect(lerPercentual("3.5").valor).toBe(3.5);
    expect(lerPercentual("11.33").valor).toBe(11.33);
  });

  it("⚠⚠ NEGATIVO É RECUSADO — margem negativa produzia IMPOSTO NEGATIVO", () => {
    // E o `sort` do comparador coroaria o Lucro Real como vencedor por causa disso.
    expect(lerPercentual("-5")).toEqual({ valor: null, fora: true });
  });

  it("acima de 100% também — e a recusa é DITA, não silenciosa", () => {
    expect(lerPercentual("150")).toEqual({ valor: null, fora: true });
  });

  it("⚠ vazio NÃO é 'fora da faixa': ausência e erro são respostas diferentes", () => {
    // Desenhar as duas iguais faria o campo em branco parecer um campo recusado.
    expect(lerPercentual("")).toEqual({ valor: null, fora: false });
    expect(lerPercentual(null)).toEqual({ valor: null, fora: false });
  });

  it("zero por cento passa — é valor legítimo, e digitado", () => {
    expect(lerPercentual("0")).toEqual({ valor: 0, fora: false });
  });
});
