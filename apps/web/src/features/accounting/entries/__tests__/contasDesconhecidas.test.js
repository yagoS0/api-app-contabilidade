// A GUARDA QUE IMPEDE LANÇAR NUMA CONTA QUE NÃO EXISTE.
//
// Até aqui o backend só exigia que a conta não fosse VAZIA: digitar "9999" salvava sem uma palavra,
// e o erro só aparecia na EXPORTAÇÃO para o ERP — longe do lançamento que o causou, às vezes
// semanas depois, e para quem não o digitou.
//
// O caso que estes testes protegem de verdade é o último: plano ainda não carregado NÃO pode
// acusar. Travar o lançamento porque a lista não chegou trocaria um erro raro e tardio por um
// bloqueio sistemático no primeiro segundo de cada tela.

import { contasDesconhecidas } from "../components/renderAccountingEntriesParts";

const PLANO = [
  { codigo: "265", nome: "DAS - Simples Nacional" },
  { codigo: "501", nome: "Juros" },
  { codigo: "5", nome: "Caixa - Matriz" },
];

describe("contasDesconhecidas", () => {
  it("código fora do plano é apontado", () => {
    const linhas = [{ conta: "265", tipo: "D" }, { conta: "9999", tipo: "C" }];
    expect(contasDesconhecidas(linhas, PLANO)).toEqual(["9999"]);
  });

  it("todas conhecidas: nada a apontar", () => {
    expect(contasDesconhecidas([{ conta: "265" }, { conta: "5" }], PLANO)).toEqual([]);
  });

  it("conta VAZIA não é 'desconhecida' — é outro erro, com outra mensagem", () => {
    // "linha sem conta" já tem tratamento próprio; misturar as duas daria a mensagem errada.
    expect(contasDesconhecidas([{ conta: "" }, { conta: "   " }, {}], PLANO)).toEqual([]);
  });

  it("espaços em volta não inventam código novo", () => {
    expect(contasDesconhecidas([{ conta: " 265 " }], PLANO)).toEqual([]);
  });

  it("o mesmo código errado nas duas pernas aparece UMA vez", () => {
    // Senão a mensagem viraria "As contas 9999, 9999 não existem".
    expect(contasDesconhecidas([{ conta: "9999", tipo: "D" }, { conta: "9999", tipo: "C" }], PLANO)).toEqual(["9999"]);
  });

  it("⚠ SEM plano carregado não acusa NADA", () => {
    // Ausência de dado não é prova de conta inexistente. Com `accounts` ainda vazio (primeiro
    // render, ou falha na carga do plano), acusar bloquearia todo lançamento da tela.
    expect(contasDesconhecidas([{ conta: "265" }, { conta: "9999" }], [])).toEqual([]);
    expect(contasDesconhecidas([{ conta: "9999" }], undefined)).toEqual([]);
  });

  it("código numérico vindo como number casa com o plano (que guarda string)", () => {
    expect(contasDesconhecidas([{ conta: 265 }], PLANO)).toEqual([]);
  });
});
