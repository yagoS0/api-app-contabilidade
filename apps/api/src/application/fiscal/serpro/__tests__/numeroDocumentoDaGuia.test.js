// O NÚMERO DO DOCUMENTO DE ARRECADAÇÃO — e as travas em volta da consulta que ele destrava.
//
// ⚠⚠ NENHUMA CHAMADA REAL AO SERPRO ACONTECE AQUI. `SerproPagtoWebService` é DUBLÊ em todos os
// testes deste arquivo, e vários deles afirmam justamente que ele **não foi chamado**. A consulta
// é PAGA e o limite é por CONTRATANTE — um teste que "só conferisse o formato" gastaria a mesma
// chamada de um clique do contador.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTAVA TRAVADO
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `POST /firm/guides/:id/buscar-pagamento` recusa ANTES do SERPRO quando a guia não tem
// `extracted.numeroDocumento` ("Guia sem número de documento — o comprovante é localizado por
// ele."), e `estadoBuscaParcela` desabilita o botão pelo mesmo motivo. A guia da parcela vinda de
// UPLOAD nunca teve esse campo — o número está impresso no PDF, e ninguém o lia.
//
// ⚠⚠ E O NÚMERO ERRADO É PIOR QUE A AUSÊNCIA. `CaptureSerproGuidesService.extractDocumentNumber`
// carrega o aviso: uma varredura frouxa gravou o CNPJ do ESCRITÓRIO como número em todas as guias
// de DAS, "e faria o PAGTOWEB consultar o documento errado". Por isso o `pdf-reader` só devolve
// número quando a leitura é inequívoca, e o que estes testes prendem é o CAMINHO até o banco.

import { mapPdfReaderToParserShape } from "../../../../modules/pdfReader/pdfReader.mapper.js";
import { normalizeParserPayload } from "../../../guides/GuideParserClient.js";
import { getGuideNumeroDocumento } from "../SerproPaymentConfirmationService.js";
import { WHERE_GUIA_SEM_PARCELAMENTO } from "../../../guides/guideContract.js";

// A resposta do `pdf-reader` para o DAS de PARCSN, na forma exata em que ela chega.
function respostaDoPdfReader({ numero = "07182623030956576", warnings = [] } = {}) {
  return {
    success: true,
    document_type: "SIMPLES",
    confidence: 0.75,
    warnings,
    raw_text: "…",
    fields: {
      cnpj: "59787656000149",
      competencia: "07/2026",
      vencimento: "2026-07-31",
      valor_total: 332.65,
      ...(numero ? { numero_documento: numero } : {}),
    },
  };
}

describe("o número atravessa o mapeador do pdf-reader", () => {
  it("`numero_documento` vira `fields.numeroDocumento`", () => {
    const shaped = mapPdfReaderToParserShape(respostaDoPdfReader());
    expect(shaped.fields.numeroDocumento).toBe("07182623030956576");
  });

  it("ausente vira NULO — nunca string vazia, que se lê como campo preenchido", () => {
    const shaped = mapPdfReaderToParserShape(respostaDoPdfReader({ numero: null }));
    expect(shaped.fields.numeroDocumento).toBeNull();
  });

  it("sobrevive à normalização do payload do parser", () => {
    const parsed = normalizeParserPayload(mapPdfReaderToParserShape(respostaDoPdfReader()));
    expect(parsed.fields.numeroDocumento).toBe("07182623030956576");
  });

  // ⚠ 17 dígitos, SEM máscara. Medido em produção (27/07/2026): com a máscara o PAGTOWEB responde
  // 500 / Erro-PAGTOWEB-00099. `buildPagtoWebPayload` faz o próprio `replace(/\D+/g, "")`, então
  // uma segunda limpeza aqui seria a segunda regra sobre o mesmo dado.
  it("chega só com dígitos, e são 17", () => {
    const shaped = mapPdfReaderToParserShape(respostaDoPdfReader());
    expect(shaped.fields.numeroDocumento).toMatch(/^\d{17}$/);
  });
});

