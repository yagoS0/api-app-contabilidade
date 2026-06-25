// Q21 (spec v2) — Teste de CONTRATO do adaptador SERPRO Integra-Parcelamento.
// Gate da capability flag: enquanto este teste não passa verde, a flag fica OFF.
// Fixtures = exemplos oficiais (handoff). Envelope com `dados` ESCAPADO → exercita parse duplo.
import { mapearParcelamento, mapearParcela, mapearEmissaoDasParcela, mapearParcelasGeraveis, emitirDasServico } from "../serproParcelamentoMap.js";
import { normalizeParcelamentoDTO, normalizeParcelaDTO } from "../../../accounting/parcelamento/contracts.js";
import { validarParcela } from "../../../accounting/parcelamento/invariantes.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const ENV_OBTER = JSON.stringify({
  status: 200,
  mensagens: [{ codigo: "[Sucesso-PARCSN]", texto: "Requisição efetuada com sucesso." }],
  dados: JSON.stringify({
    numero: 9102, dataDoPedido: 20180619, situacao: "Em parcelamento", dataDaSituacao: 20230831,
    consolidacaoOriginal: {
      valorTotalConsolidadoDaEntrada: 2687.15, quantidadeParcelasDeEntrada: 5, parcelaDeEntrada: 537.43,
      dataConsolidacao: 20180619155825, valorConsolidadoDaDivida: 53742.95, detalhesConsolidacao: [],
    },
  }),
});

// status como STRING "200" (varia por serviço) — deve normalizar.
const ENV_DET = JSON.stringify({
  status: "200",
  mensagens: [{ codigo: "[Sucesso-PARCSN]", texto: "ok" }],
  dados: JSON.stringify({
    numeroDas: "07181817050461249", dataVencimento: 20180629, paDasGerado: 201806,
    numeroParcelamento: "9102", numeroParcela: "01", dataLimiteAcolhimento: 20180629,
    pagamentoDebitos: [{
      paDebito: 201511, processo: "", discriminacoesDebito: [
        { tributo: "IRPJ", principal: 17.11, multa: 3.42, juros: 4.51, total: 25.04, enteFederadoDestino: "União" },
        { tributo: "CSLL", principal: 17.42, multa: 3.48, juros: 4.59, total: 25.49, enteFederadoDestino: "União" },
        { tributo: "COFINS", principal: 55.45, multa: 11.09, juros: 14.61, total: 81.15, enteFederadoDestino: "União" },
        { tributo: "PIS", principal: 13.50, multa: 2.70, juros: 3.56, total: 19.76, enteFederadoDestino: "União" },
        { tributo: "INSS", principal: 159.24, multa: 31.85, juros: 41.96, total: 233.05, enteFederadoDestino: "União" },
      ],
    }],
  }),
});

describe("Contrato SERPRO — OBTERPARC164", () => {
  test("mapeia cabeçalho consolidado (parse duplo)", () => {
    const dto = normalizeParcelamentoDTO(mapearParcelamento(ENV_OBTER, { tipo: "PARCSN" }));
    expect(dto.numeroParcelamento).toBe("9102");
    expect(round2(dto.valorTotal)).toBe(53742.95);
    expect(dto.quantidadeParcelas).toBe(5);
    expect(dto.origem).toBe("SERPRO");
  });
});

describe("Contrato SERPRO — DETPAGTOPARC165", () => {
  const parc = normalizeParcelaDTO(mapearParcela(ENV_DET, { anoMesParcela: "201612" }));

  test("achata discriminações em componentes por tributo", () => {
    expect(parc.numeroParcela).toBe(1);
    expect(parc.numeroDas).toBe("07181817050461249");
    expect(parc.tributos).toHaveLength(5);
  });

  test("somas batem (juros LIDO, nunca derivado)", () => {
    const sJ = round2(parc.tributos.reduce((s, t) => s + t.juros, 0));
    const sT = round2(parc.tributos.reduce((s, t) => s + t.total, 0));
    expect(sJ).toBe(69.23);
    expect(sT).toBe(384.49);
  });

  test("reconciliação por componente (pega troca de coluna)", () => {
    for (const t of parc.tributos) {
      expect(Math.abs(round2(t.principal + t.multa + t.juros) - round2(t.total))).toBeLessThanOrEqual(0.01);
    }
  });

  test("invariantes Nível 1 verdes → contrato OK → flag pode ligar", () => {
    expect(validarParcela(parc).ok).toBe(true);
  });
});

describe("Contrato SERPRO — GERARDAS161 (emitir DAS da parcela)", () => {
  // PDF mínimo válido em base64 (começa com %PDF-).
  const PDF_B64 = Buffer.from("%PDF-1.5\n%fake\n").toString("base64");
  const ENV_EMIT = JSON.stringify({
    status: "200",
    mensagens: [{ codigo: "[Sucesso-PARCSN]", texto: "ok" }],
    dados: JSON.stringify({ docArrecadacaoPdfB64: PDF_B64 }),
  });

  test("idServico por modalidade (confirmados) + erro nas não suportadas", () => {
    expect(emitirDasServico("PARCSN")).toBe("GERARDAS161");
    expect(emitirDasServico("PARCSN_ESPECIAL")).toBe("GERARDAS171");
    expect(emitirDasServico("RELP_SN")).toBe("GERARDAS191");
    expect(() => emitirDasServico("PARCMEI")).toThrow(/MODALIDADE|suportad/i);
  });

  test("decodifica docArrecadacaoPdfB64 → Buffer começando com %PDF", () => {
    const { pdfBuffer } = mapearEmissaoDasParcela(ENV_EMIT);
    expect(pdfBuffer.slice(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("Contrato SERPRO — PARCELASPARAGERAR172 (competências geráveis)", () => {
  test("extrai lista de AAAAMM (defensivo)", () => {
    const env = JSON.stringify({ status: 200, dados: JSON.stringify({ listaParcelas: [202306, 202307] }) });
    expect(mapearParcelasGeraveis(env)).toEqual(["202306", "202307"]);
  });
});
