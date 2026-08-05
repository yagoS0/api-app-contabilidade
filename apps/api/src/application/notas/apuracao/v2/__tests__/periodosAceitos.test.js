// A MEMÓRIA DOS PERÍODOS ACEITOS PELA RFB — o que faz o [Calcular] custar 1 chamada em vez de 19.
//
// O laço `executarComAjusteDePeriodos` converge por tentativa e erro: a RFB rejeita apontando um mês
// "desnecessário", o código remove esse mês e re-executa. **Cada re-execução é uma chamada
// COBRADA.** Medido em produção (30 dias):
//
//   CHAYM   03/08 18:34 → 18 erros + 1 ok
//   CHAYM   04/08 17:01 → 18 erros + 1 ok    ← mesmo custo no dia seguinte: nada foi aprendido
//   IOHANNA 03/08 20:18 → 16 erros + 1 ok
//   IOHANNA 04/08 17:00 → 16 erros + 1 ok
//   LENTE   04/08 16:15 →  0 erros + 2 ok    ← lista já batia: a diferença entre 2 e 19 é memória
//
// 75 das 214 chamadas pagas do mês (35% do orçamento) eram esse laço. A lista aceita SEMPRE foi
// calculada e devolvida — só era descartada, porque a gravação estava atrás de uma condição que
// nunca podia ser verdadeira (`resultado.rbt12 != null`, e o simulador devolve `null` sempre).
//
// Estes testes travam as duas metades: o laço tem que DEVOLVER as duas listas aceitas, e partir de
// uma lista já podada tem que custar UMA chamada.

import { executarComAjusteDePeriodos } from "../FechamentoService.js";

const MESES = ["2025-06", "2025-07", "2025-08"];
const receitas = MESES.map((pa) => ({ pa, valorInterno: 1000, valorExterno: 0 }));
const folhas = MESES.map((pa) => ({ pa, valor: 500 }));

/** Simulador falso: rejeita, um por vez, os PAs que a "RFB" considera desnecessários. */
function rfbQueRecusa({ receitasRuins = [], folhasRuins = [] }) {
  const chamadas = [];
  const executar = async (p) => {
    chamadas.push({
      receitas: (p.receitasBrutasAnteriores || []).map((r) => r.pa),
      folhas: (p.folhasSalario || []).map((r) => r.pa),
    });
    const rPa = (p.receitasBrutasAnteriores || []).map((r) => String(r.pa));
    const fPa = (p.folhasSalario || []).map((r) => String(r.pa));
    const receitaRuim = receitasRuins.find((pa) => rPa.includes(pa));
    if (receitaRuim) {
      const [ano, mes] = receitaRuim.split("-");
      throw new Error(`SN-Entregar: Foi enviada receita bruta de um período desnecessário: ${mes}/${ano}`);
    }
    const folhaRuim = folhasRuins.find((pa) => fPa.includes(pa));
    if (folhaRuim) {
      const [ano, mes] = folhaRuim.split("-");
      throw new Error(`SN-Entregar: Foi enviada folha de um período desnecessário: ${mes}/${ano}`);
    }
    return { dasValor: 1234.56 };
  };
  return { executar, chamadas };
}

describe("convergência dos períodos", () => {
  it("devolve as DUAS listas aceitas — receitas E folhas", async () => {
    // `gravarDaSimulacao` só guardava receitas. A FOLHA é justamente o que precisa ser podado nas
    // empresas de Fator-R — as mesmas que mais gastavam (CHAYM, IOHANNA).
    const { executar } = rfbQueRecusa({ receitasRuins: ["2025-06"], folhasRuins: ["2025-08"] });
    const out = await executarComAjusteDePeriodos(executar, {
      receitasBrutasAnteriores: receitas, folhasSalario: folhas,
    });
    expect(out.receitasAceitas.map((r) => r.pa)).toEqual(["2025-07", "2025-08"]);
    expect(out.folhasAceitas.map((r) => r.pa)).toEqual(["2025-06", "2025-07"]);
    expect(out.periodosRemovidos).toEqual({ receitas: ["2025-06"], folhas: ["2025-08"] });
  });

  it("cada rejeição é UMA chamada — é daqui que vem a conta", async () => {
    const { executar, chamadas } = rfbQueRecusa({ receitasRuins: ["2025-06", "2025-07"] });
    await executarComAjusteDePeriodos(executar, { receitasBrutasAnteriores: receitas, folhasSalario: [] });
    // 2 rejeições + 1 sucesso. Em produção eram 18 + 1.
    expect(chamadas).toHaveLength(3);
  });

  it("⚠ PARTINDO DA LISTA JÁ ACEITA, custa UMA chamada", async () => {
    // É a economia inteira num teste: mesma "RFB", mesma empresa — só que já sabendo o que ela
    // aceita. 19 chamadas viram 1.
    const { executar, chamadas } = rfbQueRecusa({ receitasRuins: ["2025-06", "2025-07"] });
    const jaPodada = receitas.filter((r) => r.pa === "2025-08");
    const out = await executarComAjusteDePeriodos(executar, {
      receitasBrutasAnteriores: jaPodada, folhasSalario: [],
    });
    expect(chamadas).toHaveLength(1);
    expect(out.resultado.dasValor).toBeCloseTo(1234.56, 2);
  });

  it("erro que NÃO é de período sobe — não vira retry infinito", async () => {
    const executar = async () => { throw new Error("SN-Entregar: declaração já transmitida"); };
    await expect(executarComAjusteDePeriodos(executar, { receitasBrutasAnteriores: receitas, folhasSalario: [] }))
      .rejects.toThrow(/já transmitida/);
  });

  it("PA apontado que não está na lista também sobe — senão o laço nunca terminaria", async () => {
    const executar = async () => { throw new Error("Foi enviada receita bruta de um período desnecessário: 01/2020"); };
    await expect(executarComAjusteDePeriodos(executar, { receitasBrutasAnteriores: receitas, folhasSalario: [] }))
      .rejects.toThrow(/desnecess/i);
  });
});
