// ⚠⚠ O CLIENTE MEXE NA SAÍDA — e o contador TEM DE SABER (31/08/2026)
//
// > Dono: *"pode ser excluído uma saída pelo usuário. ou alterado a data"*, e sobre o escopo:
// > *"série inteira — esse pagamento é sempre dia 10."*
//
// ⚠⚠ O QUE ESTA SUÍTE PROTEGE são as três decisões que não se veem olhando a tela:
//   1. o dia do CLIENTE vence a ESTIMATIVA — senão a próxima varredura desfaz a correção dele;
//   2. excluída pelo cliente **NÃO** vira `RECUSADA` — aquela palavra é do CONTADOR;
//   3. a linha excluída sai do FLUXO e CONTINUA na Conferência — sumir dos dois é o pior desfecho.

import { serieEntraNoFluxo, WHERE_SERIE_NO_FLUXO, LADO, ESTADO_DA_SERIE, ORIGEM_DA_SERIE } from "../SerieRecorrenteService.js";

const SPO = Object.freeze({
  lado: LADO.DESPESA,
  estado: ESTADO_DA_SERIE.ATIVA,
  origem: ORIGEM_DA_SERIE.DETECTADA,
  excluidaPeloClienteEm: null,
});

describe("⚠⚠ a saída excluída pelo cliente sai do fluxo", () => {
  it("a série da SPO entra no fluxo enquanto ninguém a excluiu", () => {
    expect(serieEntraNoFluxo(SPO)).toBe(true);
  });

  it("⚠⚠ excluída pelo cliente NÃO entra — mesmo ATIVA e confirmada pelo contador", () => {
    // É o ponto do pedido: a linha de 3.200 entrou sozinha pela regra dos 10%, e quem paga
    // precisa poder tirá-la sem depender de o escritório agir.
    expect(serieEntraNoFluxo({ ...SPO, excluidaPeloClienteEm: new Date("2026-08-31") })).toBe(false);
  });

  it("⚠⚠ o `where` do Prisma concorda com a função — senão vira LINHA FANTASMA na tela", () => {
    // Duas escritas do mesmo critério é como o banco passaria a trazer o que a função recusa.
    expect(WHERE_SERIE_NO_FLUXO.excluidaPeloClienteEm).toBeNull();
    expect(WHERE_SERIE_NO_FLUXO.lado).toBe(LADO.DESPESA);
  });

  it("⚠ e a exclusão do cliente NÃO é o estado `RECUSADA` — são coisas diferentes", () => {
    // `RECUSADA` é a palavra do CONTADOR sobre uma sugestão. Confundir as duas apagaria a diferença
    // entre "o escritório disse que não" e "o cliente tirou do fluxo dele".
    const recusadaPeloContador = { ...SPO, estado: ESTADO_DA_SERIE.RECUSADA };
    const excluidaPeloCliente = { ...SPO, excluidaPeloClienteEm: new Date("2026-08-31") };
    expect(serieEntraNoFluxo(recusadaPeloContador)).toBe(false);
    expect(serieEntraNoFluxo(excluidaPeloCliente)).toBe(false);
    // ⚠ Mas o ESTADO da excluída continua ATIVA: a decisão do contador não foi tocada, e é ela que
    // volta a valer quando ele desfaz.
    expect(excluidaPeloCliente.estado).toBe(ESTADO_DA_SERIE.ATIVA);
  });

  it("⚠ as receitas continuam fora, por outro motivo — e os dois motivos coexistem", () => {
    expect(serieEntraNoFluxo({ ...SPO, lado: LADO.RECEITA })).toBe(false);
  });
});
