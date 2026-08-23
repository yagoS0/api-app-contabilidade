// O QUE ENTRA NO FLUXO DE CAIXA — a decisão do dono, travada.
//
// ⚠⚠ Isto NÃO é teste de classificação (esse é `disponibilidades.test.js`). É teste da DECISÃO:
// quais classes o contador mandou somar como dinheiro, e — mais importante — quais NÃO entram
// mesmo estando dentro do grupo Disponível.
//
// Dono (contador), 21/08/2026, à pergunta *"APLICACOES DE LIQUIDEZ IMEDIATA entram no fluxo de
// caixa?"*: **sim**. Aplicação de liquidez imediata é equivalente de caixa pela norma — mas o que
// autoriza o código a afirmar isso é a decisão dele.

import {
  CLASSE,
  CLASSES_DO_FLUXO_DE_CAIXA,
  entraNoFluxoDeCaixa,
  contasDoFluxoDeCaixa,
} from "../disponibilidades.js";

// Contas com a forma real do plano global (larguras 1-2-3-5-9), com nomes anonimizados onde o nome
// não é o que está sob teste. ⚠ `112030001` é o caso didático: diz "BANCO" no nome e é
// REALIZAVEL A CURTO PRAZO — foi por contas assim que a busca por nome contava empréstimo como caixa.
const PLANO = [
  { codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
  { codigoCompleto: "111020001", nome: "BANCO CONTA MOVIMENTO" },
  { codigoCompleto: "111030001", nome: "APLICACAO AUTOMATICA" },
  { codigoCompleto: "111990001", nome: "OUTRAS DISPONIBILIDADES" },
  { codigoCompleto: "112030001", nome: "DUPLICATAS DESCONTADAS BANCO ITAU" },
  { codigoCompleto: "211060001", nome: "EMPRESTIMOS BANCO ITAU CONTRATO XXXXXX" },
  { codigoCompleto: null, nome: "CONTA SEM CODIGO COMPLETO" },
];

describe("as três classes que o dono mandou somar", () => {
  test("CAIXA, BANCOS e APLICACOES — e mais nenhuma", () => {
    expect([...CLASSES_DO_FLUXO_DE_CAIXA].sort()).toEqual(
      [CLASSE.CAIXA, CLASSE.BANCOS, CLASSE.APLICACOES].sort(),
    );
  });

  test("APLICACOES entra — é a decisão de 21/08/2026, e antes dela o módulo se recusava a decidir", () => {
    expect(entraNoFluxoDeCaixa({ codigoCompleto: "111030001" })).toBe(true);
  });

  // ⚠⚠ A GUARDA QUE MAIS IMPORTA. Escrever a regra como `!== NAO_DISPONIVEL` faria as duas classes
  // de "não sabemos" entrarem junto — e somar o desconhecido ao caixa é o defeito que este módulo
  // existe para impedir. Se alguém "simplificar" assim, estes dois casos ficam vermelhos.
  test("⚠ o que NÃO SE SABE não entra — nem sendo do grupo Disponível", () => {
    expect(entraNoFluxoDeCaixa({ codigoCompleto: "111990001" })).toBe(false);
    expect(entraNoFluxoDeCaixa({ codigoCompleto: null })).toBe(false);
  });

  test("⚠ nome não decide nada: conta que diz BANCO fora do 111 continua fora", () => {
    expect(entraNoFluxoDeCaixa({ codigoCompleto: "112030001", nome: "DUPLICATAS DESCONTADAS BANCO ITAU" })).toBe(false);
    expect(entraNoFluxoDeCaixa({ codigoCompleto: "211060001", nome: "EMPRESTIMOS BANCO ITAU CONTRATO XXXXXX" })).toBe(false);
  });
});

describe("contasDoFluxoDeCaixa", () => {
  test("soma as três classes e devolve o não-decidido NO MESMO retorno", () => {
    const r = contasDoFluxoDeCaixa(PLANO);

    expect(r.contas.map((c) => c.codigoCompleto)).toEqual([
      "111010001", "111020001", "111030001",
    ]);

    // ⚠ Estas duas NÃO somem: quem monta o demonstrativo é obrigado a decidir o que faz com elas.
    expect(r.naoDecididas.map((c) => c.codigoCompleto)).toEqual(["111990001", null]);
  });

  test("porClasse mantém a separação — o total é uma escolha de quem exibe, não daqui", () => {
    const r = contasDoFluxoDeCaixa(PLANO);
    expect(r.porClasse.caixa).toHaveLength(1);
    expect(r.porClasse.bancos).toHaveLength(1);
    expect(r.porClasse.aplicacoes).toHaveLength(1);
  });

  test("lista vazia e nula não explodem, e não inventam conta", () => {
    expect(contasDoFluxoDeCaixa([]).contas).toEqual([]);
    expect(contasDoFluxoDeCaixa(null).contas).toEqual([]);
    expect(contasDoFluxoDeCaixa(null).naoDecididas).toEqual([]);
  });
});
