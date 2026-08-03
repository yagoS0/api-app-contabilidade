// A RFB rejeita a declaração inteira quando recebe um período que ela já tem declarado, e diz qual.
// O ajuste remove aquele mês e re-executa. O que este teste trava é DE QUAL LISTA remover.
//
// O defeito real (produção, CHAYM 2026-07): a mensagem de FOLHA ("Foi enviada folha de um período
// desnecessário: 07/2025") casava com o regex, mas a remoção era sempre em
// `receitasBrutasAnteriores`. Se o mês não estivesse lá, o erro voltava intacto e o Calcular não
// saía do lugar; se estivesse, comia um mês de receita que a RFB precisava e repetia até estourar
// o teto — 14 chamadas SERPRO por clique, todas pagas.
import { executarComAjusteDePeriodos } from "../FechamentoService.js";

const MSG_FOLHA = "SN-Entregar: Foi enviada folha de um período desnecessário: 07/2025. Remova este período e tente novamente.";
const MSG_RECEITA = "SN-Entregar: Foi enviada receita bruta de um período desnecessário: 06/2025. Remova este período e tente novamente.";

const receitas = ["2025-06", "2025-07", "2025-08"].map((pa) => ({ pa, valorInterno: 100, valorExterno: 0 }));
const folhas = ["2025-07", "2025-08"].map((pa) => ({ pa, valor: 5000 }));

describe("executarComAjusteDePeriodos", () => {
  test("queixa de FOLHA remove da folha e NÃO toca nas receitas", async () => {
    let chamadas = 0;
    const executar = jest.fn(async (p) => {
      chamadas += 1;
      if (chamadas === 1) throw new Error(MSG_FOLHA);
      return { dasValor: 123 };
    });

    const out = await executarComAjusteDePeriodos(executar, {
      receitasBrutasAnteriores: receitas,
      folhasSalario: folhas,
    });

    expect(chamadas).toBe(2);
    expect(out.folhasAceitas.map((f) => f.pa)).toEqual(["2025-08"]);
    // A lista de receitas tem 2025-07 e NÃO pode ter sido tocada.
    expect(out.receitasAceitas.map((r) => r.pa)).toEqual(["2025-06", "2025-07", "2025-08"]);
    expect(out.periodosRemovidos).toEqual({ receitas: [], folhas: ["2025-07"] });
  });

  test("queixa de RECEITA remove da receita e NÃO toca na folha", async () => {
    let chamadas = 0;
    const executar = jest.fn(async () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error(MSG_RECEITA);
      return { dasValor: 123 };
    });

    const out = await executarComAjusteDePeriodos(executar, {
      receitasBrutasAnteriores: receitas,
      folhasSalario: folhas,
    });

    expect(out.receitasAceitas.map((r) => r.pa)).toEqual(["2025-07", "2025-08"]);
    expect(out.folhasAceitas.map((f) => f.pa)).toEqual(["2025-07", "2025-08"]);
    expect(out.periodosRemovidos).toEqual({ receitas: ["2025-06"], folhas: [] });
  });

  test("erro que não é 'período desnecessário' propaga intacto — não mascara rejeição real", async () => {
    const executar = jest.fn(async () => { throw new Error("SN-Entregar: CNPJ inválido"); });
    await expect(
      executarComAjusteDePeriodos(executar, { receitasBrutasAnteriores: receitas, folhasSalario: folhas }),
    ).rejects.toThrow("CNPJ inválido");
    expect(executar).toHaveBeenCalledTimes(1);
  });

  test("mês apontado que não está na lista propaga — não entra em laço infinito", async () => {
    const executar = jest.fn(async () => { throw new Error(MSG_FOLHA); });
    await expect(
      executarComAjusteDePeriodos(executar, {
        receitasBrutasAnteriores: receitas,
        folhasSalario: [{ pa: "2025-09", valor: 1 }], // não contém 2025-07
      }),
    ).rejects.toThrow("período desnecessário");
    expect(executar).toHaveBeenCalledTimes(1);
  });

  test("converge esvaziando as duas listas, uma remoção por vez", async () => {
    const pedidos = [MSG_FOLHA, MSG_RECEITA];
    let i = 0;
    const executar = jest.fn(async () => {
      if (i < pedidos.length) { const m = pedidos[i]; i += 1; throw new Error(m); }
      return { dasValor: 1 };
    });
    const out = await executarComAjusteDePeriodos(executar, {
      receitasBrutasAnteriores: receitas,
      folhasSalario: folhas,
    });
    expect(out.periodosRemovidos).toEqual({ receitas: ["2025-06"], folhas: ["2025-07"] });
    expect(executar).toHaveBeenCalledTimes(3);
  });
});
