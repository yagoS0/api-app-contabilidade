// Observações do legado, não especificação da correção fiscal nem homologação SERPRO.
import { buildDeclaracaoPayload, PgdasSimulacaoService } from "../PgdasSimulacaoService.js";

const base = { contribuinteCnpj: "00000000000100", contratanteCnpj: "00000000000200",
  atividades: [{ idAtividade: 1, valorInterno: 100, valorExterno: 0 }] };
const periodos = ["2026-10", "2026-11", "2026-12", "2027-01"];

describe("PGDAS-2026-A — builder existente, sem validação remota", () => {
  test.each(periodos)("%s não altera obrigatoriedade nem tradução de caixa", competencia => {
    for (const folhasSalario of [undefined, []]) {
      const p = buildDeclaracaoPayload({ ...base, competencia, regimeApuracao: "CAIXA", folhasSalario });
      expect(p.declaracao).not.toHaveProperty("folhasSalario");
      expect(p).not.toHaveProperty("regimeApuracao");
      expect(p.declaracao.receitaPaCaixaInterno).toBe(100);
      expect(p.declaracao.receitaPaCompetenciaInterno).toBe(100);
    }
  });
  test.each(periodos)("%s mantém zero informado, independentemente do Fator R", competencia => {
    const p = buildDeclaracaoPayload({ ...base, competencia, folhasSalario: [{ pa: "2026-09", valor: 0 }] });
    expect(p.declaracao.folhasSalario).toEqual([{ pa: 202609, valor: 0 }]);
  });
  test.each([[null, 0], ["", 0], [undefined, 0], ["123.456", 123.46], [-1, -1]])(
    "conversão mensal legada %p -> %p não comprova folha", (valor, esperado) => {
      const p = buildDeclaracaoPayload({ ...base, competencia: "2026-11", folhasSalario: [{ pa: 202610, valor }] });
      expect(p.declaracao.folhasSalario[0].valor).toBe(esperado);
    });
  test("dado não numérico passa como NaN e serializa null; não é zero comprovado", () => {
    const p = buildDeclaracaoPayload({ ...base, competencia: "2026-11", folhasSalario: [{ pa: 202610, valor: "inválido" }] });
    expect(p.declaracao.folhasSalario[0].valor).toBeNaN();
    expect(JSON.parse(JSON.stringify(p)).declaracao.folhasSalario[0].valor).toBeNull();
  });
  test("não verifica completude, ordem, duplicidade, mês futuro ou abertura", () => {
    const folhasSalario = [{ pa: 202701, valor: 1 }, { pa: 202701, valor: 2 }, { pa: 202501, valor: 3 }];
    expect(buildDeclaracaoPayload({ ...base, competencia: "2026-11", folhasSalario }).declaracao.folhasSalario)
      .toEqual(folhasSalario);
  });
  test("null direto difere de null normalizado pela fachada", async () => {
    expect(() => buildDeclaracaoPayload({ ...base, competencia: "2026-11", folhasSalario: null })).toThrow(TypeError);
    const transmitirDeclaracao = jest.fn(async () => ({ dados: { valoresDevidos: [{ codigoTributo: 1010, valor: 1 }] } }));
    const service = new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } });
    await service.simular({ ...base, competencia: "2026-11", folhasSalario: null });
    expect(transmitirDeclaracao).toHaveBeenCalledTimes(1);
    expect(transmitirDeclaracao.mock.calls[0][0].declaracao.declaracao).not.toHaveProperty("folhasSalario");
    expect(transmitirDeclaracao.mock.calls[0][0].declaracao.indicadorTransmissao).toBe(false);
  });
  test("simulação/transmissão em double preservam série e distinguem intenção", async () => {
    const transmitirDeclaracao = jest.fn(async () => ({ dados: { valoresDevidos: [{ codigoTributo: 1010, valor: 1 }] } }));
    const service = new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } });
    const params = { ...base, competencia: "2026-11", folhasSalario: [{ pa: 202610, valor: 12.34 }] };
    await service.simular(params);
    await service.transmitir(params);
    const payloads = transmitirDeclaracao.mock.calls.map(([p]) => p.declaracao);
    expect(payloads.map(p => p.indicadorTransmissao)).toEqual([false, true]);
    expect(payloads[0].declaracao).toEqual(payloads[1].declaracao);
    expect(params.folhasSalario).toEqual([{ pa: 202610, valor: 12.34 }]);
  });
  test("receita zero omite atividades, mas não remove folha fornecida ao builder", () => {
    const p = buildDeclaracaoPayload({ ...base, competencia: "2026-11", atividades: [],
      folhasSalario: [{ pa: 202610, valor: 0 }] });
    expect(p.declaracao.estabelecimentos[0]).not.toHaveProperty("atividades");
    expect(p.declaracao.folhasSalario).toHaveLength(1);
  });
});