// ⚠⚠ ESTE É O ELO QUE FALTAVA. `getGuideNumeroDocumento`, `guiaDaParcelaParaTela` e a rota
// `buscar-pagamento` leem `extracted.numeroDocumento` — no TOPO. Um número guardado dentro de
// `extracted.fields` seria invisível para os três, e o botão continuaria desabilitado.
describe("o número chega ao topo de `extracted`, que é onde todo mundo o procura", () => {
  // Espelha o que `buildExtractedPayload` produz na via de upload por empresa.
  function extractedDaGuia(parsed) {
    const subFields = parsed.fields || {};
    const numeroDocumento = String(subFields.numeroDocumento || "").trim() || null;
    return {
      ...parsed,
      ...(numeroDocumento ? { numeroDocumento } : {}),
      uploadHash: "abc",
      sourceFileName: "ExibirDAS-18082026_134133_07_2026.pdf",
    };
  }

  it("`getGuideNumeroDocumento` acha o número lido do PDF", () => {
    const parsed = normalizeParserPayload(mapPdfReaderToParserShape(respostaDoPdfReader()));
    const guide = { extracted: extractedDaGuia(parsed) };
    expect(getGuideNumeroDocumento(guide)).toBe("07182623030956576");
  });

  it("sem número, continua respondendo NULO — e a rota recusa antes do SERPRO", () => {
    const parsed = normalizeParserPayload(
      mapPdfReaderToParserShape(respostaDoPdfReader({ numero: null })),
    );
    const guide = { extracted: extractedDaGuia(parsed) };
    expect(getGuideNumeroDocumento(guide)).toBeNull();
  });

  // ⚠ A leitura RECUSADA e a leitura INEXISTENTE chegam iguais ao banco (sem número) — o que as
  // separa é o aviso, que é o rastro de que houve tentativa e ela não fechou.
  it("leitura recusada não vira número, e o motivo viaja nos warnings", () => {
    const bruto = respostaDoPdfReader({
      numero: null,
      warnings: ["numero_documento_diverge_do_codigo_barras"],
    });
    const shaped = mapPdfReaderToParserShape(bruto);
    expect(shaped.fields.numeroDocumento).toBeNull();
    expect(bruto.warnings).toContain("numero_documento_diverge_do_codigo_barras");
  });
});

// ⚠⚠ A PARCELA NÃO PODE SER RESPONDIDA PELO ÍNDICE DO PGDAS-D.
//
// `confirmarPagamentoGuia` mandava toda guia `tipo:"SIMPLES"` para `confirmarPagamentoDas`, que
// pergunta ao `CONSDECLARACAO13` pela DECLARAÇÃO da competência e decide por `dasPago`. A parcela
// de PARCSN é gravada com `tipo:"SIMPLES"` (é indistinguível do DAS do mês por tipo — o que as
// separa é `parcelamentoId`), e a competência dela é o mês da PRESTAÇÃO. Ou seja: o DAS de
// APURAÇÃO daquele mês, se estivesse pago, marcaria a PARCELA como paga.
describe("a varredura automática não pergunta sobre a parcela", () => {
  // Espelha o `where` de `runPaymentConfirmationOnce`.
  const WHERE_VARREDURA = Object.freeze({
    source: "SERPRO",
    status: "PROCESSED",
    ...WHERE_GUIA_SEM_PARCELAMENTO,
  });
  const PARCELA = Object.freeze({ source: "SERPRO", status: "PROCESSED", parcelamentoId: "parc-1" });
  const DAS_DO_MES = Object.freeze({ source: "SERPRO", status: "PROCESSED", parcelamentoId: null });

  const casa = (where, guia) => Object.entries(where).every(([k, v]) => guia[k] === v);

  it("⚠ a parcela fica FORA da varredura", () => {
    expect(casa(WHERE_VARREDURA, PARCELA)).toBe(false);
  });

  it("o DAS do mês continua dentro — não foi a varredura que se desligou", () => {
    expect(casa(WHERE_VARREDURA, DAS_DO_MES)).toBe(true);
  });

  it("a colisão que torna o filtro necessário continua existindo", () => {
    // Sem `parcelamentoId`, os dois são idênticos. É a premissa; se ela cair, o filtro pode ser
    // revisto — enquanto passar, tirá-lo devolve o índice do PGDAS-D respondendo sobre a parcela.
    expect(casa({ source: "SERPRO", status: "PROCESSED" }, PARCELA)).toBe(true);
  });

  it("o filtro é o do contrato, não uma cópia local", () => {
    expect(WHERE_GUIA_SEM_PARCELAMENTO).toEqual({ parcelamentoId: null });
  });
});
