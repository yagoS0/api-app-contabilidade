// A CAPTURA DO DAS NÃO PODE APAGAR PARCELA DE PARCELAMENTO.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `capturePgdasGuideForCompany` limpa DAS duplicado da competência com um `deleteMany` por
// `tipo:"SIMPLES" + source:"SERPRO" + status:"PROCESSED"`. A parcela do Simples é gravada com
// EXATAMENTE esses três valores (`CaptureSerproParcelaService`), porque ela é indistinguível do DAS
// do mês por tipo — o que as separa é só o `parcelamentoId`.
//
// Sem `parcelamentoId: null` no filtro, a captura NORMAL do DAS — a que roda toda vez que se busca
// o extrato da competência — apagava a parcela daquele mês, levando junto `lancamentoId`,
// `baixada`, `dataBaixa` e, por cascade, todo o `TributoParcela`. O parcelamento perdia a parcela e
// o vínculo com o lançamento contábil já feito, sem uma linha de aviso.
//
// O teste afirma o FILTRO, não o efeito: exercitar a captura inteira exigiria SERPRO, PDF e banco.
// O que pode regredir aqui é alguém reescrever o `where` — e é isso que fica travado.

import { WHERE_GUIA_SEM_PARCELAMENTO } from "../../../guides/guideContract.js";

// Os três valores com que a parcela nasce (`CaptureSerproParcelaService`): é a colisão que torna o
// filtro perigoso. Se algum deles mudar lá, este teste continua descrevendo a colisão antiga — por
// isso os nomes ficam explícitos.
const PARCELA = Object.freeze({ tipo: "SIMPLES", source: "SERPRO", status: "PROCESSED", parcelamentoId: "parc-1" });
const DAS_DO_MES = Object.freeze({ tipo: "SIMPLES", source: "SERPRO", status: "PROCESSED", parcelamentoId: null });

/** Espelha o `where` do deleteMany da captura, sem o `NOT: { id }`. */
const WHERE_LIMPEZA = Object.freeze({
  tipo: "SIMPLES",
  source: "SERPRO",
  status: "PROCESSED",
  ...WHERE_GUIA_SEM_PARCELAMENTO,
});

/** Um `where` de igualdade simples aplicado a um objeto — basta para o que se afirma aqui. */
function casa(where, guia) {
  return Object.entries(where).every(([campo, valor]) => guia[campo] === valor);
}

describe("limpeza de DAS duplicado na captura", () => {
  it("⚠ NÃO alcança a parcela de parcelamento", () => {
    expect(casa(WHERE_LIMPEZA, PARCELA)).toBe(false);
  });

  it("ainda alcança o DAS do mês, que é o que ela existe para limpar", () => {
    expect(casa(WHERE_LIMPEZA, DAS_DO_MES)).toBe(true);
  });

  it("a parcela casa nos três campos de tipo/origem/status — é essa a colisão", () => {
    // Se este teste falhar, a premissa mudou: a parcela deixou de ser indistinguível do DAS por
    // tipo, e o filtro pode ser revisto. Enquanto passar, tirar o `parcelamentoId` volta a apagar.
    const semVinculo = { tipo: "SIMPLES", source: "SERPRO", status: "PROCESSED" };
    expect(casa(semVinculo, PARCELA)).toBe(true);
  });

  it("o filtro compartilhado é o do contrato, não uma quarta cópia local", () => {
    expect(WHERE_GUIA_SEM_PARCELAMENTO).toEqual({ parcelamentoId: null });
  });
});
